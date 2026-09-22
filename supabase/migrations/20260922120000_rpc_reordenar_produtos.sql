-- Issue 293 — RPC de reordenação dos PRODUTOS de UMA categoria da loja.
-- Espelho estrutural de `reordenar_opcionais_da_categoria` (20260917121000): o
-- escopo da permutação é o PAR (loja, categoria), não a loja inteira.
--
-- Por que RPC e não supabase-js: PostgREST não faz update-many com valor
-- DIFERENTE POR LINHA; `.upsert()` reescreveria a LINHA INTEIRA (e um id
-- inexistente inseriria produto fantasma); N updates sequenciais não são
-- atômicos — uma falha no meio deixaria metade da categoria reordenada, sem o
-- lojista saber qual metade. (`reordenarProdutosAdmin` ainda faz o `for`
-- sequencial: é o débito registrado em tasks/292, fora do escopo desta issue.)
--
-- SECURITY INVOKER, nunca DEFINER: `p_loja_id` é um parâmetro escolhido pelo
-- chamador. Sob DEFINER um lojista reescreveria a ordem de OUTRA loja só
-- trocando o argumento. Sob INVOKER a policy `produtos_escrita_propria`
-- (20260614002000_rls_catalogo.sql:74, `for all` em lojas.dono_id = auth.uid())
-- continua valendo dentro da função: nem o SELECT de contagem nem o UPDATE
-- enxergam a linha alheia → a contagem do par diverge (ou, se divergisse só
-- depois, o row_count) → raise → transação derrubada.
--
-- DIFERENÇA para a irmã 20260917121000: `produtos.categoria_id` é NULLABLE
-- (`on delete set null`) e o grupo "Sem categoria" da vitrine/painel é
-- exatamente `categoria_id IS NULL`. `categoria_id = p_categoria_id` com os
-- dois NULL é NULL, não `true` — a contagem daria 0 e o UPDATE não casaria
-- nada. Por isso `IS NOT DISTINCT FROM` nas DUAS pontas (contagem e WHERE).
--
-- Rollback: drop function if exists
--   public.reordenar_produtos(uuid, uuid, uuid[]);
-- Sem perda de dado (a função não guarda estado; `produtos.ordem` continua
-- como está no momento do drop).

create or replace function public.reordenar_produtos(
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
  -- primeira dimensão (e é NULL em array vazio), enquanto o `unnest` entrega
  -- TODOS os elementos. O coalesce também cobre p_ids null, que faria toda
  -- comparação virar NULL — nem raise, nem update, silêncio.
  v_enviadas int := coalesce(cardinality(p_ids), 0);
  v_no_par   int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_produtos: lista vazia';
  end if;

  -- PERMUTAÇÃO COMPLETA do PAR (loja, categoria) — não da loja. Normalizar
  -- 0..n-1 sobre um SUBCONJUNTO reintroduziria o empate de `ordem` que esta
  -- feature existe para eliminar (os não enviados manteriam a ordem antiga).
  select count(*) into v_no_par
    from public.produtos
   where loja_id = p_loja_id
     and categoria_id is not distinct from p_categoria_id;
  if v_no_par <> v_enviadas then
    raise exception 'reordenar_produtos: % ids para % produtos',
      v_enviadas, v_no_par;
  end if;

  -- `ordem` é DERIVADA do índice no servidor (ordinality - 1). O cliente manda
  -- só a sequência de ids — nunca valores de ordem nem loja_id.
  update public.produtos p
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where p.id = e.id
     and p.loja_id = p_loja_id              -- escopo explícito ALÉM da RLS
     and p.categoria_id is not distinct from p_categoria_id;
  get diagnostics v_afetadas = row_count;

  -- Id de outra loja, inexistente, duplicado ou de OUTRA categoria → menos
  -- linhas do que ids. A exceção derruba a transação inteira: escrita parcial é
  -- impossível e nada é gravado em nenhuma das lojas.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_produtos: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto NÃO
-- tem `alter default privileges ... on functions`. Sem este revoke, anon
-- executaria a RPC direto em /rest/v1/rpc/ com a anon key do bundle público.
-- Defesa em profundidade: sob INVOKER a RLS já barraria a escrita de anon.
revoke all on function public.reordenar_produtos(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_produtos(uuid, uuid, uuid[])
  to authenticated, service_role;
