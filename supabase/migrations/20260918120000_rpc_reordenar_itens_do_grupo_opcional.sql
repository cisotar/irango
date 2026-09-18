-- Issue 215 — RPC de reordenação dos ITENS dentro de UM grupo de opcional.
-- Fecha junto a 211 (ver 20260918121000).
--
-- Por que RPC: PostgREST não faz update-many com valor DIFERENTE POR LINHA;
-- `.upsert()` reescreveria a LINHA INTEIRA (incl. `preco`) e um id inexistente
-- inseriria item fantasma; N updates sequenciais não são atômicos.
--
-- Por que SECURITY DEFINER (e por que isso é seguro aqui): o hub admin roda sob
-- `service_role`, onde a RLS não vale — uma função `invoker` não serve, e é por
-- isso que o admin hoje grava à mão (débito 211). Sob DEFINER a RLS deixa de ser
-- a autoridade, então a autoridade é PROVADA NO CORPO (travas T2 e T3 abaixo).
-- `p_loja_id` NUNCA vem do payload do cliente: no lojista é derivado de
-- `auth.uid()` (buscarLojaDoDono), na via admin é o `lojaId` da URL já validado
-- por `validarLojaIdAdmin` + `verificarAdminSaaS`.
--
-- Escopo da permutação: o par (loja, grupo) INTEIRO, INCLUINDO `ativo = false`.
-- O painel enxerga os inativos e manda todos os ids; a vitrine não renderiza os
-- inativos e continua lendo a ordem certa (0,1,3 ordena igual a 0,1,2). Exigir
-- só os ativos faria o painel mandar mais ids do que a função espera.
--
-- Rollback: drop function if exists
--   public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[]);
-- Sem perda de dado (a função não guarda estado).

create or replace function public.reordenar_itens_do_grupo_opcional(
  p_loja_id               uuid,
  p_categoria_opcional_id uuid,
  p_ids                   uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
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
  v_e_servico   boolean := auth.role() = 'service_role'
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

-- T7: o Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto
-- NÃO tem `alter default privileges ... on functions`. Sem este revoke, anon
-- executaria a RPC direto em /rest/v1/rpc/ com a anon key do bundle público —
-- sob DEFINER isso seria escrita cross-tenant sem nenhuma segunda rede.
revoke all on function public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.reordenar_itens_do_grupo_opcional(uuid, uuid, uuid[])
  to authenticated, service_role;
