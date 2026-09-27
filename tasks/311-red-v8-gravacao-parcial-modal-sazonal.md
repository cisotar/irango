# [311] RED V8: integridade transacional do salvar (gravação parcial visível)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V8; RN-M15 "Testes obrigatórios de falha no meio")

## Objetivo
Suíte vermelha que prova que salvar um modal é tudo ou nada no banco e que a Server Action faz uma única chamada à RPC.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v8-atomicidade.test.ts`.
- [ ] pglite `asUser(dono)`, os **6 casos de RN-M15**, cada um com snapshot (linha de `modais_sazonais` + `modal_sazonal_categorias` + `modal_sazonal_cardapios`) antes/depois:
  1. editar com `p_categorias` válidas e `p_cardapios` com cardápio de outra loja → `23503`; estado idêntico (**A27**);
  2. editar com categoria apagada antes do save → `23503`; estado idêntico (**A27**);
  3. criar com seleção inválida → `23503`; zero linhas novas em `modais_sazonais` e nas junções (**A28**);
  4. editar com `p_mensagem` de 70 KB → `23514` + fragmento `modais_sazonais_mensagem_tamanho`; estado idêntico (**A27**);
  5. afirmação explícita de que as junções **antigas** (não vazias no seed) voltam a existir após os casos 1 e 2: prova do rollback do DELETE de S5 (**A27**);
  6. `p_modal_id` de outra loja → `raise` de S4 com fragmento afirmado; nada muda em nenhuma das duas lojas.
- [ ] Positivo de controle: criar e editar válidos gravam linha + mensagem + junções e devolvem o `id`; editar com `p_mostrar_promocoes_junto = null` preserva o valor; `ativo` nunca muda pela RPC.
- [ ] **A31** Server Action com client mockado: `criarModalSazonal` e `editarModalSazonal` fazem **exatamente uma** chamada, `rpc("salvar_modal_sazonal", args)`, com `p_loja_id` vindo de `buscarLojaDoDono` e **nenhum** `.from("modal_sazonal_*")` nem `.from("modais_sazonais")` de escrita; erro da RPC vira `ERRO_GENERICO` ("Não foi possível salvar. Tente novamente.") e o detalhe vai só para o log.
- [ ] Capturar o `FAIL`.

## Fora de escopo
Tetos de array (307), posse/anon (309). Produção (312, 314).

## Reuso esperado
- `tests/helpers/pglite.ts`, seed compartilhado (ver 307), molde de `tests/migrations/modais_sazonais_rls.test.ts`.
- Mocks no molde de `src/lib/actions/modalSazonal.test.ts`.

## Segurança
Estado misto visível ao cliente. Erro do banco nunca vaza (`seguranca.md` §14).

## Critério de aceite
- [ ] A27, A28, A31 e os 6 casos de RN-M15 cobertos; `FAIL` capturado.
- [ ] Nenhum arquivo em `src/` ou `supabase/` alterado.
