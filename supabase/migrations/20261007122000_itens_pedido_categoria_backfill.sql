-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 353 — migration A2: backfill do snapshot de categoria dos itens antigos.
-- Spec: specs/relatorio-vendas.md (RN-V15: limite aceito).
-- Plano: plan/tecnico-relatorio-vendas.md §6.3 · D9.
-- Depende de: 20261007120000 (A1, colunas) e 20261007121000 (B, RPC que já
--             grava o snapshot). Roda DEPOIS da B de propósito: o backfill só
--             toca `categoria_id_snapshot IS NULL`, então cobre o que nasceu
--             antes e durante a janela e nunca reescreve o que a RPC nova gravou.
--
-- Usa a categoria ATUAL do produto (o histórico real não existe — RN-V15).
-- `produto_id` NULL, produto sem categoria ou cadeia que cruza loja (produto
-- ou categoria de outra loja que não a do pedido) → fica NULL ("Sem categoria").
--
-- Arquivo só com o UPDATE: reexecutável e idempotente (o teste T353-12/13
-- reexecuta este arquivo). Nenhum trigger em `itens_pedido` (conferido), então
-- o UPDATE não dispara efeito colateral. `itens_pedido_opcionais` não é tocado.
--
-- Rollback: nenhum necessário (dado só nas colunas novas; reverter A1 apaga).
-- ─────────────────────────────────────────────────────────────────────────────

update public.itens_pedido ip
   set categoria_id_snapshot   = c.id,
       categoria_nome_snapshot = c.nome
  from public.pedidos p
  join public.produtos pr
    on pr.loja_id = p.loja_id
  join public.categorias c
    on c.id = pr.categoria_id
   and c.loja_id = p.loja_id
 where p.id = ip.pedido_id
   and pr.id = ip.produto_id
   and ip.categoria_id_snapshot is null;
