# [309] RED V6: isolamento cross-tenant e contorno da Server Action

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V6; RN-M04, RN-M08, RN-M10, RN-M11, RN-M15 S1/S2/S4/S6/S7)

## Objetivo
Suíte vermelha que prova que nenhuma loja lê ou escreve mensagem de outra (tabela, RPC direta, Server Action) e que escrita direta fora do contrato é barrada no topo ou neutralizada na leitura.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v6-isolamento.test.ts`.
- [ ] **A8** pglite `asUser(dono)`: UPDATE direto com `mensagem` `versao: 2` → `23514` + fragmento `modais_sazonais_mensagem_forma`; topo válido com trecho `{href:…}` ou `link:"javascript:…"` é gravado, e `lerMensagemModal(linha.mensagem, …)` devolve `null`.
- [ ] **A9** pglite: dono B faz UPDATE de `mensagem` do modal de A → 0 linhas e A intacta; INSERT com `loja_id` de A → `42501`. Server Action: `editarModalSazonal(idDeA, payload)` sob B (mocks de `buscarLojaDoDono`/client) devolve `ok:false`.
- [ ] **A29** pglite `salvar_modal_sazonal`: B com `p_loja_id` de A → `raise` fragmento de S2 (`sem posse`); B com o próprio `p_loja_id` e `p_modal_id` de A → `raise` de S4 (mesma mensagem para inexistente, sem oráculo: afirmar igualdade); B com categoria/cardápio de A → `23503`; `asAnon` → `42501`; `asService` sem JWT de usuário → `raise` de S1. Em todos: snapshot das duas lojas (linha + junções) idêntico antes/depois.
- [ ] **A10** pglite `asAnon`: SELECT de `mensagem` de modal `ativo = false` → 0 linhas.
- [ ] **A11** Server Action: payload válido + `loja_id` (e outro caso com `ativo`) → `ok:false` e spy de `rpc` **não** chamado.
- [ ] **A12** Server Action: `editarModalSazonal`, `ativarModalSazonal`, `desativarModalSazonal`, `removerModalSazonal` com `id` `"1 or 1=1"` e `"../"` → `ERRO_VALIDACAO`, spy de `createClient` não chamado, rate-limit não consumido.
- [ ] Capturar o `FAIL`.

## Fora de escopo
Tetos de array S3 (307). Rollback transacional (311). Produção (312, 313, 314).

## Reuso esperado
- `tests/helpers/pglite.ts` (`asAnon`/`asUser`/`asService`), seed compartilhado (ver 307), molde de `tests/migrations/modais_sazonais_rls.test.ts`.
- Mocks de Server Action no molde de `src/lib/actions/modalSazonal.test.ts`.

## Segurança
Vazamento entre lojas = falha crítica. Afirmar fragmento de mensagem junto do SQLSTATE em toda trava de escopo.

## Critério de aceite
- [ ] A8, A9, A29, A10, A11, A12 cobertos nas camadas listadas; `FAIL` capturado.
- [ ] Nenhum arquivo em `src/` ou `supabase/` alterado.
