-- Issue 208 — RPC de reordenação dos grupos de opcional de UMA categoria de
-- produto. Espelho de `reordenar_categorias` (20260908120000) já nascendo com a
-- correção de `cardinality()` (20260908130000) — não repetimos o erro para
-- depois corrigi-lo.
--
-- Por que RPC e não supabase-js: PostgREST não faz update-many com valor
-- DIFERENTE POR LINHA; `.upsert()` reescreveria a LINHA INTEIRA e um id
-- inexistente inseriria associação fantasma; N updates sequenciais não são
-- atômicos.
--
-- SECURITY INVOKER, nunca DEFINER: `p_loja_id` é um parâmetro escolhido pelo
-- chamador. Sob DEFINER um lojista reescreveria a ordem de OUTRA loja só
-- trocando o argumento. Sob INVOKER a policy `cat_prod_opc_escrita_propria`
-- (20260614007500_opcionais.sql:152, `for all` em lojas.dono_id = auth.uid())
-- continua valendo dentro da função e o UPDATE simplesmente não vê a linha
-- alheia → row_count diverge → raise.
--
-- DIFERENÇA ESTRUTURAL para `reordenar_categorias`: lá o escopo da permutação é
-- a LOJA INTEIRA; aqui é o PAR (loja, categoria de produto). O mesmo grupo de
-- opcional pode estar associado a várias categorias de produto com posições
-- diferentes (RN-10), e o casamento é por `categoria_opcional_id` (não pela PK
-- da associação) — o `unique (categoria_id, categoria_opcional_id)` garante no
-- máximo uma linha por par, então o UPDATE nunca fica ambíguo.
--
-- Rollback: drop function if exists
--   public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[]);
-- Sem perda de dado (a função não guarda estado). Tem que vir ANTES do
-- `drop column ordem` da migration 20260917120000.

create or replace function public.reordenar_opcionais_da_categoria(
  p_loja_id      uuid,
  p_categoria_id uuid,
  p_ids          uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- cardinality(), NUNCA array_length(p_ids, 1): array_length conta só a
  -- primeira dimensão, enquanto o `unnest` entrega TODOS os elementos. Um
  -- array[[a,b],[c,a],[b,c]] passaria as duas checagens e gravaria `ordem`
  -- [0,2,4], quebrando a invariante 0..n-1. O coalesce também cobre p_ids null,
  -- que faria toda comparação virar NULL (nem raise, nem update — silêncio).
  v_enviadas int := coalesce(cardinality(p_ids), 0);
  v_no_par   int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_opcionais_da_categoria: lista vazia';
  end if;

  -- PERMUTAÇÃO COMPLETA do PAR (loja, categoria de produto) — não da loja.
  -- Normalizar 0..n-1 sobre um SUBCONJUNTO reintroduziria o empate de `ordem`
  -- que esta feature existe para eliminar.
  select count(*) into v_no_par
    from public.categoria_produto_opcionais
   where loja_id = p_loja_id
     and categoria_id = p_categoria_id;
  if v_no_par <> v_enviadas then
    raise exception 'reordenar_opcionais_da_categoria: % ids para % associacoes',
      v_enviadas, v_no_par;
  end if;

  -- `ordem` é DERIVADA do índice no servidor (ordinality - 1). O cliente manda
  -- só a sequência de ids — nunca valores de ordem nem loja_id.
  update public.categoria_produto_opcionais cpo
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where cpo.categoria_opcional_id = e.id
     and cpo.loja_id = p_loja_id          -- escopo explícito ALÉM da RLS
     and cpo.categoria_id = p_categoria_id;
  get diagnostics v_afetadas = row_count;

  -- Id de outra loja, inexistente, duplicado ou de OUTRA categoria de produto →
  -- menos linhas do que ids. A exceção derruba a transação inteira: escrita
  -- parcial é impossível e nada é gravado em nenhuma das lojas.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_opcionais_da_categoria: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto NÃO
-- tem `alter default privileges ... on functions`. Sem este revoke, anon
-- executaria a RPC direto em /rest/v1/rpc/ com a anon key do bundle público.
revoke all on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  to authenticated, service_role;
