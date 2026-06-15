# [068] TOCTOU de slug em garantir_loja_do_dono → NULL transitório

**crítica:** SIM (retorno NULL → loop de onboarding; toca dinheiro/assinatura indiretamente via fonte única de criação de loja)
**Mundo:** auth
**Origem:** finding BAIXA da auditoria 065

## Contexto
`garantir_loja_do_dono` (`supabase/migrations/20260615011500_garantir_loja_do_dono.sql`) deriva slug com `EXISTS` + sufixo numérico, com janela TOCTOU até o INSERT. Se outra transação inserir o mesmo slug para OUTRO dono entre check e INSERT, o `unique_violation` é no índice de **slug** (não `dono_id`), então `ON CONFLICT (dono_id) DO NOTHING` não captura → cai no `EXCEPTION WHEN unique_violation` que re-seleciona por `dono_id` e retorna NULL (este dono não tem loja). Caller (`garantirLojaDoDono` em `src/lib/supabase/queries/lojas.ts`) retorna esse NULL; o guard faz redirect → volta a `onboarding`.

## Impacto
Blip de disponibilidade p/ 1 usuário; auto-recupera no retry (slug agora existe → sufixa). Sem vazamento cross-tenant nem valor. Probabilidade ínfima (colisão de slug-base entre donos distintos na janela de corrida). Mesmo assim, a função é a **fonte única** de criação de loja e seu contrato é "nunca NULL".

## Análise de impacto
- **Tabela:** `public.lojas` (tem dado de prod). Dois índices únicos relevantes:
  - `lojas(dono_id)` UNIQUE (`20260614003500_unique_loja_por_dono.sql`) — trava da idempotência RN-01.
  - `lojas(slug)` UNIQUE (coluna `slug ... unique` do `schema_inicial`) + CHECK `slug ~ '^[a-z0-9-]+$'`.
- **Quem escreve:** SOMENTE esta função (auto-cura). `criarLoja` (insert direto) é fluxo separado de cadastro; não usa a RPC.
- **Quem lê / chama:** `src/lib/supabase/queries/lojas.ts::garantirLojaDoDono` (única caller da RPC) → invocada pelo guard/onboarding. O caller faz `if (error) throw; return data;` — hoje propaga NULL silenciosamente no path bugado.
- **Migration ainda NÃO deployada ao cloud** (só local). Logo, zero linhas em prod afetadas; a correção é num artefato novo.

## Decisão de abordagem

### Por que NÃO `ON CONFLICT (slug)`
`INSERT` aceita um único `ON CONFLICT` target por statement. Mesmo se fosse possível, `ON CONFLICT (slug) DO NOTHING` seria **errado**: o slug colidido pertence a OUTRO dono, então "do nothing" deixaria ESTE dono sem loja (volta a retornar NULL). O conflito de slug exige um slug DIFERENTE, não um no-op.

### Escolhida: separar o tratamento por constraint + loop de retry de slug
Distinguir as duas violações pela coluna que conflitou e tratar cada uma na sua natureza:

1. **Conflito em `dono_id`** (corrida de duplo-login do MESMO dono) → idempotente: re-seleciona por `dono_id` e retorna o id existente. Comportamento atual já correto; preservar (RN-01).
2. **Conflito em `slug`** (colisão com OUTRO dono na janela) → re-derivar slug com novo sufixo e **tentar o INSERT de novo**, em loop limitado.

Como distinguir os dois 23505 dentro do `EXCEPTION`: usar `GET STACKED DIAGNOSTICS v_constraint = PG_EXCEPTION_CONSTRAINT` (ou comparar contra os nomes dos índices únicos). O `dono_id` resolve por idempotência; o `slug` re-deriva e re-tenta.

Estrutura recomendada (LOOP com teto de tentativas):
- Idempotência inicial por `dono_id` (inalterada).
- Derivação base do slug (inalterada): sanitiza email, fallback `loja-<uuid>` se vazio.
- `FOR v_tentativa IN 1..N LOOP`:
  - INSERT com `ON CONFLICT (dono_id) DO NOTHING RETURNING id INTO v_id`.
  - Se `v_id` não-NULL → sucesso, sair.
  - Se NULL (ON CONFLICT em dono_id disparou — corrida do mesmo dono) → `SELECT id ... WHERE dono_id` → retorna; sair.
  - `EXCEPTION WHEN unique_violation` no INSERT (slug colidiu com outro dono): re-derivar `v_slug` com sufixo novo (incremental `-2`, `-3`, ... ou hash do dono + contador) e continuar o loop.
- Se estourar N tentativas (praticamente impossível): fallback slug determinístico único `loja-<uuid-sem-hifen>` e um último INSERT; ou `RAISE` controlado. Preferir fallback uuid (slug garantidamente livre) para honrar "nunca NULL".

Sufixo de re-derivação: começar do sufixo de hash do dono (já existe no código: `substr(replace(p_dono_id::text,'-',''),1,8)`), e nas tentativas seguintes anexar o contador (`-<hash>-<tentativa>`). Isso converge: o slug do dono é único por construção a partir da 1ª re-derivação.

### Onde aplicar: EDITAR a própria migration 20260615011500 (não criar nova)
Justificativa:
- A migration 065 **ainda não foi deployada ao cloud** (confirmado: histórico remoto não a tem; ela é local/nova nesta branch). Editar o artefato novo é mais limpo, mantém um único `CREATE OR REPLACE FUNCTION` como fonte única, sem poluir o histórico com uma migration de correção de algo nunca aplicado.
- `db reset` local recria do zero; nenhum ambiente tem a versão antiga aplicada.
- Regra do projeto: schema só muda via migration versionada — aqui a migration versionada continua sendo a 065, apenas com a função correta antes do primeiro deploy.
- Risco: se em algum momento a 065 JÁ tiver sido aplicada em algum ambiente compartilhado, editar in-place dessincroniza. Validar antes de editar: `npx supabase migration list` (a 065 NÃO pode constar como aplicada no remoto). Se constar → criar nova migration `2026XXXX_garantir_loja_toctou_slug.sql` com `CREATE OR REPLACE FUNCTION` (mesma assinatura) em vez de editar.

## Invariantes a preservar (não regredir)
- `SECURITY DEFINER`.
- `SET search_path = public` travado.
- `REVOKE` de PUBLIC/anon/authenticated + `GRANT EXECUTE ... TO service_role` (somente).
- Idempotência por `dono_id` (RN-01): N chamadas / corrida do mesmo dono → exatamente 1 loja, mesmo id.
- Loja nasce: `nome=''`, `ativo=false`, `assinatura_status='trial'`, `assinatura_fim_periodo=now()+14d`, `consentimento_em=now()`, `consentimento_versao=p_versao_termos`. Nenhum valor monetário/consentimento vindo do payload.
- Slug final sempre passa no CHECK `^[a-z0-9-]+$`.

## Sequência
Mudança **aditiva/in-place num artefato não deployado** — 1 passo, sem expand→contract:
1. Editar a função em `20260615011500_garantir_loja_do_dono.sql` (loop de retry + GET STACKED DIAGNOSTICS).
2. `npx supabase db reset` local.
3. Regenerar tipos.

## Comando de regenerar tipos
```
npx supabase gen types typescript --local > src/lib/database.types.ts
```
(Assinatura da função não muda → diff de tipos deve ser vazio; rodar mesmo assim para garantir sincronia.)

## Rollback
- A função é substituída por `CREATE OR REPLACE` idempotente; reverter = re-aplicar a versão anterior do `CREATE OR REPLACE` (git revert do hunk). Não há `DROP COLUMN`/dado destrutivo.
- Janela de rollback: total e segura — nenhum dado é alterado nem migrado; só o corpo da função muda. Reverter a qualquer momento não perde dado.
- Como a migration não foi deployada, "rollback" pré-deploy é simplesmente descartar o hunk.

## Checklist de validação
- [ ] `npx supabase migration list` confirma que 065 NÃO está aplicada no remoto (pré-condição p/ editar in-place).
- [ ] Teste RED novo (escrito pelo `tdd`) falha contra a função atual e passa após a correção.
- [ ] `npx supabase db reset` local passa (função recria sem erro de sintaxe).
- [ ] Suite `tests/migrations/garantir_loja_do_dono.test.ts` continua verde (idempotência RN-01, race do mesmo dono, slug válido).
- [ ] RLS de `lojas` intacta (função é SECURITY DEFINER; checar que GRANT só service_role).
- [ ] Tipos regenerados (`database.types.ts` sem drift).
- [ ] `pnpm build` verde.

## Cenário de teste RED (para o `tdd` — NÃO implementar aqui)
Objetivo do vermelho: provar que sob colisão de slug entre donos distintos a função AINDA retorna loja válida (não NULL) e mantém idempotência por dono_id.

- **Setup:** dois donos com a MESMA parte local de email (ex.: `joao.silva@a.local` e `joao.silva@b.local`) → mesmo slug-base `joao-silva`. Dono A já tem loja com slug `joao-silva` (ocupa o slug-base).
- **Ação:** chamar `garantir_loja_do_dono(DONO_B, 'joao.silva@b.local', ...)`. Com a função ATUAL, o `EXISTS` sufixaria — mas para exercitar o path TOCTOU real (violação de slug no INSERT, não no EXISTS), o cenário-chave é forçar a colisão DEPOIS do EXISTS. Estratégias possíveis para o `tdd` avaliar:
  - (a) Pré-ocupar o slug sufixado esperado (`joao-silva-<hash_de_B>`) com um terceiro dono, de modo que o INSERT de B viole slug mesmo após a sufixação → hoje cai no EXCEPTION e retorna NULL. RED = `loja_id` é NULL / função não retorna loja de B.
  - (b) Inserir manualmente uma loja com o slug-base entre check e insert via fixture, simulando a janela.
- **Asserções (verde esperado pós-fix):**
  - `loja_id` retornado de B é NOT NULL (`expect(lojaId).toBeTruthy()`).
  - Relê `public.lojas WHERE dono_id = DONO_B` via service_role → existe exatamente 1 loja, `id` == `loja_id`, `slug` casa `^[a-z0-9-]+$` e é DIFERENTE do slug do dono A.
  - Idempotência preservada: 2ª chamada de B → mesmo id, ainda 1 loja.
  - Contrato server-side intacto (ativo=false, trial, consentimento) na loja de B.

## Riscos
- **Distinguir os dois 23505:** se o `GET STACKED DIAGNOSTICS PG_EXCEPTION_CONSTRAINT` não casar o nome esperado do índice (nomes podem diferir: constraint inline `lojas_slug_key` vs índice nomeado), o tratamento erra de ramo. Mitigar: capturar o nome real (`\d lojas` / consultar `pg_constraint`) e/ou tratar por reconsulta: se após unique_violation o dono JÁ tem loja → idempotente (dono_id); senão → era slug, re-derivar. Esse fallback por reconsulta é mais robusto que casar nome de constraint.
- **pglite vs Postgres real:** confirmar que `GET STACKED DIAGNOSTICS` e `PG_EXCEPTION_CONSTRAINT` existem no pglite usado nos testes. Se não, usar a estratégia por reconsulta (acima), que não depende do nome da constraint.
- **Loop infinito:** teto de N tentativas obrigatório + fallback `loja-<uuid>` (slug garantidamente único) para honrar "nunca NULL".
- **Leitores ativos:** nenhum — função não deployada; só afeta criações futuras.
- **NOT NULL / default:** N/A (sem mudança de coluna).

## Escopo
- [ ] Reescrever corpo de `garantir_loja_do_dono` com tratamento separado por constraint + loop de retry de slug (teto N + fallback uuid).
- [ ] Editar in-place a migration 065 (após confirmar não-deploy) OU nova migration de correção se já aplicada.
- [ ] Regenerar tipos.

## Critério de aceite
- [ ] Colisão de slug entre donos distintos na janela → função ainda retorna loja válida (não NULL).
- [ ] Idempotência por `dono_id` (RN-01) preservada: corrida do mesmo dono → 1 loja, mesmo id.
- [ ] SECURITY DEFINER + search_path travado + GRANT só service_role mantidos.
- [ ] Suite existente + teste RED novo verdes; build verde.
</content>
</invoke>
