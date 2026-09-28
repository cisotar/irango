-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 326, iteração 2 — `ativo` por faixa em salvar_faixas_entrega.
-- Issue: tasks/326-tabela-de-faixas-de-entrega.md ("Iteração 2 — retorno do
--        checklist", C2' substitui C2). Teste: tests/migrations/rpc_salvar_faixas_entrega.test.ts
--
-- O QUE MUDA em relação a 20260929120000_rpc_salvar_faixas_entrega (que já
-- está no remoto e NÃO é editada): mesma assinatura, mesmo T1/T2, mesma
-- escrita — e agora
--   - cada item TEM de trazer `ativo` boolean (ausente/null/string/número ⇒
--     'salvar_faixas_entrega: ativo invalido', sem coerção);
--   - as faixas ativas formam um PREFIXO: item ativo com algum anterior
--     desligado ⇒ 'salvar_faixas_entrega: faixa ativa depois de desligada'
--     (vale também para service_role: a regra é do dado, não do papel);
--   - a zona é gravada com o `ativo` recebido (antes, sempre true).
-- As duas checagens novas são T3: depois da posse (T2), antes de qualquer
-- escrita. Faixa desligada também valida taxa/grátis (é gravada e pode voltar
-- a cobrar). As demais chaves extras do item (raio_max_km, nome, loja_id,
-- tipo, cep_*) continuam IGNORADAS: o servidor deriva (D2).
--
-- `calcularFrete` já ignora zona inativa: limite de entrega = teto da última
-- faixa ativa, sem mudança no cálculo.
--
-- ADITIVA E REVERSÍVEL: só substitui o corpo da função (create or replace).
-- Nenhuma tabela, coluna ou policy.
--
-- ROLLBACK (manual): recriar a função com o corpo de
-- 20260929120000_rpc_salvar_faixas_entrega.sql (grava sempre ativo = true e
-- ignora a chave). Antes, a tela precisa deixar de oferecer faixa desligada,
-- senão o lojista desliga e a gravação liga de volta calada. Sem perda de
-- dado (a função não guarda estado).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.salvar_faixas_entrega(
  p_loja_id     uuid,     -- da Server Action (buscarLojaDoDono / lojaId admin validado), NUNCA do payload
  p_incremento  int,      -- 1 ou 2 km
  p_faixas      jsonb     -- [{ taxa, pedido_minimo_gratis, ativo }], em ordem de distância
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Via de serviço: claim `role` do JWT E role efetivo da sessão (padrão
  -- fail-closed de 20260918130000_rpc_ordem_t2_fail_closed).
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  v_item        jsonb;
  v_pos         bigint;
  v_taxa        numeric;
  v_gratis      numeric;
  v_ativo       boolean;
  v_viu_deslig  boolean := false;
  v_de          int;
  v_ate         int;
  v_zona_id     uuid;
  v_gravadas    int := 0;
begin
  -- ── T1: forma ──────────────────────────────────────────────────────────────
  if p_incremento is null or p_incremento not in (1, 2) then
    raise exception 'salvar_faixas_entrega: incremento invalido';
  end if;

  if p_faixas is null or jsonb_typeof(p_faixas) <> 'array' then
    raise exception 'salvar_faixas_entrega: faixas invalidas';
  end if;

  -- espelha o teto de schemaFaixasEntrega (src/lib/validacoes/entrega.ts)
  if jsonb_array_length(p_faixas) > 30 then
    raise exception 'salvar_faixas_entrega: lista acima do teto';
  end if;

  -- ── T2: autoridade, ANTES de tocar qualquer linha ─────────────────────────
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas l
          where l.id = p_loja_id and l.dono_id = auth.uid()
       )
  ) then
    raise exception 'salvar_faixas_entrega: sem posse';
  end if;

  -- ── T3: valor por item, TODOS antes de escrever ───────────────────────────
  -- `taxas_entrega.taxa` é numeric(10,2) e arredondaria 4.555 calado: a
  -- checagem de centavos é explícita. Taxa ausente/null/não-número recusada.
  for v_item in
    select e from jsonb_array_elements(p_faixas) with ordinality as x(e, o) order by o
  loop
    if jsonb_typeof(v_item -> 'taxa') is distinct from 'number' then
      raise exception 'salvar_faixas_entrega: taxa invalida';
    end if;
    v_taxa := (v_item ->> 'taxa')::numeric;
    if v_taxa < 0 or v_taxa <> round(v_taxa, 2) then
      raise exception 'salvar_faixas_entrega: taxa invalida';
    end if;

    -- grátis: ausente ou null = sem frete grátis; senão número ≥ 0 com centavos.
    if coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') <> 'null' then
      if jsonb_typeof(v_item -> 'pedido_minimo_gratis') <> 'number' then
        raise exception 'salvar_faixas_entrega: gratis invalido';
      end if;
      v_gratis := (v_item ->> 'pedido_minimo_gratis')::numeric;
      if v_gratis < 0 or v_gratis <> round(v_gratis, 2) then
        raise exception 'salvar_faixas_entrega: gratis invalido';
      end if;
    end if;

    -- ativo: boolean JSON obrigatório, sem coerção de "true"/1.
    if jsonb_typeof(v_item -> 'ativo') is distinct from 'boolean' then
      raise exception 'salvar_faixas_entrega: ativo invalido';
    end if;
    v_ativo := (v_item -> 'ativo')::boolean;

    -- prefixo: nenhuma ativa depois de uma desligada.
    if v_ativo and v_viu_deslig then
      raise exception 'salvar_faixas_entrega: faixa ativa depois de desligada';
    end if;
    if not v_ativo then
      v_viu_deslig := true;
    end if;
  end loop;

  -- ── Escrita: substitui todas as zonas da loja ─────────────────────────────
  delete from public.zonas_entrega
   where loja_id = p_loja_id;              -- escopo explícito ALÉM da RLS

  for v_item, v_pos in
    select e, o from jsonb_array_elements(p_faixas) with ordinality as x(e, o) order by o
  loop
    v_de  := (v_pos::int - 1) * p_incremento;
    v_ate := v_pos::int * p_incremento;
    v_taxa := (v_item ->> 'taxa')::numeric;
    v_gratis := case
                  when coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') = 'null' then null
                  else (v_item ->> 'pedido_minimo_gratis')::numeric
                end;
    v_ativo := (v_item -> 'ativo')::boolean;

    insert into public.zonas_entrega (loja_id, nome, tipo, ativo)
    values (p_loja_id, format('%s–%s km', v_de, v_ate), 'raio_km', v_ativo)
    returning id into v_zona_id;

    insert into public.taxas_entrega
      (zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
    values
      (v_zona_id, v_taxa, v_gratis, v_ate, null, null);

    v_gravadas := v_gravadas + 1;
  end loop;

  return v_gravadas;
end;
$$;

-- create or replace preserva o ACL, mas o revoke/grant é repetido para a
-- migration ser autossuficiente (default privileges concedem a `anon`,
-- 20260614008500).
revoke all on function public.salvar_faixas_entrega(uuid, integer, jsonb) from public, anon;
grant execute on function public.salvar_faixas_entrega(uuid, integer, jsonb) to authenticated, service_role;
