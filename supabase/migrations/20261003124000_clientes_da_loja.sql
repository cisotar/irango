-- 346 — base de clientes do lojista (camada banco).
-- Spec: specs/cliente-base-do-lojista.md §Banco · tasks/346 (D1, D9).
--
-- Duas funções SECURITY DEFINER escopadas pela loja do usuário autenticado
-- (lojas.dono_id = auth.uid()); RETURNS TABLE fechado (allowlist de 10 colunas:
-- sem email, sem ano/data de nascimento). RLS de public.clientes NÃO é ampliada.
-- total_pedidos exclui cancelados; total_cancelados os conta; ultimo_pedido_em /
-- ultimo_pedido_status = pedido mais recente de qualquer status (D9).
-- Cliente sem pedido na loja não entra; anonimizado some (cliente_id zerado).
--
-- Rollback (sem perda de dado — só funções e índice):
--   drop function if exists public.clientes_da_loja(smallint, integer, integer);
--   drop function if exists public.cliente_da_loja(uuid);
--   drop index if exists public.pedidos_loja_cliente_idx;

create index if not exists pedidos_loja_cliente_idx
  on public.pedidos (loja_id, cliente_id)
  where cliente_id is not null;

create or replace function public.clientes_da_loja(
  p_mes smallint default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table (
  cliente_id uuid,
  nome text,
  telefone text,
  dia_aniversario integer,
  mes_aniversario integer,
  aceita_marketing boolean,
  total_pedidos integer,
  total_cancelados integer,
  ultimo_pedido_em timestamptz,
  ultimo_pedido_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_mes is not null and (p_mes < 1 or p_mes > 12) then
    raise exception 'p_mes inválido' using errcode = '22023';
  end if;

  return query
  with agg as (
    select p.cliente_id as cid,
           count(*) filter (where p.status::text <> 'cancelado')::int as validos,
           count(*) filter (where p.status::text = 'cancelado')::int as cancelados,
           max(p.criado_em) as ultimo
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id is not null
     group by p.cliente_id
  )
  select c.id,
         c.nome,
         c.telefone,
         extract(day from c.data_nascimento)::int,
         extract(month from c.data_nascimento)::int,
         c.aceita_marketing,
         a.validos,
         a.cancelados,
         a.ultimo,
         (select p2.status::text
            from public.pedidos p2
            join public.lojas l2 on l2.id = p2.loja_id
           where l2.dono_id = (select auth.uid())
             and p2.cliente_id = c.id
           order by p2.criado_em desc
           limit 1)
    from agg a
    join public.clientes c on c.id = a.cid
   where p_mes is null or extract(month from c.data_nascimento)::int = p_mes
   order by a.ultimo desc, c.id
   limit least(greatest(coalesce(p_limite, 50), 0), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.cliente_da_loja(p_cliente_id uuid)
returns table (
  cliente_id uuid,
  nome text,
  telefone text,
  dia_aniversario integer,
  mes_aniversario integer,
  aceita_marketing boolean,
  total_pedidos integer,
  total_cancelados integer,
  ultimo_pedido_em timestamptz,
  ultimo_pedido_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with ped as (
    select p.status::text as status, p.criado_em
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id = p_cliente_id
  )
  select c.id,
         c.nome,
         c.telefone,
         extract(day from c.data_nascimento)::int,
         extract(month from c.data_nascimento)::int,
         c.aceita_marketing,
         (select count(*) from ped where status <> 'cancelado')::int,
         (select count(*) from ped where status = 'cancelado')::int,
         (select max(criado_em) from ped),
         (select status from ped order by criado_em desc limit 1)
    from public.clientes c
   where c.id = p_cliente_id
     and exists (select 1 from ped);
$$;

revoke all on function public.clientes_da_loja(smallint, integer, integer) from public, anon;
revoke all on function public.cliente_da_loja(uuid) from public, anon;
grant execute on function public.clientes_da_loja(smallint, integer, integer) to authenticated;
grant execute on function public.cliente_da_loja(uuid) to authenticated;
