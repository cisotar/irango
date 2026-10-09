# Loop — Sub-rota admin de Avisos (issue 362)

Modo: **autônomo** (`orquestrar-autonomo`, opt-in explícito do usuário). Sem
parada para aprovação. `max_iterations: 3`. Estagnação (2 iterações sem mudança
observável) → parar e reportar.

## Pedido

Dono do SaaS, no painel de lojista terceiro (`/admin/assinantes/[lojaId]`), não vê
link de edição dos Avisos na sidebar. Diagnóstico fechado antes do loop: o item é
omitido de propósito por `rotasAusentes` porque a sub-rota admin não existe.
Entregar a sub-rota e só então remover o sufixo. Entrega = gates verdes + push da
branch + **PR aberto para `main`, sem merge**.

## Travas

- `service_role` escrevendo na loja de terceiro: `lojaId` **sempre** validado por
  `validarLojaIdAdmin`, **nunca** do payload. `prepararContextoAdmin` fora do try.
- As RPCs `salvar_modal_sazonal`/`ativar_modal_sazonal` recusam a via de serviço
  (`auth.uid() is null` → raise). Abrir a via **no padrão `v_e_servico`** de
  `20260930120000_rpc_salvar_faixas_entrega_ativo.sql:44-83`. Proibido resolver
  escrevendo sem RPC (perderia RN-M15/RN-M16 na loja de outro lojista).
- Overload de `ativar_modal_sazonal` com **2 args sem `default`**. `default null`
  tornaria a chamada de 1 arg ambígua e quebraria o lojista.
- `PromocoesClient.tsx` (627 linhas) **não** é reescrito — ele já recebe `acoes`
  por prop. Reescrevê-lo é sinal de desenho errado: parar.
- Teste de escopo afirma **fragmento da mensagem** junto do SQLSTATE.
- Nada de schema. Nada de `db push`. Nada de `.env*`. Sem merge do PR.
- `specs/galeria-imagens-loja.md` (untracked) **não** entra em commit nenhum.
- Nunca `git add -A`.

## Reuso (escada 1 — primitivos que já existem)

| Preciso de | Já existe em |
|---|---|
| loader admin + guard + service_role | `carregarLojaAdminBase` — `src/app/admin/assinantes/[lojaId]/carga.ts:118` |
| validação de `lojaId` / contexto admin / log / revalidate | `validarLojaIdAdmin`, `prepararContextoAdmin`, `registrarAcessoAdmin`, `revalidarLojaAdmin` — `src/lib/actions/admin-loja.ts` |
| leitura dos modais por loja | `listarModaisSazonaisDoDono(client, lojaId)` — `src/lib/supabase/queries/modaisSazonais.ts` (já escopada, segura sob service_role) |
| allowlist coluna a coluna | `montarPatchModalSazonal` — `src/lib/actions/patches-modal-sazonal.ts` |
| schema de entrada | `schemaModalSazonal` — `src/lib/validacoes/modalSazonal.ts` |
| parse fail-closed da mensagem / estado ao vivo | `lerMensagemModal`, `estadoDoModalSazonal` |
| UI inteira dos avisos | `PromocoesClient` (prop `acoes`) |
| molde de sub-rota admin | `configuracoes/tema/` (page 31 + client 32 + teste) |
| molde de actions admin | `admin-galeria.ts` |
| via de serviço em RPC invoker | `20260930120000_rpc_salvar_faixas_entrega_ativo.sql:44-83` |
| harness de RLS/RPC | `tests/helpers/pglite.ts` (`asAnon`/`asUser`/`asService`) |

## Reuso (escada 2 — agentes/skills do projeto)

`tdd` (RED) → `executar` (GREEN) → `auditar` ‖ `revisar` ‖ `testar` → gates e git
por mim. Sem `planejar`/`arquitetar`: o diagnóstico e o desenho já estão fechados
nesta issue (pagar um plano seria refazer trabalho pronto). Sem `especificar`/
`quebrar`: fatia única com issue escrita. Sem `migrar`: a migration é aditiva, de
padrão já estabelecido, e cabe no `executar` com o RED do `tdd` por cima. Sem
`verificar` (precisaria de sessão admin no cloud + migration aplicada — e o db push
está fora de escopo); o lugar disso é a validação manual pós-merge, registrada no PR.
Sem `escriba`: nenhum primitivo/contrato novo em `references/` (a via de serviço já
está documentada pelo padrão de faixas de entrega).

## Risco por fatia

| Fatia | Risco | Prova obrigatória |
|---|---|---|
| Via de serviço nas RPCs | **Alto** — afrouxa trava de autoridade no banco | pglite: service lane grava; `anon` e usuário sem posse continuam recusados com fragmento + SQLSTATE; dono inalterado |
| Overload `ativar(modal, loja)` | **Alto** — escape de escopo ativa modal de outra loja | pglite: ativar com `p_loja_id` alheio → raise com fragmento; 1-arg do lojista intacto |
| 5 actions admin | **Alto** — `service_role` + `lojaId` | teste de isolamento por action (payload com `loja_id`/id de outra loja não escreve) |
| `rotasAusentes` → `["clientes"]` | Médio — 404 se a rota não existir | teste do layout real + teste de fiação da page |
| Wrapper client | Baixo | teste de fiação (injeta action com `lojaId` por closure) |

## P1 — Issue + plano na branch

Feito por mim. `tasks/362-sub-rota-admin-de-avisos.md` + estes dois arquivos.
Branch `feat/362-avisos-admin` a partir de `main` (já espelhando `origin/main` —
`git log origin/main..main` vazio, sem push pendente).
Gate: `git status` sem `specs/galeria-imagens-loja.md` staged.

## P2 — RED (`tdd`)

Testes vermelhos, **sem código de produção**:

1. `tests/migrations/rpc_modal_sazonal_via_servico.test.ts` — pglite:
   - `asService` chama `salvar_modal_sazonal` e grava (hoje: `sem sessao`);
   - `asService` chama `ativar_modal_sazonal(modal, loja)` e ativa (hoje: função
     inexistente);
   - `asService` com `p_loja_id` de **outra** loja → raise, afirmando fragmento
     (`modal_sazonal: …`) **e** SQLSTATE;
   - dono (`asUser`) continua gravando; `asAnon` continua recusado;
   - usuário autenticado sem posse → `sem posse`, fragmento + SQLSTATE.
2. `src/app/admin/assinantes/actions/admin-modal-sazonal.escopo.test.ts` — para cada
   uma das 5 actions: `lojaId` não-uuid não eleva a service_role; payload com
   `loja_id` forjado não vira coluna; id de modal de outra loja não escreve.

Gate: `npx vitest run <os dois arquivos>` com `FAIL` capturado + `npx tsc --noEmit`
(Vitest não checa tipos).
Output: `ok: true|false` + trecho do output `FAIL`.

## P3 — GREEN (`executar`)

Na ordem: migration → actions → page/wrapper → `rotasAusentes` → testes que
afirmavam o estado antigo.

Gate: os dois arquivos do P2 verdes + `npx tsc --noEmit` + `npm test` + `npm run build`.

## P4 — `auditar` ‖ `revisar` ‖ `testar` (paralelo)

`auditar` é **obrigatório** (5 actions com `service_role`). Foco: escape de escopo,
ordem validar→provar→elevar, erro interno vazando, allowlist única.
Achado crítico/alto → volta ao P3, conta iteração, reauditar.

## P5 — Gates + git + PR

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`. Depois:
`git rm tasks/362-*.md`, `git mv plan/loop-avisos-admin*.md plan/arquivo/`, commit,
push da branch, `gh pr create` no formato de `/pr`. **Sem merge.** O corpo do PR
precisa dizer, em destaque, que a migration **não** foi aplicada ao cloud e que
`npx supabase db push` é obrigatório no merge.
