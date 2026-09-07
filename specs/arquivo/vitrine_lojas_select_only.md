# Spec — `vitrine_lojas` SELECT-only: revogar escrita anônima em objetos públicos re-grantados pela 008500

**Severidade: CRÍTICA — produção (cloud `gdlegxatwylhkjcrusyk`) exposta agora.** Qualquer portador da anon key pode `PATCH`/`DELETE` qualquer loja ativa via `/rest/v1/vitrine_lojas`. Aplicar hoje.

---

## 1. Diagnóstico (confirmado no código)

Cadeia do bug, em ordem cronológica de migration:

1. `20260614001500_vitrine_lojas_view.sql` — cria `vitrine_lojas` com `security_invoker = false` (exceção deliberada ao §19 de `references/seguranca.md`, documentada e correta para leitura) e `grant select` para anon/authenticated. A view é **auto-atualizável** (single-table, sem agregação): Postgres aceita INSERT/UPDATE/DELETE através dela, executando na base `lojas` **como o dono da view (postgres)** — que, sendo dono da tabela e sem `FORCE ROW LEVEL SECURITY`, **ignora a RLS de `lojas`**.

2. `20260614008500_grants_roles_supabase.sql:20` — `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role` (views contam como "tables" para grants) + `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES` (linhas 26-27). A partir daqui anon tem UPDATE/DELETE na view.

3. `20260615013000_logo_url_lojas.sql:37-39` — `drop view` + `create view`: a view recriada **renasce com GRANT ALL** via default privileges da 008500. O `grant select` da linha 65 é aditivo — não anula nada. Ou seja: mesmo que a 008500 nunca tivesse existido antes da view, o padrão drop+create (já usado 3 vezes) re-abre o furo a cada recriação. **Essa é a raiz de verdade: default privileges + drop/create de view definer, sem revoke ritual.**

4. Único freio hoje: `lojas_protege_billing_trg` (colunas `assinatura_*`). Todo o resto (`nome`, `slug`, `tema`, `horarios`, `logo_url`, `ativo`, `taxa_entrega_fora_zona`) é gravável, e `DELETE` cascateia produtos/pedidos/cupons.

### Descoberta adicional (mesma causa raiz, incluir no fix)

`20260614008500` linha 22 faz `GRANT ALL ON ALL ROUTINES ... TO anon, authenticated` — isso **re-grantou EXECUTE em funções criadas antes dela cujos revokes já tinham rodado**. Auditei todas:

- **`public.loja_por_email_dono(text)`** (`20260614004000`) — `SECURITY DEFINER`, retorna `setof public.lojas` (linha INTEIRA: `dono_id`, `assinatura_*`, `hotmart_*`, `consentimento_*`, coords). O revoke da linha 29 rodou ANTES da 008500 re-grantar. **Hoje, no cloud, anon pode chamar `/rest/v1/rpc/loja_por_email_dono` com qualquer e-mail e receber a loja completa + confirmar existência do e-mail (enumeração de PII).** Segundo furo crítico.
- `loja_esta_ativa`, `pedido_aceita_itens`, `item_pedido_aceita_opcionais` — também re-grantadas, mas retornam boolean e são intencionalmente públicas. Sem ação.
- `criar_pedido` (16 args, `20260614009500`), `garantir_loja_do_dono`, `loja_por_subscription_id` — criadas/recriadas DEPOIS da 008500 com revoke explícito no mesmo arquivo. Estado final correto. Sem ação.

---

## 2. Avaliação das opções

**Opção A (revoke na view) — ACEITA, com complementos.** Um-liner, zero refactor, corrige a superfície de ataque imediatamente. Sozinha não impede reincidência no próximo drop+create — por isso os complementos da §3 (harness, guarda estática, doc).

**Opção B (`FORCE ROW LEVEL SECURITY` em `lojas`) — REJEITADA. Quebraria a vitrine inteira.** Detalhe que a proposta não considerou: a policy `lojas_leitura_publica` foi **removida** na `20260614001500:19` — `lojas` não tem NENHUMA policy de SELECT público (por design, contra vazamento de coluna). A view definer existe exatamente para contornar isso. Com `FORCE RLS`, o dono da view (postgres, sem BYPASSRLS no Supabase hosted) passa a se submeter às policies, a única de SELECT é `lojas_leitura_propria (auth.uid() = dono_id)`, `auth.uid()` do anon é NULL → **a view retorna zero linhas e a vitrine pública morre**. Também quebraria `seed.sql` e backfills futuros (rodam como postgres). Reverter isso exigiria recriar SELECT público na base — reintroduzindo o vazamento de `dono_id`/`hotmart_*` que a view corrigiu. B não é defesa em profundidade aqui; é regressão.

**Opção C (view → RPC) — REJEITADA por ora, com correção conceitual.** Uma RPC `SECURITY INVOKER` sofre do mesmo problema da B (invoker anon → zero linhas). Teria que ser `SECURITY DEFINER` retornando só colunas públicas — aí sim estruturalmente não-gravável (função não aceita PATCH). Mas exige refactor de `src/lib/supabase/queries/lojas.ts`, `frete.ts`, `auth.ts`, `page.tsx` da vitrine, rota do manifest, `database.types.ts` e ~6 arquivos de teste. Incompatível com a urgência; registrar como débito opcional, não pré-requisito.

**Recomendação: A + defesa em profundidade correta (não a B):** migration de revoke cobrindo view **e** `loja_por_email_dono`, espelhamento no harness pglite, teste RED-first, guarda estática contra recriações futuras, e regra documentada no §19.

---

## 3. Implementação passo a passo

Issue **crítica: SIM** (RLS/segurança) → mandato TDD red-first: passo 1 antes do passo 2.

### Passo 1 — Teste RED (`tdd`): `tests/migrations/vitrine_lojas_select_only.test.ts`

Usando `createTestDb` de `tests/helpers/pglite.ts` (padrão anti-falso-verde do repo: reconferir via `asService`):

1. `asAnon` UPD `update public.vitrine_lojas set nome='HACKED' where slug=<loja ativa>` → esperar rejeição por permissão; reconferir via `asService` que `nome` **não** mudou.
2. `asAnon` DELETE em `vitrine_lojas` → rejeição; `asService` confirma loja ainda existe.
3. `asAnon` INSERT em `vitrine_lojas` → rejeição.
4. `asAnon` `select ... from vitrine_lojas where ativo=true` → **funciona** (não regredir a leitura pública).
5. `asAnon` chamar `select * from public.loja_por_email_dono('dono-a@teste.local')` → rejeição por permissão (`asService` confirma que a função existe e retorna a linha — negação é permissão, não "função inexistente").

> Pré-requisito do harness (senão o RED é falso-verde por outro motivo): o `GRANTS_SQL` do `tests/helpers/pglite.ts` hoje concede `select, insert, update, delete on all tables` a anon/authenticated — isso replica o `GRANT ALL` mas **não** aplica o revoke da view, então o teste falharia corretamente no RED. Após o GREEN, o revoke da migration é que o deixa verde. **Não relaxar o GRANTS_SQL** — ele deve continuar emulando o pior caso (grant amplo) para o teste provar que o revoke contém. Confirmar só que o helper roda as migrations e DEPOIS o GRANTS_SQL; se o GRANTS_SQL roda depois da migration de revoke, ele **re-grantaria** e mascararia o fix — nesse caso o teste precisa dar o revoke como última etapa do setup, ou (melhor) o GRANTS_SQL deve trocar `insert,update,delete on all tables` por grants que não incluam views. **Verificar a ordem em `createTestDb` antes de escrever o assert** — é o ponto onde um falso-verde nasceria.

### Passo 2 — Migration GREEN: `supabase/migrations/20260702140000_vitrine_lojas_revoke_escrita.sql`

(timestamp posterior à `20260702134823_remote_schema.sql`, a última). SQL exato:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- [SEC] vitrine_lojas SELECT-only + loja_por_email_dono service_role-only
--
-- Brecha: 20260614008500 fez GRANT ALL ON ALL TABLES/ROUTINES a anon/authenticated
-- e ALTER DEFAULT PRIVILEGES GRANT ALL. A view auto-atualizável vitrine_lojas
-- (definer, dona=postgres, lojas sem FORCE RLS) virou gravável → PATCH/DELETE
-- anônimo bypassa a RLS de lojas. A mesma migration re-grantou EXECUTE em
-- loja_por_email_dono (SECURITY DEFINER, retorna a linha inteira de lojas),
-- desfazendo o revoke da 004000.
--
-- Fix: revoga escrita/execução indevida. NÃO altera RLS de lojas (correta) nem
-- security_invoker da view (definer é deliberado, §19). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) View pública: SELECT-only para os roles da API.
revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;

-- Reafirma a intenção (aditivo, não anula o revoke acima).
grant select on public.vitrine_lojas to anon, authenticated;

-- 2) Fecha a superfície de escrita default para tabelas/views FUTURAS criadas
--    pelo postgres: default privileges volta a SELECT-only para anon/authenticated.
--    (service_role permanece com ALL — precisa para cadastro/BYPASSRLS.)
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;

-- 3) loja_por_email_dono: só service_role executa (o GRANT ALL ON ROUTINES
--    da 008500 reabriu para anon/authenticated).
revoke all on function public.loja_por_email_dono(text) from anon, authenticated, public;
grant execute on function public.loja_por_email_dono(text) to service_role;
```

Notas de precisão para quem implementa:
- Usar `revoke insert, update, delete` (não `revoke all`) na view **preserva** o `select` já concedido e é explícito sobre a intenção. O `grant select` seguinte é cinto-e-suspensório idempotente.
- O bloco 2 (`alter default privileges ... revoke`) é o que **impede a reincidência** no próximo `drop view` + `create view`: sem ele, a próxima recriação de `vitrine_lojas` (ou qualquer view nova) renasce com GRANT ALL. Este é o fix da raiz, não banda-aid. Confirmar que o `service_role` continua com ALL nos default privileges (a 008500 concedeu aos três; este revoke tira só de anon/authenticated).
- Não incluir `FORCE ROW LEVEL SECURITY` (ver §2, quebra a vitrine).
- Idempotente: `revoke`/`grant`/`alter default privileges` são reaplicáveis sem erro.

### Passo 3 — Guarda estática (anti-reincidência estrutural)

Adicionar um teste que varre `supabase/migrations/*.sql`: se algum arquivo contém `create view public.vitrine_lojas` (ou drop+create), o mesmo arquivo (ou um posterior) deve conter `revoke insert, update, delete on public.vitrine_lojas`. Isso transforma "lembrar de revogar após todo drop+create" em invariante verificada por CI, fechando a causa raiz que já reincidiu 3×.

### Passo 4 — Documentação (`documentar`)

Atualizar `references/seguranca.md §19`: acrescentar que views definer auto-atualizáveis **devem** revogar `insert/update/delete` de anon/authenticated (não bastam pra leitura — o GRANT ALL/default privileges do Supabase as torna graváveis), e que `alter default privileges` de anon/authenticated é SELECT-only no schema public. Registrar o incidente na auto-memória de segurança se aplicável.

---

## 4. Checklist de verificação (pós-deploy cloud)

Pré-deploy: `migration repair` antes do `db push` (histórico remoto dessincronizado — ver memória), sempre `npx supabase`, nunca `pnpm`.

Testes automatizados (pglite):
- [ ] `pnpm vitest tests/migrations/vitrine_lojas_select_only.test.ts` verde (os 5 asserts + o de guarda estática).
- [ ] Suíte de migrations existente sem regressão: `logo_url_vitrine.test.ts`, `queries_lojas.test.ts`, `rls_lojas.test.ts`, `loja_por_email.test.ts` (este confirma que service_role ainda executa a função), `frete.test.ts`.
- [ ] `next build` (mandato: Server Action só exporta async — garantir que nada de `frete.ts`/`auth.ts`/`lojas.ts` quebrou).

Verificação manual no cloud (anon key pública, nunca service_role):
- [ ] `PATCH /rest/v1/vitrine_lojas?slug=eq.<loja>` com `{"nome":"x"}` → **HTTP 401/403** (era 2xx/204). Reconferir via painel que `nome` não mudou.
- [ ] `DELETE /rest/v1/vitrine_lojas?slug=eq.<loja>` → **401/403**. Loja e cascata (produtos/pedidos/cupons) intactas.
- [ ] `POST /rest/v1/vitrine_lojas` (insert) → **401/403**.
- [ ] `GET /rest/v1/vitrine_lojas?ativo=eq.true&select=slug,nome,logo_url` (anon) → **200 com dados** (leitura pública intacta — não regrediu).
- [ ] `POST /rest/v1/rpc/loja_por_email_dono` com anon → **401/403/404** (não mais 200 com a linha da loja).
- [ ] API pública ponta a ponta: abrir a vitrine `/loja/<slug>`, confirmar render (nome, logo, tema, horários, taxa fora de zona) e o cálculo de frete — todos os consumidores da view em `src/lib/supabase/queries/lojas.ts`, `frete.ts`, `page.tsx`, rota do `manifest.webmanifest`.

---

## Arquivos relevantes

- Bug de grant: `supabase/migrations/20260614008500_grants_roles_supabase.sql` (linhas 20-31)
- View (últimas recriações): `supabase/migrations/20260615013000_logo_url_lojas.sql:37-65`, `20260614001500_vitrine_lojas_view.sql`
- Função exposta (segundo furo): `supabase/migrations/20260614004000_fn_loja_por_email_dono.sql`
- RLS base (correta, não tocar): `supabase/migrations/20260614001000_rls_lojas.sql`
- Nova migration a criar: `supabase/migrations/20260702140000_vitrine_lojas_revoke_escrita.sql`
- Teste RED a criar: `tests/migrations/vitrine_lojas_select_only.test.ts`
- Harness (verificar ordem migration↔GRANTS_SQL): `tests/helpers/pglite.ts`
- Consumidores da view (regressão): `src/lib/supabase/queries/lojas.ts`, `src/lib/actions/frete.ts`, `src/lib/actions/auth.ts`, `src/app/(publica)/loja/[slug]/page.tsx`
- Doc a atualizar: `references/seguranca.md` §19

---

## Resumo executivo

Recomendo **Opção A + fix de raiz nos default privileges**, e **rejeito B e C**:

- **B (`FORCE RLS`) quebra a vitrine inteira** — a policy de SELECT público de `lojas` foi removida de propósito; forçar RLS faz a view definer retornar zero linhas para o anon. Não é defesa em profundidade, é regressão.
- **C (view→RPC)** só seria seguro como `SECURITY DEFINER` (invoker sofre do mesmo zero-linhas), e exige refactor de ~10 arquivos — incompatível com a urgência. Débito opcional.
- **A** resolve em um-liner. O complemento crítico é `ALTER DEFAULT PRIVILEGES ... REVOKE INSERT/UPDATE/DELETE FROM anon, authenticated`: sem ele o furo **reincide no próximo drop+create da view** (já reincidiu 3×). Essa é a causa raiz real.

Dois achados que a descrição original não previa:
1. **A `FORCE RLS` da Opção B mataria a vitrine** (por causa da policy removida) — importante o dev não implementar B achando que é grátis.
2. **Segundo furo crítico de mesma origem:** `GRANT ALL ON ALL ROUTINES` da 008500 re-expôs `loja_por_email_dono` (SECURITY DEFINER que devolve a linha completa de qualquer loja por e-mail do dono) ao anon — vazamento de PII + enumeração. Incluí o revoke dela na mesma migration.
