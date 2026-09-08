-- Issue 175 — reordenação de categorias de produtos (fase GREEN).
--
-- `public.reordenar_categorias(p_loja_id, p_ids)` grava `ordem` normalizada
-- 0..n-1 para TODAS as categorias da loja numa ÚNICA instrução atômica.
--
-- Por que uma função e não supabase-js: PostgREST não faz update-many com valor
-- DIFERENTE POR LINHA. As alternativas foram reprovadas por mérito:
--   - `.upsert(..., { onConflict: "id" })` reescreveria a LINHA INTEIRA (nome e
--     loja_id são not null sem default) → uma renomeação concorrente em
--     GerenciarCategorias seria silenciosamente revertida; e upsert é
--     INSERT ... ON CONFLICT, então um id inexistente inseriria categoria fantasma;
--   - N updates sequenciais não são atômicos: uma falha no meio deixa `ordem`
--     duplicada — exatamente o bug que esta feature existe para matar.
--
-- SECURITY INVOKER, não DEFINER: a política `categorias_escrita_propria`
-- (20260614002000_rls_catalogo.sql — `for all`, `using` E `with check` em
-- lojas.dono_id = auth.uid()) precisa continuar valendo DENTRO da função. O
-- `where c.loja_id = p_loja_id` é a SEGUNDA camada, no espírito de
-- `categoriaPertenceALoja` (src/lib/actions/produto.ts): a FK só garante que a
-- categoria existe em ALGUMA loja.
--
-- Nenhuma tabela, coluna, índice ou policy nova: `categorias.ordem` já existe
-- (20260614000129_schema_inicial.sql) e o índice `categorias_loja_ordem`
-- (loja_id, ordem) já existe (20260614010000_indexes.sql).

create or replace function public.reordenar_categorias(
  p_loja_id uuid,
  p_ids     uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_enviadas int := coalesce(array_length(p_ids, 1), 0);
  v_na_loja  int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_categorias: lista vazia';
  end if;

  -- A lista tem que ser a PERMUTAÇÃO COMPLETA das categorias da loja.
  -- Normalizar 0..n-1 sobre um SUBCONJUNTO reintroduziria o empate de `ordem`
  -- que esta feature existe para eliminar (as não enviadas manteriam a ordem
  -- antiga e colidiriam com as novas).
  select count(*) into v_na_loja
    from public.categorias where loja_id = p_loja_id;
  if v_na_loja <> v_enviadas then
    raise exception 'reordenar_categorias: % ids para % categorias', v_enviadas, v_na_loja;
  end if;

  -- `ordem` é DERIVADA do índice no servidor (ordinality - 1). O cliente manda
  -- só a sequência de ids — nunca valores de ordem, nome ou loja_id.
  update public.categorias c
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where c.id = e.id
     and c.loja_id = p_loja_id;   -- escopo explícito ALÉM da RLS
  get diagnostics v_afetadas = row_count;

  -- Id de OUTRA loja, inexistente ou duplicado → menos linhas do que ids.
  -- A exceção derruba a transação inteira: escrita parcial é impossível, e
  -- nada é escrito em nenhuma das duas lojas.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_categorias: % ids, % linhas afetadas', v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova, e o projeto
-- NÃO tem `alter default privileges ... on functions` (só para tables e
-- sequences — 20260702150000 e 20260708140000). Sem este revoke, anon executaria.
revoke all on function public.reordenar_categorias(uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_categorias(uuid, uuid[]) to authenticated, service_role;
