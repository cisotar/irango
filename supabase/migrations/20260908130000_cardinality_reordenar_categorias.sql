-- Issue 175 — corrige a checagem de permutação completa em
-- `public.reordenar_categorias` (achado BAIXA da auditoria de segurança).
--
-- `array_length(p_ids, 1)` conta SÓ a primeira dimensão. Um array multi-
-- dimensional passa pela checagem declarando menos elementos do que o `unnest`
-- de fato entrega:
--
--   array[[a1,b1],[a2,b2],[a3,b1]]  →  array_length(...,1) = 3, unnest = 6
--
-- Com 3 categorias na loja, `3 = 3` passava, e o update escrevia `ordem` a
-- partir de 6 posições de ordinality: a invariante 0..n-1 virava [0,2,4].
-- Sem vazamento entre lojas (o `where loja_id` + RLS seguram, e a auditoria
-- provou que a loja alheia fica intacta) — o dano é só na integridade da
-- PRÓPRIA loja.
--
-- `cardinality()` conta TODOS os elementos, em todas as dimensões. O caso acima
-- passa a ser 6 <> 3 → raise.
--
-- A Server Action nunca foi o caminho: o zod (`z.array(z.guid())`) rejeita
-- array aninhado. O vetor é a chamada direta a /rest/v1/rpc/ com a anon key,
-- que está no bundle público.
--
-- Só o corpo da função muda. Permissões não são reaplicadas: `create or replace`
-- preserva a ACL de 20260908120000 (revoke de public/anon, grant a
-- authenticated/service_role).

create or replace function public.reordenar_categorias(
  p_loja_id uuid,
  p_ids     uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_enviadas int := coalesce(cardinality(p_ids), 0);
  v_na_loja  int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_categorias: lista vazia';
  end if;

  select count(*) into v_na_loja
    from public.categorias where loja_id = p_loja_id;
  if v_na_loja <> v_enviadas then
    raise exception 'reordenar_categorias: % ids para % categorias', v_enviadas, v_na_loja;
  end if;

  update public.categorias c
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where c.id = e.id
     and c.loja_id = p_loja_id;
  get diagnostics v_afetadas = row_count;

  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_categorias: % ids, % linhas afetadas', v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;
