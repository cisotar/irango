-- Issue 341 / spec specs/cliente-vinculo-pedido.md §"cupons — coluna nova" (decisões 9 e 9-A).
-- `cupons.limite_por_cliente`: null = sem limite por cliente (regra global de hoje);
-- 1..1000 = quantos pedidos cada cliente logado pode fazer com o cupom na loja.
-- Aditiva, nullable, sem backfill. RLS de cupons inalterada (cupons_acesso_proprio
-- já cobre a coluna nova). Idempotente.
--
-- Rollback (janela segura: até algum lojista gravar um limite; depois disso o
-- limite configurado se perde):
--   alter table public.cupons drop constraint if exists cupons_limite_por_cliente_check;
--   alter table public.cupons drop column if exists limite_por_cliente;  -- só após reverter a RPC de 18 args

alter table public.cupons
  add column if not exists limite_por_cliente integer null;

alter table public.cupons drop constraint if exists cupons_limite_por_cliente_check;
alter table public.cupons
  add constraint cupons_limite_por_cliente_check
  check (limite_por_cliente is null or limite_por_cliente between 1 and 1000);
