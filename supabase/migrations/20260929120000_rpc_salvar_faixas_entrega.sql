-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 326 — RPC de escrita em lote da tabela de faixas de entrega.
-- Issue: tasks/326-tabela-de-faixas-de-entrega.md (D1 atômica, D2 servidor
--        deriva, C2 toda faixa ativa). Teste: tests/migrations/rpc_salvar_faixas_entrega.test.ts
--
--   salvar_faixas_entrega(p_loja_id, p_incremento, p_faixas) → integer
--     apaga TODAS as zonas da loja (qualquer tipo; cascata em taxas_entrega e
--     bairros_zona) e insere uma zona `raio_km` + taxa por faixa, numa só
--     transação. Devolve o número de faixas gravadas.
--
-- D2: o cliente manda SÓ `taxa` e `pedido_minimo_gratis` por faixa. Teto
-- (`(posição + 1) × incremento`), nome ("<de>–<até> km", en dash), tipo,
-- `ativo = true`, CEP nulo e loja são derivados aqui. Qualquer outra chave do
-- item (raio_max_km, nome, loja_id, ativo, tipo, cep_*) é IGNORADA.
--
-- SECURITY INVOKER (precedente 20260928131000_rpc_frequencia_produtos): para o
-- lojista a RLS `zonas_escrita_propria`/`taxas_escrita_propria` continua
-- valendo no corpo; o filtro `loja_id = p_loja_id` é explícito além dela.
-- T2 é obrigatório mesmo com RLS: com lista vazia e `p_loja_id` alheio o
-- `delete` de 0 linhas visíveis passaria calado — a trava de posse recusa
-- ANTES de qualquer linha. Admin (service_role, BYPASSRLS) chega com o
-- `lojaId` validado por `prepararContextoAdmin`; o filtro é a amarra dele.
--
-- Ordem: T1 forma (incremento, array, teto 30) → T2 autoridade → T3 valor por
-- item → escrita. Mensagens internas estáveis (P0001, prefixo fixo); a Server
-- Action loga e devolve genérica (seguranca.md §14).
--
-- ADITIVA E REVERSÍVEL: só cria uma função. Nenhuma tabela, coluna ou policy.
--
-- ROLLBACK (manual): antes, a Server Action precisa deixar de chamar a RPC
-- (senão PGRST202). Depois:
--   drop function if exists public.salvar_faixas_entrega(uuid, integer, jsonb);
-- Sem perda de dado (a função não guarda estado).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.salvar_faixas_entrega(
  p_loja_id     uuid,     -- da Server Action (buscarLojaDoDono / lojaId admin validado), NUNCA do payload
  p_incremento  int,      -- 1 ou 2 km
  p_faixas      jsonb     -- [{ taxa, pedido_minimo_gratis }], em ordem de distância
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
  for v_item in select e from jsonb_array_elements(p_faixas) as e loop
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
  end loop;

  -- ── Escrita: substitui todas as zonas da loja ─────────────────────────────
  delete from public.zonas_entrega
   where loja_id = p_loja_id;              -- escopo explícito ALÉM da RLS

  for v_item, v_pos in
    select e, o from jsonb_array_elements(p_faixas) with ordinality as x(e, o)
  loop
    v_de  := (v_pos::int - 1) * p_incremento;
    v_ate := v_pos::int * p_incremento;
    v_taxa := (v_item ->> 'taxa')::numeric;
    v_gratis := case
                  when coalesce(jsonb_typeof(v_item -> 'pedido_minimo_gratis'), 'null') = 'null' then null
                  else (v_item ->> 'pedido_minimo_gratis')::numeric
                end;

    insert into public.zonas_entrega (loja_id, nome, tipo, ativo)
    values (p_loja_id, format('%s–%s km', v_de, v_ate), 'raio_km', true)
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

-- O Postgres concede EXECUTE a PUBLIC em função nova e o projeto tem default
-- privileges concedendo a `anon` (20260614008500): o revoke nomeia `anon`
-- explicitamente. service_role é a via admin (prepararContextoAdmin).
revoke all on function public.salvar_faixas_entrega(uuid, integer, jsonb) from public, anon;
grant execute on function public.salvar_faixas_entrega(uuid, integer, jsonb) to authenticated, service_role;
