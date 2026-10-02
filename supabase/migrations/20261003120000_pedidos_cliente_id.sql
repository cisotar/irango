-- Issue 341 / spec specs/cliente-vinculo-pedido.md §Modelos de Dados (Marco C, P25).
-- Vincula pedido ao cliente final logado: coluna `pedidos.cliente_id`, índice
-- parcial para "meus pedidos", trigger de imutabilidade e 3 policies SÓ SELECT
-- para o cliente ler os próprios pedidos/itens/opcionais (RN-C03/C04/C05).
-- `pedidos_acesso_lojista` NÃO é tocada. Nenhuma escrita nova para o cliente.
-- Aditiva (coluna nullable, sem default, sem backfill): pedidos existentes ficam
-- como convidado (null). Idempotente.
--
-- Rollback (janela segura: até existir pedido com cliente_id gravado; depois
-- disso o vínculo se perde — o pedido segue íntegro como convidado):
--   drop policy if exists "itens_pedido_opcionais_select_cliente" on public.itens_pedido_opcionais;
--   drop policy if exists "itens_pedido_select_cliente" on public.itens_pedido;
--   drop policy if exists "pedidos_select_cliente" on public.pedidos;
--   drop trigger if exists pedidos_cliente_id_imutavel_trg on public.pedidos;
--   drop function if exists public.pedidos_cliente_id_imutavel();
--   drop index if exists public.pedidos_cliente_id_criado_em_idx;
--   alter table public.pedidos drop column if exists cliente_id;  -- só após reverter a RPC de 18 args

alter table public.pedidos
  add column if not exists cliente_id uuid null
  references public.clientes (id) on delete set null;

create index if not exists pedidos_cliente_id_criado_em_idx
  on public.pedidos (cliente_id, criado_em desc)
  where cliente_id is not null;

-- Imutabilidade: a policy FOR ALL do lojista alcança a linha inteira, então só
-- um trigger impede reescrever o vínculo. SECURITY INVOKER de propósito (mesmo
-- motivo de 20260930130000): com DEFINER, current_user viraria o dono.
create or replace function public.pedidos_cliente_id_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if new.cliente_id is distinct from old.cliente_id then
    raise exception 'cliente_id do pedido é imutável' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.pedidos_cliente_id_imutavel() from public, anon, authenticated;

drop trigger if exists pedidos_cliente_id_imutavel_trg on public.pedidos;
create trigger pedidos_cliente_id_imutavel_trg
  before update on public.pedidos
  for each row
  execute function public.pedidos_cliente_id_imutavel();

-- ── RLS: leitura do cliente (só SELECT, só authenticated) ───────────────────
drop policy if exists "pedidos_select_cliente" on public.pedidos;
create policy "pedidos_select_cliente" on public.pedidos
  for select to authenticated
  using (cliente_id = (select auth.uid()));

drop policy if exists "itens_pedido_select_cliente" on public.itens_pedido;
create policy "itens_pedido_select_cliente" on public.itens_pedido
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos p
       where p.id = itens_pedido.pedido_id
         and p.cliente_id = (select auth.uid())
    )
  );

drop policy if exists "itens_pedido_opcionais_select_cliente" on public.itens_pedido_opcionais;
create policy "itens_pedido_opcionais_select_cliente" on public.itens_pedido_opcionais
  for select to authenticated
  using (
    exists (
      select 1 from public.itens_pedido ip
        join public.pedidos p on p.id = ip.pedido_id
       where ip.id = itens_pedido_opcionais.item_pedido_id
         and p.cliente_id = (select auth.uid())
    )
  );
