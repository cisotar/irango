-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 355 — migration D1: funções financeiras do relatório de vendas.
-- Spec: specs/relatorio-vendas.md (RN-V01..05, V09, V13, V16, V21).
-- Plano: plan/tecnico-relatorio-vendas.md §6.5 · D1, D2, D3, D4, D7, D8, D14.
-- Depende de: 20261007120000 (A1, colunas de snapshot lidas por
--             vendas_itens_por_categoria).
--
-- Quatro funções:
--   - status_faturamento(bool) → text[]: FONTE ÚNICA do conjunto de status do
--     faturamento (D3). IMMUTABLE STRICT: null → null → `= any(null)` não casa
--     nada (fail-closed). O ranking (D2, 20261007125000) também lê daqui.
--   - vendas_preparar_consulta(...) → timezone: T1 (forma) + T2 (posse) + fuso
--     da loja lido no banco, uma vez para as duas financeiras (D4).
--   - vendas_por_dia(...): faturamento por dia LOCAL da loja, soma em numeric
--     sobre os valores já gravados no checkout. Fonte única de bruto, descontos,
--     líquido e frete (D7).
--   - vendas_itens_por_categoria(...): itens por categoria CONGELADA (snapshot),
--     valor da linha espelho de totalDaLinha (calcularTotal.ts).
--
-- Segurança (seguranca.md D6, "Quarta instância"): SECURITY INVOKER + T2 de
-- posse no corpo ANTES de qualquer leitura. A RLS de `pedidos` soma
-- `pedidos_acesso_lojista` e `pedidos_select_cliente` por OR: sem T2, um
-- lojista que também é cliente agregaria as próprias compras numa loja alheia.
-- Recusa = 42501 'vendas: sem posse da loja' (D2, mesma mensagem para loja
-- alheia e inexistente: não vira oráculo). Admin (service_role, BYPASSRLS) fica
-- escopado pelo `WHERE loja_id = p_loja_id`. Sem JWT → nega.
-- Faixa obrigatória, p_fim > p_inicio, teto de 367 dias de intervalo (D14).
--
-- Grants: toda rotina nasce executável por anon (default privileges de
-- 20260614008500), então o `revoke … from public, anon` é obrigatório.
-- Nenhum índice novo (pedidos(loja_id, criado_em), itens_pedido(pedido_id),
-- itens_pedido_opcionais(item_pedido_id) já existem). Idempotente.
--
-- Rollback (ordem inversa; reverter D2 antes, que chama status_faturamento):
--   drop function if exists public.vendas_itens_por_categoria(uuid, timestamptz, timestamptz, text, boolean);
--   drop function if exists public.vendas_por_dia(uuid, timestamptz, timestamptz, text, boolean);
--   drop function if exists public.vendas_preparar_consulta(uuid, timestamptz, timestamptz, text, boolean);
--   drop function if exists public.status_faturamento(boolean);
-- ─────────────────────────────────────────────────────────────────────────────

-- D3: fonte única do conjunto de status do faturamento.
create or replace function public.status_faturamento(p_so_concluidos boolean)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select case
           when p_so_concluidos then array['entregue']::text[]
           else array['confirmado', 'em_preparo', 'saiu_entrega', 'entregue']::text[]
         end
$$;

-- D4: T1 (forma) + T2 (posse) + fuso da loja, uma vez para as duas financeiras.
create or replace function public.vendas_preparar_consulta(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  v_tz          text;
begin
  -- T1: forma. Nada é lido antes daqui.
  if p_loja_id is null then
    raise exception 'vendas: loja obrigatória' using errcode = '22023';
  end if;
  if p_inicio is null or p_fim is null then
    raise exception 'vendas: faixa obrigatória' using errcode = '22023';
  end if;
  if p_fim <= p_inicio then
    raise exception 'vendas: faixa invertida' using errcode = '22023';
  end if;
  if p_fim - p_inicio > interval '367 days' then
    raise exception 'vendas: faixa acima do teto' using errcode = '22023';
  end if;
  if p_tipo_entrega is not null and p_tipo_entrega not in ('entrega', 'retirada') then
    raise exception 'vendas: tipo_entrega inválido' using errcode = '22023';
  end if;
  if p_so_concluidos is null then
    raise exception 'vendas: so_concluidos obrigatório' using errcode = '22023';
  end if;

  -- T2: posse ANTES de qualquer leitura de pedido. A RLS sozinha não basta:
  -- pedidos_select_cliente soma por OR e entregaria ao lojista-cliente os
  -- próprios pedidos numa loja alheia. coalesce(auth.role(), '') é fail-closed
  -- (20260918130000).
  if not (
       v_e_servico
    or exists (select 1 from public.lojas l where l.id = p_loja_id and l.dono_id = auth.uid())
  ) then
    raise exception 'vendas: sem posse da loja' using errcode = '42501';
  end if;

  select l.timezone into v_tz from public.lojas l where l.id = p_loja_id;
  return v_tz;   -- NULL = loja inexistente (só alcançável pela via de serviço)
end;
$$;

create or replace function public.vendas_por_dia(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns table (
  dia                  date,
  qtd_pedidos          integer,
  bruto                numeric,
  descontos            numeric,
  liquido              numeric,
  frete                numeric,
  qtd_frete_a_combinar integer
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_status text[];
begin
  v_tz := public.vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos);
  if v_tz is null then
    return;
  end if;
  v_status := public.status_faturamento(p_so_concluidos);

  return query
  select (p.criado_em at time zone v_tz)::date,
         count(*)::integer,
         sum(p.subtotal),
         sum(p.desconto),
         sum(greatest(0, p.subtotal - p.desconto)),
         coalesce(sum(p.taxa_entrega), 0),
         (count(*) filter (where p.taxa_entrega is null))::integer
    from public.pedidos p
   where p.loja_id = p_loja_id
     and p.criado_em >= p_inicio
     and p.criado_em <  p_fim
     and p.status = any (v_status)
     and (p_tipo_entrega is null or p.tipo_entrega = p_tipo_entrega)
   group by 1
   order by 1;
end;
$$;

create or replace function public.vendas_itens_por_categoria(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns table (
  categoria_id          uuid,
  categoria_nome        text,
  item_nome             text,
  quantidade            integer,
  valor_bruto           numeric,
  categoria_quantidade  integer,
  categoria_valor_bruto numeric
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_status text[];
begin
  v_tz := public.vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos);
  if v_tz is null then
    return;
  end if;
  v_status := public.status_faturamento(p_so_concluidos);

  -- Valor bruto da LINHA = espelho de totalDaLinha (calcularTotal.ts:39-51):
  -- round(preco × qtd, 2) + Σ round(opcional.preco × opcional.qtd, 2); opcional
  -- soma UMA vez por linha (regra 090). Desconto é do pedido: não é rateado.
  -- Toda coluna qualificada: os OUT params (quantidade, categoria_id…) são variáveis.
  return query
  with linhas as (
    select ip.categoria_id_snapshot  as cat_id,
           ip.categoria_nome_snapshot as cat_nome,
           ip.nome                    as item,
           ip.quantidade              as qtd,
           round(ip.preco * ip.quantidade, 2)
             + coalesce((select sum(round(o.preco_snapshot * o.quantidade, 2))
                           from public.itens_pedido_opcionais o
                          where o.item_pedido_id = ip.id), 0) as valor
      from public.itens_pedido ip
      join public.pedidos p on p.id = ip.pedido_id
     where p.loja_id = p_loja_id
       and p.criado_em >= p_inicio
       and p.criado_em <  p_fim
       and p.status = any (v_status)
       and (p_tipo_entrega is null or p.tipo_entrega = p_tipo_entrega)
  ),
  por_item as (
    select l.cat_id, l.cat_nome, l.item,
           sum(l.qtd)::integer as qtd,
           sum(l.valor)        as valor
      from linhas l
     group by l.cat_id, l.cat_nome, l.item
  ),
  com_categoria as (
    select x.cat_id, x.cat_nome, x.item, x.qtd, x.valor,
           (sum(x.qtd) over w)::integer as cat_qtd,
           sum(x.valor) over w          as cat_valor
      from por_item x
    window w as (partition by x.cat_id, x.cat_nome)
  )
  select c.cat_id, c.cat_nome, c.item, c.qtd, c.valor, c.cat_qtd, c.cat_valor
    from com_categoria c
   order by (c.cat_id is null), c.cat_valor desc, c.cat_nome, c.cat_id, c.qtd desc, c.valor desc, c.item;
end;
$$;

revoke all on function public.status_faturamento(boolean) from public, anon;
revoke all on function public.vendas_preparar_consulta(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.vendas_por_dia(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.vendas_itens_por_categoria(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.status_faturamento(boolean) to authenticated, service_role;
grant execute on function public.vendas_preparar_consulta(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
grant execute on function public.vendas_por_dia(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
grant execute on function public.vendas_itens_por_categoria(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
