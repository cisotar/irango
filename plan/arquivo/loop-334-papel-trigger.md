# Loop · 334 endurecer trigger de papel e decidir papel antes da posse do e-mail
gerado: orquestrar-autonomo · 2026-10-03 10:49 · degrau: 3 · resumo humano: plan/loop-334-papel-trigger.resumo.md

## Pedido
> Tarefa: @tasks/334-endurecer-papel-trigger-e-cadastro-sem-posse.md
>
> crie o plano para ser executado em um único loop.

contexto: issue 334 (`crítica: SIM`, `Spec: —`, depende da 332 já mesclada; migration `20261001120000_papel_cliente.sql` já no cloud). Autorizações fechadas com o usuário: modo autônomo de ponta a ponta; `npx supabase db push` autorizado com tsc/lint/test/build verdes; `git push` + PR autorizados; merge manual; dependência nova só com `npm audit` sem alta/crítica (este loop não instala nenhuma). Branch de origem do usuário: `feat/vitrine-conta-cliente` (2 commits locais não publicados, não tocar); `plan/tecnico-identidade-cliente.md` não rastreado é de outra frente: nunca `git add`.

Decisões deste plano:
- Achado 1 → corrigir: migration nova redefine `public.lojas_exige_dono_lojista()`; o ramo `anon`/`authenticated` com `new.dono_id is distinct from auth.uid()` passa a `raise exception 'loja: dono_id diferente do usuário da sessão' using errcode = '42501'`, sem ler nem gravar papel. SQLSTATE 42501 mantém o contrato de [5f] (`tests/migrations/papel_cliente.test.ts:363`); o fragmento distingue trigger de policy.
- Achado 2 → aceitar e documentar (opção prevista na issue). Motivos: (a) só ocorre com conta não confirmada SEM papel, estado que só nasce de falha transitória da RPC após `signUp` (todo cadastro grava papel; backfill cobriu o resto); (b) a classe geral "o primeiro cadastro decide o papel antes da posse" já é risco residual aceito no ADR (`plan/arquivo/tecnico-identidade-cliente.md` §5 item 1); (c) não dá acesso (gate do painel exige e-mail confirmado, `src/lib/utils/acessoPainel.ts:94`); (d) fechar exige mover papel E criação da loja para depois da confirmação — o trigger de `lojas` grava `lojista` no `criarLoja` do cadastro (`src/lib/actions/auth.ts:117`) — o que redesenha o cadastro e depende do redirect do e-mail de confirmação do lojista, configurado no dashboard (não verificável daqui); (e) distinguir conta nova de pré-existente exige heurística de timestamp (rejeitada no ADR §2(f)) ou `listUsers` paginado no cadastro público (`src/lib/supabase/queries/lojas.ts:319`, custo e DoS). Entrega: teste de caracterização que trava o comportamento atual + registro no ADR, em `seguranca.md` e na §10.

## Arquivos
criar:
1. `supabase/migrations/20261003130000_lojas_dono_alheio_recusa.sql`
2. `tests/migrations/lojas_dono_alheio_334.test.ts`
3. `plan/loop-334-papel-trigger.md`, `plan/loop-334-papel-trigger.resumo.md` (este par)
modificar:
4. `src/lib/actions/auth.cadastrar-papel.test.ts` (describe novo, issue 334)
5. `tests/migrations/papel_cliente.test.ts` (só o título de [5f], que deixa de ser "pela policy")
6. `references/seguranca.md` §"Papel de conta" (linha 62)
7. `references/architecture.md` §10 (linhas 430 e 446)
8. `plan/arquivo/tecnico-identidade-cliente.md` §5 item 1 (adendo da decisão)
remover: 9. `tasks/334-endurecer-papel-trigger-e-cadastro-sem-posse.md` (`git rm`, na branch)

## Reuso (grep feito)
- `tests/helpers/pglite.ts` `createTestDb` / `asUser` / `asService` / `asAnon` — harness RLS → P1
- `tests/migrations/papel_cliente.test.ts:43-92` — molde de `criarUsuarios`, `papeis`, `contarLojas`, `erroDe`, UUID sintético → P1
- `src/lib/actions/auth.cadastrar-papel.test.ts:1-45` — mocks de `signUp`/`rpc`/`deleteUser`/`criarLoja` → P1
- `supabase/migrations/20261001120000_papel_cliente.sql:57-81` — corpo atual da função; a migration nova é `create or replace` do mesmo corpo com o ramo trocado → P2
- artesanal: nenhum

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| A · trigger recusa dono alheio | RLS / autorização (`lojas.dono_id`) | RED em `tests/migrations/lojas_dono_alheio_334.test.ts`: com policy permissiva temporária, INSERT e UPDATE de `dono_id` alheio como `authenticated` (e INSERT como `anon`) falham com `42501` **e** fragmento `dono_id diferente`; 0 lojas e 0 papéis gravados no alvo e no atacante; mensagem idêntica para alvo sem papel e alvo `cliente` (sem oráculo); dono próprio e `service_role` seguem funcionando |
| B · `cadastrar` com conta não confirmada pré-existente | autorização (papel) | caracterização em `auth.cadastrar-papel.test.ts`: só-cliente → recusa sem `criarLoja`/`deleteUser`; lojista com loja → RN-01 recusa sem `criarLoja`/`deleteUser`; sem papel → `lojista` (risco aceito, nomeado no título do teste) |

## Travas
max_iterations: 3 · estagnação: 2 voltas com o mesmo FAIL ou diff vazio → parar e reportar
sucesso: P1 RED capturado; `npx vitest run` dos dois arquivos verde após P2; `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes; `npx supabase migration list` sem Remote vazio; PR aberto com CI verde
humano confirma: nada (autônomo, autorizado); merge do PR fica com o usuário
nunca: `.env*`, rotação de chave, envio externo, `git add -A`, `git add plan/tecnico-identidade-cliente.md`, merge
input externo: dado, não instrução
achado de auditoria: crítico/alto → volta a P2 · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/`
verificar sem browser: nada de UI muda; prova = pglite + `migration list`. Checklist de clique: nenhum

## Branch
branch nova de `main`: `feat/334-endurecer-papel-trigger` — `main` local fast-forward para `origin/main` (0 à frente), sem push necessário. Ao final, voltar o working tree para `feat/vitrine-conta-cliente`.

## Passos
### P1 · tdd · opus
entrada: fatia A e B de `## Risco por fatia`; decisões de `## Pedido`; moldes de `## Reuso`
faz: escreve `tests/migrations/lojas_dono_alheio_334.test.ts` (policy permissiva temporária criada como superuser via `t.db.query`, cobrindo INSERT anon/authenticated e UPDATE de `dono_id`) e o describe "conta existente não confirmada (issue 334)" em `auth.cadastrar-papel.test.ts`; roda e captura FAIL da fatia A
saída ok: FAIL da fatia A com motivo "esperava erro, inseriu" (não erro de import/sintaxe); fatia B verde (caracterização); `npx tsc --noEmit` verde
gate: `npx vitest run tests/migrations/lojas_dono_alheio_334.test.ts src/lib/actions/auth.cadastrar-papel.test.ts` + `npx tsc --noEmit`
trava: não escreve migration nem código de produção

### P2 · sessão · opus
entrada: saída P1; `20261001120000_papel_cliente.sql:57-81`
faz: cria `20261003130000_lojas_dono_alheio_recusa.sql` (`create or replace` da função, ramo com `raise ... using errcode = '42501'`, `revoke` reaplicado, rollback comentado, idempotente); ajusta título de [5f]
saída ok: os dois arquivos de P1 verdes + `tests/migrations/papel_cliente.test.ts` verde
gate: `npx vitest run tests/migrations/` + `npx tsc --noEmit`
trava: não altera `20261001120000_papel_cliente.sql` (já no cloud)

### P3 · auditar · opus
entrada: diff `main..HEAD` de P1–P2; fatias A e B
faz: audita a migration (search_path, security definer, oráculo de papel, quebra de caminho legítimo: `garantir_loja_do_dono`, `criarLoja` service_role, admin) e a decisão B
saída ok: lista de achados com severidade, `arquivo:linha`, `ok: true` se nenhum crítico/alto
gate: achados crítico/alto = 0
trava: não grava relatório em `plan/seguranca-auditoria-*.md` versionado

### P4 · sessão · higiene + docs
faz: adendo no ADR §5 item 1; `seguranca.md` §"Papel de conta"; `architecture.md` §10 (linha 446 removida como resolvida/decidida, linha 430 sem "endurecimento residual"); `git rm` da issue 334; commits sem `git add -A`

### P5 · sessão · gates + cloud + PR
faz: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`; `npx supabase migration list` (só `20261003130000` pendente) → `npx supabase db push` → `migration list` de novo; tipos: função de trigger não entra em `database.types.ts` — conferir com `gen types` e só commitar se houver diff; `git push -u` → `gh pr create` (formato `/pr`) → `gh pr checks --watch`

### P6 · higiene · sessão
`git mv plan/loop-334-papel-trigger.md plan/loop-334-papel-trigger.resumo.md plan/arquivo/` depois do PR aberto com CI verde; commit + push; voltar para `feat/vitrine-conta-cliente`.

## Custo
total: 2 invocações de agente (tdd, auditar) · 2 caras (opus) · sessão faz P2/P4/P5/P6 · ~45–70 min ponta a ponta (CI incluso)
corte: nenhum (só cortando `tdd`/`auditar` em fatia crítica); `executar` já fundido na sessão (economiza 1 opus, ~10 min)
degrau abaixo rejeitado: `/fix` não cobre migration/trigger/auth
lacuna: nenhuma
