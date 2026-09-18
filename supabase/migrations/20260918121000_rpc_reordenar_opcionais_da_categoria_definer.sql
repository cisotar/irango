-- Issue 215 / débito 211 — converte `public.reordenar_opcionais_da_categoria`
-- de SECURITY INVOKER para SECURITY DEFINER, movendo a autoridade da RLS para
-- dentro do corpo da função.
--
-- ESTA MIGRATION REVOGA A AFIRMAÇÃO DO CABEÇALHO DE
-- `20260917121000_rpc_reordenar_opcionais_da_categoria.sql` ("SECURITY INVOKER,
-- nunca DEFINER"). Aquele arquivo NÃO é editado — já está aplicado no cloud, e
-- migration aplicada é história, não rascunho. Por que a afirmação caiu:
--
--   Sob `invoker`, quem recusava `p_loja_id` alheio era a policy
--   `cat_prod_opc_escrita_propria` (20260614007500_opcionais.sql:152) avaliada
--   no UPDATE. Isso funciona para o LOJISTA e só para ele: o hub admin roda sob
--   `service_role`, que tem BYPASSRLS, então a RPC nunca serviu aos dois
--   chamadores. É exatamente por isso que
--   `reordenarOpcionaisDaCategoriaAdmin` grava hoje com N `update` sequenciais
--   FORA de transação (débito 211) — queda de rede no 3º de 5 deixa `ordem`
--   duplicada e a vitrine não determinística.
--
--   Sob `definer` a RLS deixa de ser a autoridade, então a autoridade passa a
--   ser PROVADA NO CORPO: T2 (dono da loja OU via de serviço) e T3 (coerência
--   loja↔categoria de produto, válida inclusive sob service_role). O predicado
--   da policy não sumiu — mudou de lugar, e agora roda ANTES de qualquer
--   leitura ou escrita. Uma função serve os dois chamadores e o loop some.
--
-- `create or replace`: mesmo nome, mesmos parâmetros, mesmos tipos e mesmo
-- retorno (o Postgres não deixa mudá-los por replace; volatilidade e
-- invoker→definer, sim). O resto do corpo é idêntico ao de hoje.
--
-- Rollback: nova migration com `create or replace` restaurando
-- `security invoker` e removendo T2/T3 — a função volta ao estado de
-- 20260917121000 sem perda de dado (a função não guarda estado). Custo do
-- rollback: o hub admin volta ao loop de N updates (débito 211 reaberto).

create or replace function public.reordenar_opcionais_da_categoria(
  p_loja_id      uuid,
  p_categoria_id uuid,
  p_ids          uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
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
  v_e_servico   boolean := auth.role() = 'service_role'
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

-- `create or replace` PRESERVA a ACL da função, mas a migration não pode
-- depender disso: repetimos revoke/grant por idempotência. Sob DEFINER um
-- EXECUTE sobrando para `anon` seria escrita cross-tenant com a anon key do
-- bundle público.
revoke all on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
  to authenticated, service_role;
