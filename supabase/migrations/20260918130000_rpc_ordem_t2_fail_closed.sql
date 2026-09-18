-- Issue 215 (auditoria pós-implementação) — corrige FAIL-OPEN na trava T2 das
-- duas RPCs `security definer` de ordem, e fixa `pg_temp` no search_path.
--
-- ─────────────────────────────────────────────────── O bug (achado 1 da auditoria)
-- `auth.role()` devolve NULL quando não há JWT — conferido contra o cloud por
-- `supabase db dump --schema auth`, e é o comportamento real do Supabase, não
-- uma suposição. Com NULL:
--
--   auth.role() = 'service_role'         -> NULL
--   v_e_servico                          -> NULL (NULL and true)
--   not (NULL or false)                  -> NULL
--   if NULL then raise ...               -> NÃO dispara (plpgsql trata como else)
--
-- ou seja, o UPDATE rodava. A trava que substitui a RLS perdida com o DEFINER
-- aceitava por OMISSÃO, exatamente o oposto do que o comentário dela afirmava
-- ("Fail-closed por construção").
--
-- Não era alcançável pela superfície PostgREST, que sempre fixa o role da
-- sessão em anon/authenticated/service_role — os dois primeiros zeram o sinal 2
-- e o terceiro traz JWT. Era alcançável por todo chamador de DENTRO do banco:
-- SQL editor como postgres, pg_cron, trigger, ou outra função `definer` que
-- venha a envolver estas. Todos privilegiados hoje; nenhum garantidamente
-- privilegiado amanhã, e é para esse amanhã que a trava existe.
--
-- Fix: `coalesce(auth.role(), '')`, que torna a comparação false em vez de NULL.
-- Regressão travada por [215-I19] e [211-G6] (pglite), que só podem existir
-- porque `tests/helpers/pglite.ts` passou a definir `auth.uid()`/`auth.role()`
-- com a definição FIEL do cloud — o harness antigo fazia coalesce(..., 'anon')
-- e nunca devolvia NULL, escondendo o bug de todas as 21 asserções da 215.
--
-- ───────────────────────────────────────────── pg_temp (achado 6 da auditoria)
-- `set search_path = public` deixa o Postgres buscar `pg_temp` implicitamente
-- ANTES de public. Hoje é inofensivo porque todo nome no corpo é
-- schema-qualificado, mas um `update opcionais ...` sem o `public.` numa edição
-- futura reabriria o vetor de shadow por tabela temporária. `pg_temp` explícito
-- e por último fecha isso por construção, em vez de depender de disciplina.
--
-- Rollback: nova migration com `create or replace` restaurando os corpos de
-- 20260918120000 e 20260918121000. Reabre o fail-open — não fazer sem motivo.
-- Nenhuma das duas funções guarda estado; sem perda de dado em qualquer sentido.
--
-- Assinaturas, ACL e grants INALTERADOS: este arquivo só troca corpo e config.

create or replace function public.reordenar_itens_do_grupo_opcional(
  p_loja_id               uuid,
  p_categoria_opcional_id uuid,
  p_ids                   uuid[]
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- cardinality(), NUNCA array_length(p_ids, 1): array_length conta só a
  -- primeira dimensão enquanto o `unnest` entrega TODOS os elementos —
  -- array[[a,b],[c,a],[b,c]] passaria as checagens e gravaria `ordem` [0,2,4],
  -- quebrando a invariante 0..n-1. O coalesce cobre p_ids null.
  v_enviadas    int  := coalesce(cardinality(p_ids), 0);
  v_no_grupo    int;
  v_afetadas    int;
  -- Sinal 1: claim `role` do JWT já verificado pelo PostgREST.
  -- Sinal 2: role efetivo da sessão. `current_user` NÃO serve dentro de uma
  -- função DEFINER (vale o DONO da função, não o chamador) — verificado; o
  -- mesmo vale para `row_security_active()`, sempre false aqui.
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
begin
  -- ── T1: lista não vazia ───────────────────────────────────────────────────
  if v_enviadas = 0 then
    raise exception 'reordenar_itens_do_grupo_opcional: lista vazia';
  end if;

  -- ── T2: AUTORIDADE. É esta linha que substitui a RLS perdida com o DEFINER.
  -- Ou o chamador é o DONO da loja declarada (equivalente exato do
  -- `opcionais_escrita_propria`, 20260614007500_opcionais.sql:128), ou é a via
  -- de serviço (cujo gate é verificarAdminSaaS + lojaId validado, ANTES da
  -- chamada). Qualquer outro caso cai. Fail-closed por construção.
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas l
          where l.id = p_loja_id and l.dono_id = auth.uid()
       )
  ) then
    raise exception 'reordenar_itens_do_grupo_opcional: escopo negado';
  end if;

  -- ── T3: COERÊNCIA par (loja, grupo). Vale INCLUSIVE sob service_role: o
  -- admin pode escrever em qualquer loja, mas nunca num grupo que não é dela.
  -- Roda DEPOIS de T2 e ANTES da contagem — é a ordem que impede a contagem de
  -- virar oráculo de existência em loja alheia.
  if not exists (
    select 1 from public.opcionais_categorias oc
     where oc.id = p_categoria_opcional_id and oc.loja_id = p_loja_id
  ) then
    raise exception 'reordenar_itens_do_grupo_opcional: grupo fora da loja';
  end if;

  -- ── T4: PERMUTAÇÃO COMPLETA do par, sem filtrar por `ativo`. Normalizar um
  -- SUBCONJUNTO reintroduziria o empate de `ordem` que esta feature elimina.
  select count(*) into v_no_grupo
    from public.opcionais o
   where o.loja_id = p_loja_id
     and o.categoria_opcional_id = p_categoria_opcional_id;
  if v_no_grupo <> v_enviadas then
    raise exception 'reordenar_itens_do_grupo_opcional: % ids para % itens',
      v_enviadas, v_no_grupo;
  end if;

  -- ── T5: `ordem` DERIVADA do índice no servidor (ordinality - 1). O cliente
  -- manda só a sequência de ids — nunca valores de ordem, nunca loja_id.
  -- Escreve SÓ `ordem`: nada de `preco`, `nome`, `ativo`, `atualizado_em`.
  update public.opcionais o
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where o.id = e.id
     and o.loja_id = p_loja_id
     and o.categoria_opcional_id = p_categoria_opcional_id;
  get diagnostics v_afetadas = row_count;

  -- ── T6: id de outra loja, de outro grupo, inexistente ou duplicado → menos
  -- linhas do que ids. A exceção derruba a transação INTEIRA: escrita parcial é
  -- impossível e nada é gravado em nenhuma das lojas.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_itens_do_grupo_opcional: % ids, % linhas afetadas',
      v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

create or replace function public.reordenar_opcionais_da_categoria(
  p_loja_id      uuid,
  p_categoria_id uuid,
  p_ids          uuid[]
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- cardinality(), NUNCA array_length(p_ids, 1): array_length conta só a
  -- primeira dimensão, enquanto o `unnest` entrega TODOS os elementos. Um
  -- array[[a,b],[c,a],[b,c]] passaria as duas checagens e gravaria `ordem`
  -- [0,2,4], quebrando a invariante 0..n-1. O coalesce também cobre p_ids null,
  -- que faria toda comparação virar NULL (nem raise, nem update — silêncio).
  v_enviadas    int  := coalesce(cardinality(p_ids), 0);
  v_no_par      int;
  v_afetadas    int;
  -- Sinal 1: claim `role` do JWT já verificado pelo PostgREST.
  -- Sinal 2: role efetivo da sessão. `current_user` NÃO serve dentro de uma
  -- função DEFINER (vale o DONO da função, não o chamador) — verificado; o
  -- mesmo vale para `row_security_active()`, sempre false aqui.
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
begin
  -- ── T1: lista não vazia ───────────────────────────────────────────────────
  if v_enviadas = 0 then
    raise exception 'reordenar_opcionais_da_categoria: lista vazia';
  end if;

  -- ── T2: AUTORIDADE. Substitui a `cat_prod_opc_escrita_propria` que a RLS
  -- avaliava sob o invoker. Ou o chamador é o DONO da loja declarada, ou é a
  -- via de serviço (gate: verificarAdminSaaS + lojaId da URL validado, ANTES da
  -- chamada). Qualquer outro caso cai. Fail-closed por construção.
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas l
          where l.id = p_loja_id and l.dono_id = auth.uid()
       )
  ) then
    raise exception 'reordenar_opcionais_da_categoria: escopo negado';
  end if;

  -- ── T3: COERÊNCIA par (loja, categoria de PRODUTO). Vale INCLUSIVE sob
  -- service_role: o admin pode escrever em qualquer loja, mas nunca numa
  -- categoria que não é dela. Roda DEPOIS de T2 e ANTES da contagem — é a ordem
  -- que impede a contagem de virar oráculo de existência em loja alheia.
  if not exists (
    select 1 from public.categorias c
     where c.id = p_categoria_id and c.loja_id = p_loja_id
  ) then
    raise exception 'reordenar_opcionais_da_categoria: categoria fora da loja';
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
     and cpo.loja_id = p_loja_id          -- escopo explícito ALÉM de T2/T3
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
