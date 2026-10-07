# [356] Função SQL do ranking de clientes fiéis (`SECURITY DEFINER`, escopo `auth.uid()`)

**crítica:** SIM (TDD red-first)
**Mundo:** infra (banco)
**Depende de:** [355] (reusa o conjunto de status do faturamento padrão definido lá; nunca redigitar a lista)
**Spec:** specs/relatorio-vendas.md — §4 Banco (behaviors "Função do ranking no molde de `clientes_da_loja`" e
"`anon` não executa", parte do ranking), Migration D; lado SQL dos behaviors de §2.1 (ordenar, top 3 itens, contagem
de convidados, sem telefone/e-mail); fecha **RN-V17, RN-V19, RN-V20 (allowlist SQL), RN-V21 (parte do ranking)**

## Objetivo
Criar `ranking_clientes_da_loja` que devolve, para a loja do usuário logado, os clientes logados ordenados no banco
por nº de pedidos, total gasto ou último pedido, com os 3 itens mais comprados e a contagem de pedidos de convidados
fora do ranking — sem nenhum dado de contato.

## Escopo
- [ ] `ranking_clientes_da_loja(p_inicio, p_fim, p_ordem, p_limite)`: `SECURITY DEFINER`, `search_path = ''`, molde
      `supabase/migrations/20261003124000_clientes_da_loja.sql`; escopo `lojas.dono_id = (select auth.uid())`, **sem
      parâmetro de loja**.
- [ ] `RETURNS TABLE` fechado: `cliente_id`, `nome`, `total_pedidos`, `total_gasto`, `ultimo_pedido_em`, `itens_top`
      (até 3: nome + quantidade, por Σ quantidade no período) e a contagem de pedidos de convidados no período (forma
      exata — coluna repetida ou função irmã — fica com o plano técnico).
- [ ] Métricas nos status do faturamento padrão (RN-V01); `cliente_id` não nulo; `p_inicio` nulo só para "desde o
      início"; `p_fim` obrigatório.
- [ ] Ordenação no banco por `p_ordem ∈ pedidos | total | ultimo` (fora → `22023`), desempate total gasto e depois
      `cliente_id`; `p_limite` com teto 20 (fora → `22023`) aplicado **depois** de ordenar.
- [ ] Grants: `REVOKE ALL … FROM public, anon`; `GRANT EXECUTE … TO authenticated` (não `service_role`).
- [ ] Patch de `src/lib/database.types.ts`.

## Fora de escopo
- Seletor de período do ranking e cálculo dos limites (issue 357); tabela na tela (issue 358).
- Qualquer ranking no hub admin (proibido pela RN-V20).
- Ampliar a RLS de `clientes`.

## Reuso esperado
- `supabase/migrations/20261003124000_clientes_da_loja.sql:24-134` — estrutura DEFINER, escopo, allowlist, grants.
- Conjunto de status do faturamento padrão definido na issue 355.
- Índice `pedidos_loja_cliente_idx` existente (não criar índice novo sem medir).
- `tests/migrations/` dos testes de `clientes_da_loja` como molde de fixture (dono, cliente de outra loja).

## Segurança
- PII: só `nome` sai; telefone e e-mail **nunca** (allowlist no `RETURNS TABLE`).
- Escopo por `auth.uid()`: sem parâmetro de loja, não há como pedir a loja alheia. Sob `service_role` não há
  `auth.uid()` → vazio (e o admin não chama esta função).
- Pedido anonimizado tem `cliente_id` NULL → conta como convidado (esperado).

## Critério de aceite
- [ ] **RN-V17:** cliente A com 3 pedidos, 2 pedidos de convidado, 1 pedido de cliente anonimizado, todos em status
      do padrão → ranking com **A = 3**; contagem de convidados **3**.
- [ ] **RN-V19:** A com 5 pedidos (R$100), B com 2 (R$300) → `p_ordem='pedidos'` A, B; `'total'` B, A; pedido
      pendente ou cancelado de A não entra em contagem nem total; `'ultimo'` ordena por `max(criado_em)`.
- [ ] Limite aplicado depois de ordenar: com 25 clientes e `p_limite = 20`, ordenar por total devolve os 20 maiores
      **totais** (não os 20 primeiros por nº de pedidos reordenados).
- [ ] `itens_top` com no máximo 3 itens, por Σ quantidade no período.
- [ ] **RN-V20:** colunas devolvidas = allowlist exata (comparar a lista de colunas; nenhuma `telefone`/`email`).
- [ ] **RN-V21:** dono vê só clientes com pedido na própria loja; cliente que só comprou em outra loja não aparece;
      `asService` → vazio; `asAnon` → erro de permissão (fragmento da mensagem + SQLSTATE).
- [ ] `p_ordem = 'nome'`, `p_limite = 21`, `p_limite = 0` → `22023` com fragmento da mensagem.
- [ ] Teste vermelho com `FAIL` capturado antes da migration; depois verde; tsc limpo.
