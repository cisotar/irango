-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 312 — Migration 2 do modal sazonal com mensagem formatada: RPC
-- transacional `public.salvar_modal_sazonal` (RN-M15).
-- Spec: specs/modal-sazonal-mensagem-formatada.md (§RPC `salvar_modal_sazonal`,
--       travas S1–S7) · RN-M08, RN-M15. Depende de 20260927120000 (grava `mensagem`).
--
-- Grava linha + mensagem + seleção (categorias e cardápios) numa ÚNICA
-- transação: uma função PL/pgSQL roda numa transação só, então qualquer `raise`
-- ou erro de constraint (23503 FK composta, 23505, 23514 CHECK) desfaz TUDO o
-- que ela já escreveu — sem rascunho órfão na criação, sem seleção pela metade
-- na edição. Requests PostgREST separados seriam transações separadas; não há
-- invariante de linha que um trigger DEFERRED pudesse verificar (seleção vazia
-- é válida, RN-M02). Só uma função resolve.
--
-- SECURITY INVOKER, não DEFINER (molde: 20260908120000_rpc_reordenar_categorias):
-- as policies `*_escrita_propria` de `modais_sazonais` e das duas junções
-- (20260925140000) continuam valendo em cada INSERT/UPDATE/DELETE do corpo. As
-- travas S1/S2 são a SEGUNDA camada: fail-closed mesmo se a policy um dia for
-- afrouxada. Admin está fora do escopo.
--
-- Mensagens de `raise` são estáveis (P0001, prefixo `modal_sazonal:`) para os
-- testes afirmarem o fragmento junto do SQLSTATE. Nenhuma inclui id ou dado de
-- entrada. A Server Action traduz qualquer erro para mensagem genérica e loga o
-- detalhe no servidor (`seguranca.md` §14).
--
-- ADITIVA E REVERSÍVEL: só cria uma função. Nenhuma tabela, coluna ou policy.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.salvar_modal_sazonal(
  p_loja_id                 uuid,         -- da Server Action (buscarLojaDoDono), NUNCA do payload
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
  -- Array nulo = seleção vazia (RN-M02: seleção é opcional).
  v_categorias uuid[] := coalesce(p_categorias, '{}'::uuid[]);
  v_cardapios  uuid[] := coalesce(p_cardapios, '{}'::uuid[]);
  v_id         uuid;
  v_gravadas   int;
begin
  -- S1: sessão de usuário obrigatória. anon (já barrado por S7) e o papel de
  -- serviço sem JWT de usuário caem aqui — fail-closed.
  if auth.uid() is null then
    raise exception 'modal_sazonal: sem sessao';
  end if;

  -- S2: posse EXPLÍCITA da loja, antes de tocar em qualquer linha. Não depende
  -- só da RLS.
  if not exists (
    select 1 from public.lojas
     where id = p_loja_id and dono_id = auth.uid()
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
    -- casos e sem o id — nenhum oráculo de existência.
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

-- S7: o Postgres concede EXECUTE a PUBLIC em função nova, E o projeto tem
-- `alter default privileges ... on routines` concedendo EXECUTE a `anon`,
-- `authenticated` e o papel de serviço (20260614008500). Por isso o revoke nomeia
-- `anon` EXPLICITAMENTE: revogar só de PUBLIC deixaria `anon` executando pela
-- entrada própria na ACL, com a anon key do bundle público. Nenhum grant novo ao
-- papel de serviço (spec S7): sem JWT de usuário ele cai em S1 de qualquer jeito.
revoke all on function public.salvar_modal_sazonal(
  uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[]
) from public, anon;
grant execute on function public.salvar_modal_sazonal(
  uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[]
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- ANTES: a Server Action precisa voltar ao caminho antigo (sem RPC), senão
-- criar/editar modal quebra com PGRST202. Depois:
--
--   drop function if exists public.salvar_modal_sazonal(
--     uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[]
--   );
--
-- Não perde dado (a função não guarda estado). Em seguida, se for reverter
-- também a coluna, ver o rollback de 20260927120000.
-- ─────────────────────────────────────────────────────────────────────────────
