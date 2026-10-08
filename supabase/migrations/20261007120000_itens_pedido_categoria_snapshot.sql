-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 353 — migration A1: snapshot da categoria em `itens_pedido`.
-- Spec: specs/relatorio-vendas.md (RN-V14, RN-V15).
-- Plano: plan/tecnico-relatorio-vendas.md §6.1 · D9 (ordem A1 → B → A2).
-- Par: 20261007121000_rpc_criar_pedido_categoria_snapshot.sql (B, a RPC que
--      passa a gravar estas colunas) e 20261007122000_itens_pedido_categoria_backfill.sql
--      (A2, backfill dos itens antigos). Esta vem ANTES: a coluna existe antes
--      de qualquer INSERT que a referencie.
--
-- ADITIVA / EXPAND-ONLY: `ADD COLUMN` nullable sem default é metadata-only em
-- tabela populada. NULL = "Sem categoria" (item sem produto, produto sem
-- categoria ou cadeia que cruza loja).
--
-- SNAPSHOT IMUTÁVEL, SEM FK de propósito: mesma família de `nome`, `preco` e
-- `preco_original`. Renomear, mover ou apagar a categoria depois da venda não
-- muda pedido nenhum (RN-V14). O CHECK de par é defesa em profundidade: a
-- autoridade é a RPC `criar_pedido` (service_role, escopo p_loja_id).
--
-- RLS: nenhuma policy nova. INSERT em `itens_pedido` é exclusivo da RPC
-- (deny-all para anon/authenticated desde 20260708130000). Idempotente.
--
-- Rollback (só depois de reverter B, senão a RPC referencia coluna inexistente):
--   alter table public.itens_pedido
--     drop constraint if exists itens_pedido_categoria_snapshot_par_check,
--     drop column if exists categoria_nome_snapshot,
--     drop column if exists categoria_id_snapshot;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.itens_pedido
  add column if not exists categoria_id_snapshot   uuid,
  add column if not exists categoria_nome_snapshot text;

-- Sem FK de propósito: snapshot imutável, mesma família de nome/preco/preco_original.
alter table public.itens_pedido
  drop constraint if exists itens_pedido_categoria_snapshot_par_check;
alter table public.itens_pedido
  add constraint itens_pedido_categoria_snapshot_par_check
  check ((categoria_id_snapshot is null) = (categoria_nome_snapshot is null));

comment on column public.itens_pedido.categoria_id_snapshot is
  'RN-V14: id da categoria do produto NO MOMENTO da venda, resolvido pela RPC criar_pedido a partir de produto_id + p_loja_id (nunca do payload). Sem FK: snapshot imutavel. NULL = Sem categoria.';
comment on column public.itens_pedido.categoria_nome_snapshot is
  'RN-V14: nome da categoria no momento da venda. Par com categoria_id_snapshot (itens_pedido_categoria_snapshot_par_check).';
