-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 356 — migration D2: ranking de clientes fiéis + contagem de convidados.
-- Spec: specs/relatorio-vendas.md (RN-V17..V21).
-- Plano: plan/tecnico-relatorio-vendas.md §6.6 · D3, D5, D6.
-- Depende de: 20261007124000_relatorio_vendas_funcoes.sql (D1:
--             public.status_faturamento, fonte única do conjunto de status —
--             esta migration NÃO redigita a lista; teste T356-14 trava).
--
-- Molde: 20261003124000_clientes_da_loja.sql. SECURITY DEFINER com
-- `search_path = ''` e toda referência qualificada. Escopo = a loja de
-- auth.uid() como dono; não existe parâmetro de loja. Sob service_role,
-- auth.uid() é NULL e nada casa (vazio / 0).
--   - ranking_clientes_da_loja: ordena e corta NO BANCO (RN-V19, limite 1..20);
--     itens_top calculado só para as linhas do corte. Nome vem de
--     clientes.nome; telefone/email nunca saem. Todos os parâmetros com default
--     para o gen types marcá-los opcionais (D6); p_fim NULL → 22023.
--   - pedidos_convidados_da_loja: função irmã (D5) — pedidos com cliente_id
--     NULL (convidado ou anonimizado, RN-V17) no mesmo escopo e período.
--
-- Grants: revoke de public/anon (toda rotina nasce executável por anon,
-- 20260614008500); EXECUTE para authenticated. service_role mantém o EXECUTE
-- dos default privileges, como em clientes_da_loja. Idempotente.
--
-- Rollback:
--   drop function if exists public.pedidos_convidados_da_loja(timestamptz, timestamptz);
--   drop function if exists public.ranking_clientes_da_loja(timestamptz, timestamptz, text, integer);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ranking_clientes_da_loja(
  p_inicio timestamptz default null,   -- NULL = desde o início
  p_fim    timestamptz default null,   -- obrigatório na prática (NULL → 22023)
  p_ordem  text        default 'pedidos',
  p_limite integer     default 20
)
returns table (
  cliente_id       uuid,
  nome             text,
  total_pedidos    integer,
  total_gasto      numeric,
  ultimo_pedido_em timestamptz,
  itens_top        jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text[] := public.status_faturamento(false);
begin
  if p_fim is null then
    raise exception 'ranking_clientes_da_loja: p_fim obrigatório' using errcode = '22023';
  end if;
  if p_inicio is not null and p_fim <= p_inicio then
    raise exception 'ranking_clientes_da_loja: faixa invertida' using errcode = '22023';
  end if;
  if p_ordem is null or p_ordem not in ('pedidos', 'total', 'ultimo') then
    raise exception 'ranking_clientes_da_loja: p_ordem inválido' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 20 then
    raise exception 'ranking_clientes_da_loja: p_limite fora de 1..20' using errcode = '22023';
  end if;

  -- Escopo = a loja de auth.uid(); sem parâmetro de loja. Sob service_role,
  -- auth.uid() é NULL e nada casa. Toda coluna qualificada (OUT params).
  return query
  with base as (
    select p.cliente_id as cid, p.id as pid, p.total as tot, p.criado_em as em
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id is not null
       and p.status = any (v_status)
       and (p_inicio is null or p.criado_em >= p_inicio)
       and p.criado_em < p_fim
  ),
  agg as (
    select b.cid, count(*)::integer as n, sum(b.tot) as gasto, max(b.em) as ultimo
      from base b
     group by b.cid
  ),
  corte as (                      -- ordena e corta NO BANCO (RN-V19)
    select a.cid, a.n, a.gasto, a.ultimo
      from agg a
     order by case when p_ordem = 'pedidos' then a.n end desc nulls last,
              case when p_ordem = 'ultimo' then a.ultimo end desc nulls last,
              a.gasto desc,
              a.cid asc
     limit p_limite
  )
  select t.cid,
         c.nome,
         t.n,
         t.gasto,
         t.ultimo,
         coalesce((
           select jsonb_agg(jsonb_build_object('nome', x.nome, 'quantidade', x.qtd)
                            order by x.qtd desc, x.nome asc)
             from (select ip.nome, sum(ip.quantidade)::integer as qtd
                     from public.itens_pedido ip
                     join base b2 on b2.pid = ip.pedido_id
                    where b2.cid = t.cid
                    group by ip.nome
                    order by sum(ip.quantidade) desc, ip.nome asc
                    limit 3) x
         ), '[]'::jsonb)
    from corte t
    join public.clientes c on c.id = t.cid
   order by case when p_ordem = 'pedidos' then t.n end desc nulls last,
            case when p_ordem = 'ultimo' then t.ultimo end desc nulls last,
            t.gasto desc,
            t.cid asc;
end;
$$;

create or replace function public.pedidos_convidados_da_loja(
  p_inicio timestamptz default null,
  p_fim    timestamptz default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text[] := public.status_faturamento(false);
begin
  if p_fim is null then
    raise exception 'pedidos_convidados_da_loja: p_fim obrigatório' using errcode = '22023';
  end if;
  if p_inicio is not null and p_fim <= p_inicio then
    raise exception 'pedidos_convidados_da_loja: faixa invertida' using errcode = '22023';
  end if;
  -- Convidado = cliente_id NULL; pedido anonimizado também (RN-V17).
  return (
    select count(*)::integer
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id is null
       and p.status = any (v_status)
       and (p_inicio is null or p.criado_em >= p_inicio)
       and p.criado_em < p_fim
  );
end;
$$;

revoke all on function public.ranking_clientes_da_loja(timestamptz, timestamptz, text, integer) from public, anon;
revoke all on function public.pedidos_convidados_da_loja(timestamptz, timestamptz) from public, anon;
grant execute on function public.ranking_clientes_da_loja(timestamptz, timestamptz, text, integer) to authenticated;
grant execute on function public.pedidos_convidados_da_loja(timestamptz, timestamptz) to authenticated;
