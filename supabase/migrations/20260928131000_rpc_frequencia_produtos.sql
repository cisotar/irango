-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 322 — RPCs de escrita em lote da frequência de exibição dos produtos.
-- Spec: specs/frequencia-exibicao.md (RN-5 escrita escopada, RN-6 grade atômica,
--       RN-8 '{}' = nunca).
-- Plano: plan/tecnico-frequencia-exibicao.md (C1, D6, D13).
--
--   aplicar_frequencia_em_produtos(p_loja_id, p_ids, p_frequencia) → integer
--     a MESMA frequência (5 eixos) em N produtos (seleção múltipla; unitária =
--     1 id). Não existe terceiro caminho.
--   salvar_grade_de_dias(p_loja_id, p_itens) → integer
--     grade produto × dia: `dias_semana` POR LINHA. Toca SÓ `dias_semana` —
--     hora e período de outra aba sobrevivem.
--
-- Por que RPC: PostgREST não faz update-many com valor diferente por linha, e
-- `.in(ids)` ignora id alheio em silêncio (a prova exige recusa + zero linhas).
--
-- SECURITY INVOKER (D6), precedente literal `reordenar_produtos` (20260922120000):
--   - lojista: a RLS `produtos_escrita_propria` vale dentro da função. Com
--     `p_loja_id` alheio a RLS zera as linhas, a contagem diverge e a exceção
--     desfaz tudo;
--   - admin (service_role, BYPASSRLS): `p.loja_id = p_loja_id` com o `lojaId`
--     do `prepararContextoAdmin` + `row_count = cardinality` — a mesma garantia
--     que `EscopoLoja` dá (`.eq("loja_id")` + count).
--   Divergência registrada com seguranca.md ("DEFINER quando a via admin
--   precisa do mesmo caminho"): aquela regra nasceu de RPCs cujo corpo não
--   filtrava tenant. Aqui o corpo filtra, e DEFINER TIRARIA a RLS do lojista.
--
-- D13 (RN-8): `jsonb_to_record(set)` converte `[]` em '{}' e `null` em NULL,
-- mas CHAVE AUSENTE também vira NULL ("todo dia" em silêncio). Por isso as duas
-- exigem a chave PRESENTE. Nenhuma usa coalesce/cardinality sobre dias_semana.
--
-- Mensagens de erro são internas (a Server Action loga e devolve genérica —
-- "linhas afetadas" seria oráculo de existência, seguranca.md §14).
--
-- ROLLBACK: drop function if exists
--   public.aplicar_frequencia_em_produtos(uuid, uuid[], jsonb),
--   public.salvar_grade_de_dias(uuid, jsonb);
-- Sem perda de dado (as funções não guardam estado).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.aplicar_frequencia_em_produtos(
  p_loja_id     uuid,
  p_ids         uuid[],
  p_frequencia  jsonb
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- cardinality, nunca array_length (conta só a 1ª dimensão, NULL em vazio);
  -- o coalesce cobre p_ids null.
  v_enviadas int := coalesce(cardinality(p_ids), 0);
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'aplicar_frequencia_em_produtos: lista vazia';
  end if;

  -- espelha TETO_LOTE (src/lib/validacoes/produto.ts)
  if v_enviadas > 200 then
    raise exception 'aplicar_frequencia_em_produtos: lista acima do teto';
  end if;

  if (select count(distinct x) from unnest(p_ids) as x) <> v_enviadas then
    raise exception 'aplicar_frequencia_em_produtos: ids repetidos';
  end if;

  -- D13: as 5 chaves PRESENTES (null explícito = sem restrição; ausente = recusa).
  if p_frequencia is null
     or jsonb_typeof(p_frequencia) <> 'object'
     or not (p_frequencia ?& array['dias_semana','hora_inicio','hora_fim','periodo_inicio','periodo_fim'])
  then
    raise exception 'aplicar_frequencia_em_produtos: frequencia invalida';
  end if;

  -- Valor fora do domínio ([7], hora_fim <= hora_inicio) cai nos CHECKs da 130000
  -- (23514) e derruba a transação inteira; valor inválido ("x") dá 22P02.
  update public.produtos p
     set dias_semana    = f.dias_semana,
         hora_inicio    = f.hora_inicio,
         hora_fim       = f.hora_fim,
         periodo_inicio = f.periodo_inicio,
         periodo_fim    = f.periodo_fim
    from jsonb_to_record(p_frequencia) as f(
           dias_semana    smallint[],
           hora_inicio    time,
           hora_fim       time,
           periodo_inicio date,
           periodo_fim    date
         )
   where p.id = any(p_ids)
     and p.loja_id = p_loja_id;             -- escopo explícito ALÉM da RLS
  get diagnostics v_afetadas = row_count;

  -- Id de outra loja (RLS ou filtro) ou inexistente ⇒ menos linhas do que ids.
  -- A exceção desfaz tudo: nada é gravado em nenhuma loja.
  if v_afetadas <> v_enviadas then
    raise exception 'aplicar_frequencia_em_produtos: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

create or replace function public.salvar_grade_de_dias(
  p_loja_id  uuid,
  p_itens    jsonb
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_enviadas int;
  v_distintos int;
  v_afetadas int;
begin
  if p_itens is null
     or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0
  then
    raise exception 'salvar_grade_de_dias: lista vazia';
  end if;

  v_enviadas := jsonb_array_length(p_itens);

  -- espelha TETO_LOTE (src/lib/validacoes/produto.ts)
  if v_enviadas > 200 then
    raise exception 'salvar_grade_de_dias: lista acima do teto';
  end if;

  -- D13: cada elemento é objeto com as chaves produto_id E dias_semana.
  if exists (
    select 1
      from jsonb_array_elements(p_itens) as e
     where jsonb_typeof(e) <> 'object'
        or not (e ? 'produto_id')
        or not (e ? 'dias_semana')
  ) then
    raise exception 'salvar_grade_de_dias: item incompleto';
  end if;

  -- count(distinct) ignora NULL: produto_id nulo ou repetido ⇒ distintos < enviadas.
  select count(distinct x.produto_id)
    into v_distintos
    from jsonb_to_recordset(p_itens) as x(produto_id uuid);
  if v_distintos <> v_enviadas then
    raise exception 'salvar_grade_de_dias: ids repetidos ou ausentes';
  end if;

  update public.produtos p
     set dias_semana = x.dias_semana
    from jsonb_to_recordset(p_itens) as x(produto_id uuid, dias_semana smallint[])
   where p.id = x.produto_id
     and p.loja_id = p_loja_id;             -- escopo explícito ALÉM da RLS
  get diagnostics v_afetadas = row_count;

  if v_afetadas <> v_enviadas then
    raise exception 'salvar_grade_de_dias: % itens, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova. Sem este
-- revoke, anon executaria as RPCs em /rest/v1/rpc/ com a anon key do bundle.
revoke all on function public.aplicar_frequencia_em_produtos(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.aplicar_frequencia_em_produtos(uuid, uuid[], jsonb) to authenticated, service_role;

revoke all on function public.salvar_grade_de_dias(uuid, jsonb) from public, anon;
grant execute on function public.salvar_grade_de_dias(uuid, jsonb) to authenticated, service_role;
