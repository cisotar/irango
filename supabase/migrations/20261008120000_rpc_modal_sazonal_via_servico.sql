-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 362 — VIA DE SERVIÇO das duas RPCs transacionais do modal sazonal, para
-- a sub-rota admin de Avisos (`/admin/assinantes/[lojaId]/configuracoes/promocoes`).
-- Issue: tasks/362-sub-rota-admin-de-avisos.md (§Escopo/Banco, alternativa 2).
-- Teste: tests/migrations/rpc_modal_sazonal_via_servico.test.ts
--
-- O QUE MUDA em relação a 20260927121000_rpc_salvar_modal_sazonal e
-- 20260927125000_rpc_ativar_modal_sazonal (as duas já no remoto e NÃO editadas):
--
--   1. `salvar_modal_sazonal` — MESMA assinatura, S3–S7 intactos (forma dos
--      arrays, escopo duplo, FKs compostas, contagem gravada). Só S1/S2 ganham o
--      ramo `v_e_servico`, no padrão já estabelecido por
--      20260930120000_rpc_salvar_faixas_entrega_ativo.sql:44-83 (claim `role` do
--      JWT **E** role efetivo da sessão fora de authenticated/anon — os dois
--      sinais só divergem por forja de claim ou bug de pool, e aí a via de
--      serviço NEGA). `grant execute ... to authenticated, service_role`: o
--      caminho do dono fica byte-idêntico.
--
--   2. NOVO OVERLOAD `ativar_modal_sazonal(p_modal_id uuid, p_loja_id uuid)` —
--      2 argumentos, SEM `default` (um `default null` tornaria a chamada de 1
--      arg AMBÍGUA e quebraria o lojista). Exige `v_e_servico` **e**
--      `modais_sazonais.loja_id = p_loja_id`: a loja-alvo é amarrada NO BANCO,
--      não por pré-checagem em TS (TOCTOU). O escopo é provado ANTES de desligar
--      o ativo anterior — uma ordem invertida deixaria a loja com ZERO ativos
--      (o defeito que RN-M16 existe para impedir). `revoke all ... from public,
--      anon, authenticated` EXPLÍCITO (os default privileges de 20260614008500
--      concedem EXECUTE aos três: sem o revoke de `authenticated` o lojista
--      alcançaria o caminho que amarra a loja por argumento) + `grant execute`
--      só a `service_role`.
--
--   3. `ativar_modal_sazonal(uuid)` (1 arg, do lojista) NÃO é tocada.
--
-- Nenhuma mudança de SCHEMA: nenhuma tabela, coluna, policy ou índice. Só
-- `create or replace` de função + um overload novo.
--
-- Mensagens de `raise` estáveis (P0001, prefixo `modal_sazonal:`), sem id nem
-- dado de entrada — a Server Action loga o detalhe e devolve mensagem genérica
-- (seguranca.md §14):
--   'modal_sazonal: sem sessao'        nem via de serviço nem auth.uid()
--   'modal_sazonal: sem posse'         autenticado que não é dono de p_loja_id
--   'modal_sazonal: modal inexistente' modal inexistente OU de outra loja (a
--                                      MESMA mensagem: nenhum oráculo de
--                                      existência)
--
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- ANTES: a sub-rota admin de Avisos precisa deixar de existir (a page e as 5
-- actions de `admin-modal-sazonal.ts`), senão criar/editar/ativar pelo admin
-- quebra com 'sem sessao'/PGRST202. Depois:
--
--   drop function if exists public.ativar_modal_sazonal(uuid, uuid);
--   -- e recriar `salvar_modal_sazonal` com o corpo de
--   -- 20260927121000_rpc_salvar_modal_sazonal.sql (S1/S2 sem o ramo de
--   -- serviço), repetindo o seu revoke/grant (sem service_role).
--
-- Não perde dado: nenhuma das funções guarda estado. O caminho do lojista
-- continua funcionando durante e depois do rollback.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.salvar_modal_sazonal(
  p_loja_id                 uuid,         -- da Server Action (buscarLojaDoDono / lojaId admin validado), NUNCA do payload
  p_modal_id                uuid,         -- null = criar; senão = editar
  p_titulo                  text,
  p_exibicao_inicio         timestamptz,
  p_exibicao_fim            timestamptz,
  p_mensagem                jsonb,        -- já canonizada pelo zod; os CHECKs da tabela valem
  p_mostrar_promocoes_junto boolean,      -- null = preservar (editar) / false (criar)
  p_categorias              uuid[],
  p_cardapios               uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Via de serviço: claim `role` do JWT E role efetivo da sessão (padrão
  -- fail-closed de 20260918130000_rpc_ordem_t2_fail_closed, reusado em
  -- 20260930120000_rpc_salvar_faixas_entrega_ativo).
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  -- Array nulo = seleção vazia (RN-M02: seleção é opcional).
  v_categorias uuid[] := coalesce(p_categorias, '{}'::uuid[]);
  v_cardapios  uuid[] := coalesce(p_cardapios, '{}'::uuid[]);
  v_id         uuid;
  v_gravadas   int;
begin
  -- S1: sessão de usuário obrigatória, OU a via de serviço (admin na loja-alvo,
  -- issue 362). anon segue barrado por S7 (ACL) — fail-closed.
  if not v_e_servico and auth.uid() is null then
    raise exception 'modal_sazonal: sem sessao';
  end if;

  -- S2: posse EXPLÍCITA da loja, antes de tocar em qualquer linha. Não depende
  -- só da RLS. A via de serviço é dispensada da posse de propósito (não há
  -- `auth.uid()` sob service_role): quem a alcança é a Server Action admin, que
  -- provou admin ANTES de elevar e amarra `p_loja_id` ao lojaId validado da URL.
  if not (
       v_e_servico
    or exists (
         select 1 from public.lojas
          where id = p_loja_id and dono_id = auth.uid()
       )
  ) then
    raise exception 'modal_sazonal: sem posse';
  end if;

  -- S3: forma dos arrays. A RPC pode ser chamada DIRETO pelo PostgREST com a
  -- sessão do dono, contornando o zod. `cardinality()` e nunca o comprimento
  -- por dimensão: em array multidimensional ele conta só a 1ª dimensão e
  -- corromperia a contagem (achado de 20260908130000) — por isso também
  -- `array_ndims <= 1` (NULL em array vazio). Teto 50 = espelho de TETO_SELECAO.
  if coalesce(array_ndims(v_categorias), 1) > 1
     or coalesce(array_ndims(v_cardapios), 1) > 1
     or cardinality(v_categorias) > 50
     or cardinality(v_cardapios) > 50
     or exists (select 1 from unnest(v_categorias) as x(id) where x.id is null)
     or exists (select 1 from unnest(v_cardapios) as x(id) where x.id is null)
     or (select count(distinct x.id) from unnest(v_categorias) as x(id)) <> cardinality(v_categorias)
     or (select count(distinct x.id) from unnest(v_cardapios) as x(id)) <> cardinality(v_cardapios)
  then
    raise exception 'modal_sazonal: selecao invalida';
  end if;

  -- S4: a linha é escrita PRIMEIRO para que as FKs compostas das junções tenham
  -- alvo. `ativo` NUNCA é escrito aqui (transição de estado é de
  -- ativar/desativar, RN-05): no INSERT fica no default `false`.
  if p_modal_id is null then
    insert into public.modais_sazonais (
      loja_id, titulo, exibicao_inicio, exibicao_fim, mensagem, mostrar_promocoes_junto
    ) values (
      p_loja_id, p_titulo, p_exibicao_inicio, p_exibicao_fim, p_mensagem,
      coalesce(p_mostrar_promocoes_junto, false)
    )
    returning id into v_id;
  else
    update public.modais_sazonais
       set titulo                  = p_titulo,
           exibicao_inicio         = p_exibicao_inicio,
           exibicao_fim            = p_exibicao_fim,
           mensagem                = p_mensagem,
           mostrar_promocoes_junto = coalesce(p_mostrar_promocoes_junto, mostrar_promocoes_junto),
           atualizado_em           = now()
     where id = p_modal_id
       and loja_id = p_loja_id   -- escopo explícito ALÉM da RLS
    returning id into v_id;

    -- 0 linhas: modal de outra loja OU inexistente. MESMA mensagem nos dois
    -- casos e sem o id — nenhum oráculo de existência. Vale igual para a via de
    -- serviço: `p_loja_id` da URL + `p_modal_id` de outra loja recusa aqui,
    -- ANTES de qualquer escrita (sob service_role a RLS não denunciaria nada).
    if v_id is null then
      raise exception 'modal_sazonal: modal inexistente';
    end if;
  end if;

  -- S5: substitui a seleção. Escopo duplo explícito além da RLS.
  delete from public.modal_sazonal_categorias
   where loja_id = p_loja_id and modal_sazonal_id = v_id;
  delete from public.modal_sazonal_cardapios
   where loja_id = p_loja_id and modal_sazonal_id = v_id;

  -- S6: regrava. A FK COMPOSTA (categoria_id, loja_id) / (cardapio_id, loja_id)
  -- recusa com 23503 id de outra loja ou apagado — o erro nativo propaga (não é
  -- capturado) e desfaz a transação inteira (RN-11 + RN-M15).
  insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
  select p_loja_id, v_id, x.id from unnest(v_categorias) as x(id);
  get diagnostics v_gravadas = row_count;
  if v_gravadas <> cardinality(v_categorias) then
    raise exception 'modal_sazonal: selecao nao gravada';
  end if;

  insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id)
  select p_loja_id, v_id, x.id from unnest(v_cardapios) as x(id);
  get diagnostics v_gravadas = row_count;
  if v_gravadas <> cardinality(v_cardapios) then
    raise exception 'modal_sazonal: selecao nao gravada';
  end if;

  return v_id;
end;
$$;

-- S7: `create or replace` preserva o ACL, mas o revoke/grant é repetido para a
-- migration ser autossuficiente. O revoke nomeia `anon` EXPLICITAMENTE: o
-- projeto concede EXECUTE a `anon`/`authenticated`/`service_role` por
-- `alter default privileges ... on routines` (20260614008500), então revogar só
-- de PUBLIC deixaria `anon` executando pela entrada própria na ACL, com a anon
-- key do bundle público. `service_role` entra no grant agora (via admin, 362).
revoke all on function public.salvar_modal_sazonal(
  uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[]
) from public, anon;
grant execute on function public.salvar_modal_sazonal(
  uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[]
) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Overload de 2 args de `ativar_modal_sazonal` — SÓ a via de serviço.
--
-- Por que um overload e não um argumento opcional: `default null` no 2º
-- parâmetro tornaria `ativar_modal_sazonal($1)` AMBÍGUA (duas candidatas de 1
-- arg) e quebraria a action do lojista. Com dois `prosrc` distintos, o 1-arg
-- (20260927125000) continua intacto e é o único que `authenticated` alcança.
--
-- A loja-alvo é amarrada NO BANCO (`loja_id = p_loja_id`), não por pré-checagem
-- em TS: entre um SELECT de conferência na Server Action e o UPDATE haveria
-- janela TOCTOU, e sob service_role (BYPASSRLS) nada mais filtraria.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ativar_modal_sazonal(
  p_modal_id uuid,
  p_loja_id  uuid    -- lojaId VALIDADO da URL admin, NUNCA do payload
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  v_id uuid;
begin
  -- A1: via de serviço OBRIGATÓRIA. O ACL (grant só a service_role) já barra
  -- anon/authenticated antes do corpo; esta trava é a segunda camada, para o
  -- caso de claim `role` forjado com role SQL efetivo de usuário.
  if not v_e_servico then
    raise exception 'modal_sazonal: sem sessao';
  end if;

  -- A2: escopo PROVADO antes de tocar em qualquer linha — o modal existe E é da
  -- loja-alvo. Modal inexistente e modal de outra loja dão a MESMA mensagem
  -- (nenhum oráculo de existência). Conferir aqui, e não depois, é o que impede
  -- a loja de ficar com ZERO ativos quando o escopo recusa (RN-M16).
  select m.id into v_id
    from public.modais_sazonais m
   where m.id = p_modal_id
     and m.loja_id = p_loja_id;

  if v_id is null then
    raise exception 'modal_sazonal: modal inexistente';
  end if;

  -- Desliga o anterior ANTES de ligar o alvo (o índice único parcial recusaria
  -- a ordem inversa), na MESMA transação. Escopo por loja explícito.
  update public.modais_sazonais
     set ativo = false, atualizado_em = now()
   where loja_id = p_loja_id
     and ativo
     and id <> p_modal_id;

  -- Idempotente: se o alvo já está ativo, nada a fazer (0 linhas, sem erro).
  update public.modais_sazonais
     set ativo = true, atualizado_em = now()
   where id = p_modal_id
     and loja_id = p_loja_id
     and not ativo;
end;
$$;

-- `authenticated` é revogado EXPLICITAMENTE (além de public e anon): os default
-- privileges de 20260614008500 concedem EXECUTE aos três papéis, então sem este
-- revoke o lojista alcançaria o caminho que amarra a loja POR ARGUMENTO —
-- exatamente o que a via de serviço existe para restringir ao admin.
revoke all on function public.ativar_modal_sazonal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ativar_modal_sazonal(uuid, uuid) to service_role;
