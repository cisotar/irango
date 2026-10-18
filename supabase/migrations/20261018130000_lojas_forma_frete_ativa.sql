-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 325 (mudança de requisito) — forma ATIVA de frete como coluna, com as
-- zonas das três formas guardadas lado a lado.
-- Plano: plan/loop-forma-ativa-frete.md (D1–D5). Testes:
--   tests/migrations/lojas_forma_frete_ativa.test.ts
--   tests/migrations/rpc_salvar_zonas_entrega.test.ts
--   tests/migrations/vitrine_lojas_select_only.test.ts
--
-- Trocar de forma de frete NÃO apaga a configuração da forma anterior: só a
-- forma de cálculo ativa muda. Só as zonas de `tipo = lojas.forma_frete`
-- cobram (o filtro mora em `listarZonasComTaxas`).
--
-- O QUE ENTRA (expand-only; nenhuma coluna, tabela ou zona é apagada):
--   D1. `lojas.forma_frete text not null default 'raio_km'` + CHECK no enum.
--   D2. Backfill por loja, contando só zonas ativas COM linha em taxas_entrega
--       (as que cobram hoje): 1 tipo → esse tipo; 0 tipos → o tipo único entre
--       todas as zonas, senão raio_km; ≥ 2 tipos (mista) → raio_km.
--   D3. `salvar_zonas_entrega` (mesma assinatura, travas T1–T4 e mensagens):
--       o DELETE apaga só `tipo = p_forma` e o UPDATE da T4 grava
--       `forma_frete = p_forma` (salvar numa forma = ativar essa forma; a troca
--       fica coberta pela versão otimista porque só acontece por esta RPC).
--   D4. `salvar_faixas_entrega` (legado, produção antiga entre db push e
--       deploy): mesmo corpo de 20260930120000 + `forma_frete = 'raio_km'`.
--   D5. `vitrine_lojas` recriada com as colunas da 20260925120000 + forma_frete
--       no fim; mesmas opções e o mesmo revoke/grant SELECT-only.
--
-- NÃO edita 20261018120000 (aplicada no cloud): D3 é `create or replace` com o
-- corpo inteiro copiado.
--
-- ROLLBACK (manual, fora da migration — nunca automático):
--   1. recriar `vitrine_lojas` com o bloco de 20260925120000 (sem forma_frete);
--   2. recriar `salvar_zonas_entrega` com o corpo de 20261018120000 e
--      `salvar_faixas_entrega` com o de 20260930120000;
--   3. alter table public.lojas drop column forma_frete;
--   Reverta o código junto (ele lê `forma_frete`). As zonas guardadas das
--   outras formas voltam a cobrar pela regra de menor taxa de `calcularFrete`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── D1. Coluna ──────────────────────────────────────────────────────────────
alter table public.lojas
  add column forma_frete text not null default 'raio_km'
  constraint lojas_forma_frete_valida check (forma_frete in ('raio_km', 'faixa_cep', 'bairro'));

comment on column public.lojas.forma_frete is
  'Forma de frete ATIVA (issue 325): só as zonas_entrega com tipo = forma_frete cobram; as das outras formas ficam guardadas. Gravada SÓ por salvar_zonas_entrega (junto da versão otimista) e pela legada salvar_faixas_entrega. Em CAMPOS_LOJA_SOMENTE_SERVIDOR (patch admin não grava) e fora da allowlist do lojista (patches-loja.ts).';

-- ── D2. Backfill ────────────────────────────────────────────────────────────
with derivada as (
  select l.id,
         (select array_agg(distinct z.tipo)
            from public.zonas_entrega z
           where z.loja_id = l.id
             and z.ativo
             and exists (select 1 from public.taxas_entrega t where t.zona_id = z.id)) as ativos,
         (select array_agg(distinct z.tipo)
            from public.zonas_entrega z
           where z.loja_id = l.id) as todos
    from public.lojas l
), forma as (
  select id,
         case
           when coalesce(cardinality(ativos), 0) = 1 then ativos[1]
           when coalesce(cardinality(ativos), 0) = 0 and coalesce(cardinality(todos), 0) = 1 then todos[1]
           else 'raio_km'
         end as forma_frete
    from derivada
)
update public.lojas l
   set forma_frete = f.forma_frete
  from forma f
 where f.id = l.id
   and f.forma_frete <> 'raio_km';

-- ── D3. salvar_zonas_entrega grava só a forma e a ativa ─────────────────────
create or replace function public.salvar_zonas_entrega(
  p_loja_id uuid,    -- da Server Action (buscarLojaDoDono / lojaId admin validado), NUNCA do payload
  p_versao  bigint,  -- versão lida junto das zonas; compare-and-set
  p_forma   text,    -- 'raio_km' | 'faixa_cep' | 'bairro'
  p_dados   jsonb    -- objeto; shape por forma (plano §1)
) returns bigint
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
  -- Faixa de marcas diacríticas combinantes (U+0300–U+036F), para a
  -- normalização de bairro espelhar `normalizarBairro` (calcularFrete.ts).
  v_diacriticos text    := '[' || chr(768) || '-' || chr(879) || ']';
  v_lista       jsonb;
  v_item        jsonb;
  v_pos         bigint;
  v_taxa        numeric;
  v_gratis      numeric;
  v_ativo       boolean;
  v_viu_deslig  boolean := false;
  v_incremento  int;
  v_de          int;
  v_ate         int;
  v_ini         numeric;
  v_fim         numeric;
  v_max_fim     numeric;
  v_bairro      jsonb;
  v_nome        text;
  v_qtd         int;
  v_total       int := 0;
  v_zona_id     uuid;
  v_nova        bigint;
begin
  -- ── T1: forma do pedido ────────────────────────────────────────────────────
  if p_forma is null or p_forma not in ('raio_km', 'faixa_cep', 'bairro') then
    raise exception 'salvar_zonas_entrega: forma invalida';
  end if;

  if p_versao is null or p_versao < 0 then
    raise exception 'salvar_zonas_entrega: versao invalida';
  end if;

  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'salvar_zonas_entrega: dados invalidos';
  end if;

  if p_forma = 'raio_km' then
    if jsonb_typeof(p_dados -> 'incremento') is distinct from 'number'
       or (p_dados ->> 'incremento')::numeric not in (1, 2) then
      raise exception 'salvar_zonas_entrega: incremento invalido';
    end if;
    v_incremento := (p_dados ->> 'incremento')::numeric::int;
    v_lista := p_dados -> 'faixas';
    if jsonb_typeof(v_lista) is distinct from 'array' then
      raise exception 'salvar_zonas_entrega: faixas invalidas';
    end if;
    if jsonb_array_length(v_lista) > 30 then
      raise exception 'salvar_zonas_entrega: lista acima do teto';
    end if;

  elsif p_forma = 'faixa_cep' then
    v_lista := p_dados -> 'faixas';
    if jsonb_typeof(v_lista) is distinct from 'array' then
      raise exception 'salvar_zonas_entrega: faixas invalidas';
    end if;
    if jsonb_array_length(v_lista) > 50 then
      raise exception 'salvar_zonas_entrega: lista acima do teto';
    end if;

  else -- bairro
    v_lista := p_dados -> 'grupos';
    if jsonb_typeof(v_lista) is distinct from 'array' then
      raise exception 'salvar_zonas_entrega: grupos invalidos';
    end if;
    if jsonb_array_length(v_lista) > 30 then
      raise exception 'salvar_zonas_entrega: lista acima do teto';
    end if;
    for v_item in select e from jsonb_array_elements(v_lista) as x(e) loop
      v_qtd := case
                 when jsonb_typeof(v_item -> 'bairros') = 'array' then jsonb_array_length(v_item -> 'bairros')
                 else 0
               end;
      if v_qtd > 100 then
        raise exception 'salvar_zonas_entrega: lista acima do teto';
      end if;
      v_total := v_total + v_qtd;
    end loop;
    if v_total > 300 then
      raise exception 'salvar_zonas_entrega: lista acima do teto';
    end if;
  end if;

  -- ── T2: autoridade, ANTES de tocar qualquer linha ─────────────────────────
  -- Roda antes de T3/T4: um p_loja_id alheio recebe 'sem posse' e nunca
  -- descobre se a versão bate.
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas l
          where l.id = p_loja_id and l.dono_id = auth.uid()
       )
  ) then
    raise exception 'salvar_zonas_entrega: sem posse';
  end if;

  -- ── T3: valor por item, TODOS antes de escrever ───────────────────────────
  -- `taxas_entrega.taxa` é numeric(10,2) e arredondaria 4.555 calado: a
  -- checagem de centavos é explícita.
  for v_item in
    select e from jsonb_array_elements(v_lista) with ordinality as x(e, o) order by o
  loop
    -- comuns às três formas: taxa, grátis, ativo
    if jsonb_typeof(v_item -> 'taxa') is distinct from 'number' then
      raise exception 'salvar_zonas_entrega: taxa invalida';
    end if;
    v_taxa := (v_item ->> 'taxa')::numeric;
    if v_taxa < 0 or v_taxa <> round(v_taxa, 2) then
      raise exception 'salvar_zonas_entrega: taxa invalida';
    end if;

    if coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') <> 'null' then
      if jsonb_typeof(v_item -> 'pedido_minimo_gratis') <> 'number' then
        raise exception 'salvar_zonas_entrega: gratis invalido';
      end if;
      v_gratis := (v_item ->> 'pedido_minimo_gratis')::numeric;
      if v_gratis < 0 or v_gratis <> round(v_gratis, 2) then
        raise exception 'salvar_zonas_entrega: gratis invalido';
      end if;
    end if;

    if jsonb_typeof(v_item -> 'ativo') is distinct from 'boolean' then
      raise exception 'salvar_zonas_entrega: ativo invalido';
    end if;
    v_ativo := (v_item -> 'ativo')::boolean;

    if p_forma = 'raio_km' then
      -- prefixo: nenhuma ativa depois de uma desligada.
      if v_ativo and v_viu_deslig then
        raise exception 'salvar_zonas_entrega: faixa ativa depois de desligada';
      end if;
      if not v_ativo then
        v_viu_deslig := true;
      end if;

    elsif p_forma = 'faixa_cep' then
      if jsonb_typeof(v_item -> 'cep_inicio') is distinct from 'number'
         or jsonb_typeof(v_item -> 'cep_fim') is distinct from 'number' then
        raise exception 'salvar_zonas_entrega: cep invalido';
      end if;
      v_ini := (v_item ->> 'cep_inicio')::numeric;
      v_fim := (v_item ->> 'cep_fim')::numeric;
      if v_ini <> trunc(v_ini) or v_fim <> trunc(v_fim)
         or v_ini < 0 or v_ini > 99999999
         or v_fim < 0 or v_fim > 99999999 then
        raise exception 'salvar_zonas_entrega: cep invalido';
      end if;
      -- espelha o CHECK taxas_faixa_cep_coerente
      if v_ini > v_fim then
        raise exception 'salvar_zonas_entrega: faixa de cep invertida';
      end if;

    else -- bairro
      if jsonb_typeof(v_item -> 'bairros') is distinct from 'array'
         or jsonb_array_length(v_item -> 'bairros') = 0 then
        raise exception 'salvar_zonas_entrega: grupo sem bairro';
      end if;
      for v_bairro in select e from jsonb_array_elements(v_item -> 'bairros') as y(e) loop
        if jsonb_typeof(v_bairro) is distinct from 'string' then
          raise exception 'salvar_zonas_entrega: bairro invalido';
        end if;
        v_nome := btrim(regexp_replace(v_bairro #>> '{}', '\s+', ' ', 'g'));
        if v_nome = '' or char_length(v_nome) > 120 then
          raise exception 'salvar_zonas_entrega: bairro invalido';
        end if;
      end loop;
    end if;
  end loop;

  -- faixa_cep: sem sobreposição (ativas e desligadas: a desligada pode voltar).
  -- Em ordem de cep_inicio, um início <= maior fim já visto cruza. Faixas
  -- encostadas (fim 01999999, início 02000000) passam.
  if p_forma = 'faixa_cep' then
    v_max_fim := null;
    for v_ini, v_fim in
      select (e ->> 'cep_inicio')::numeric, (e ->> 'cep_fim')::numeric
        from jsonb_array_elements(v_lista) as x(e)
       order by 1, 2
    loop
      if v_max_fim is not null and v_ini <= v_max_fim then
        raise exception 'salvar_zonas_entrega: faixas de cep sobrepostas';
      end if;
      v_max_fim := greatest(coalesce(v_max_fim, v_fim), v_fim);
    end loop;
  end if;

  -- bairro: sem repetição, normalizado como `normalizarBairro` (NFD → sem
  -- diacríticos → brancos colapsados ANTES do btrim, que só apara ' ' — assim
  -- 'Centro\t' casa com 'Centro' como no `trim()` do JS → minúsculas), em
  -- TODOS os grupos.
  if p_forma = 'bairro' then
    if exists (
      select 1
        from jsonb_array_elements(v_lista) as g(grupo)
        cross join lateral jsonb_array_elements_text(g.grupo -> 'bairros') as b(nome)
       group by lower(btrim(regexp_replace(
                  regexp_replace(normalize(b.nome, NFD), v_diacriticos, '', 'g'),
                  '\s+', ' ', 'g')))
      having count(*) > 1
    ) then
      raise exception 'salvar_zonas_entrega: bairro repetido';
    end if;
  end if;

  -- ── T4: versão (compare-and-set), a primeira escrita ──────────────────────
  -- O UPDATE trava a linha da loja: uma segunda transação com a mesma
  -- p_versao espera, reavalia o WHERE na linha nova e não acha nada.
  update public.lojas
     set versao_zonas_entrega = versao_zonas_entrega + 1,
         forma_frete          = p_forma   -- 325: salvar numa forma = ativar essa forma
   where id = p_loja_id
     and versao_zonas_entrega = p_versao
  returning versao_zonas_entrega into v_nova;
  if not found then
    raise exception 'salvar_zonas_entrega: versao desatualizada';
  end if;

  -- ── Escrita: substitui SÓ as zonas desta forma (325) ──────────────────────
  -- As zonas das outras formas ficam guardadas: voltar para elas não exige
  -- recadastrar. Só as da forma ativa (`lojas.forma_frete`) cobram.
  delete from public.zonas_entrega
   where loja_id = p_loja_id               -- escopo explícito ALÉM da RLS; cascata em taxas/bairros
     and tipo = p_forma;

  if p_forma = 'raio_km' then
    for v_item, v_pos in
      select e, o from jsonb_array_elements(v_lista) with ordinality as x(e, o) order by o
    loop
      v_de  := (v_pos::int - 1) * v_incremento;
      v_ate := v_pos::int * v_incremento;
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
    end loop;

  elsif p_forma = 'faixa_cep' then
    for v_item in
      select e from jsonb_array_elements(v_lista) as x(e)
       order by (e ->> 'cep_inicio')::numeric
    loop
      v_ini := (v_item ->> 'cep_inicio')::numeric;
      v_fim := (v_item ->> 'cep_fim')::numeric;
      v_taxa := (v_item ->> 'taxa')::numeric;
      v_gratis := case
                    when coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') = 'null' then null
                    else (v_item ->> 'pedido_minimo_gratis')::numeric
                  end;
      v_ativo := (v_item -> 'ativo')::boolean;

      insert into public.zonas_entrega (loja_id, nome, tipo, ativo)
      values (
        p_loja_id,
        format(
          'CEP %s a %s',
          substr(lpad(v_ini::bigint::text, 8, '0'), 1, 5) || '-' || substr(lpad(v_ini::bigint::text, 8, '0'), 6, 3),
          substr(lpad(v_fim::bigint::text, 8, '0'), 1, 5) || '-' || substr(lpad(v_fim::bigint::text, 8, '0'), 6, 3)
        ),
        'faixa_cep',
        v_ativo
      )
      returning id into v_zona_id;

      insert into public.taxas_entrega
        (zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
      values
        (v_zona_id, v_taxa, v_gratis, null, v_ini::bigint, v_fim::bigint);
    end loop;

  else -- bairro: uma zona por grupo, na ordem recebida
    for v_item in
      select e from jsonb_array_elements(v_lista) with ordinality as x(e, o) order by o
    loop
      v_taxa := (v_item ->> 'taxa')::numeric;
      v_gratis := case
                    when coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') = 'null' then null
                    else (v_item ->> 'pedido_minimo_gratis')::numeric
                  end;
      v_ativo := (v_item -> 'ativo')::boolean;
      v_qtd := jsonb_array_length(v_item -> 'bairros');
      v_nome := btrim(regexp_replace(v_item -> 'bairros' ->> 0, '\s+', ' ', 'g'));
      if v_qtd > 1 then
        v_nome := v_nome || format(' e mais %s', v_qtd - 1);
      end if;

      insert into public.zonas_entrega (loja_id, nome, tipo, ativo)
      values (p_loja_id, v_nome, 'bairro', v_ativo)
      returning id into v_zona_id;

      insert into public.taxas_entrega
        (zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
      values
        (v_zona_id, v_taxa, v_gratis, null, null, null);

      -- nome de exibição (aparado, espaços colapsados), não o normalizado
      insert into public.bairros_zona (zona_id, nome)
      select v_zona_id, btrim(regexp_replace(b.nome, '\s+', ' ', 'g'))
        from jsonb_array_elements_text(v_item -> 'bairros') with ordinality as b(nome, o)
       order by b.o;
    end loop;
  end if;

  return v_nova;
end;
$$;

-- create or replace preserva o ACL; repetido para a migration ser autossuficiente
-- (default privileges concedem EXECUTE a `anon`, 20260614008500).
revoke all on function public.salvar_zonas_entrega(uuid, bigint, text, jsonb) from public, anon;
grant execute on function public.salvar_zonas_entrega(uuid, bigint, text, jsonb) to authenticated, service_role;

-- ── D4. salvar_faixas_entrega (legado) marca a forma raio_km ────────────────
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
  -- 325: o legado grava faixas de km, então a forma ativa passa a ser raio_km
  -- (senão a loja ficaria cobrando por uma forma cujas zonas este DELETE apaga).
  update public.lojas set forma_frete = 'raio_km' where id = p_loja_id;

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

revoke all on function public.salvar_faixas_entrega(uuid, integer, jsonb) from public, anon;
grant execute on function public.salvar_faixas_entrega(uuid, integer, jsonb) to authenticated, service_role;

-- ── D5. vitrine_lojas com forma_frete ───────────────────────────────────────
-- A vitrine (anon) não lê `lojas`: a forma ativa chega ao preview do frete e
-- ao checkout por aqui. Colunas e opções da 20260925120000 + forma_frete no fim.
drop view if exists public.vitrine_lojas;

create view public.vitrine_lojas
  with (security_invoker = false, security_barrier = true)
as
  select
    id,
    slug,
    nome,
    telefone,
    whatsapp,
    ativo,
    endereco_rua,
    endereco_numero,
    endereco_bairro,
    endereco_cidade,
    endereco_estado,
    endereco_cep,
    tema,
    horarios,
    timezone,
    assinatura_status,
    assinatura_fim_periodo,
    taxa_entrega_fora_zona,
    logo_url,
    whatsapp_envio_automatico,
    modal_promocoes,
    aceita_retirada,
    aceita_entrega,
    modo_frete,
    forma_frete
  from public.lojas
  where ativo = true;

-- View pública recriada: SELECT-only para os roles da API (seguranca.md §19).
revoke all on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;
