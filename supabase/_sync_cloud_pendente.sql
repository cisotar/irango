-- ============================================================
-- iRango — SYNC CLOUD v2: migrations pendentes (rodar no SQL Editor)
-- Projeto gdlegxatwylhkjcrusyk. Cloud já tem 001+004+005+006+view+helpers (até 002500).
-- Estas 4 ainda NÃO foram aplicadas. A 004500 (trigger de billing) é OBRIGATÓRIA
-- antes de qualquer deploy — sem ela, lojista auto-promove assinatura via PostgREST.
-- Rode tudo de uma vez (ordem importa). Depois regenere os tipos.
-- ============================================================

-- ╔═══ 20260614003000_rpc_criar_pedido.sql
-- Issue 014 — RPC transacional `public.criar_pedido` (recálculo autoritativo).
--
-- O coração anti-fraude do marketplace (seguranca.md §10). A Server Action
-- `criarPedido` recalcula TODO valor monetário a partir do banco (utils puros) e
-- delega à esta RPC a parte que PRECISA ser atômica:
--   1. defesa em profundidade: barra loja inativa mesmo via service_role (RAISE);
--   2. trava atômica de cupom (anti over-use, RN-06): UPDATE ... WHERE usos<max
--      RETURNING — se NOT FOUND, esgotou na corrida → anula desconto e recomputa
--      total (D5: NÃO rejeita o pedido — a RPC é a autoridade FINAL do total);
--   3. INSERT pedido + INSERT itens (snapshot nome/preco) na MESMA transação.
--
-- Role (D3/D4): SECURITY INVOKER — o único caller é a action via service_role
-- (já BYPASSRLS). REVOKE de public/anon/authenticated (anon NUNCA cria pedido
-- sem passar pela action que recalcula); GRANT EXECUTE só a service_role.
-- `set search_path = public` é hygiene contra search_path hijack (mesmo padrão
-- de loja_esta_ativa).

create function public.criar_pedido(
  p_loja_id          uuid,
  p_nome_cliente     text,
  p_telefone_cliente text,
  p_endereco_entrega jsonb,
  p_forma_pagamento  text,
  p_observacoes      text,
  p_subtotal         numeric,
  p_taxa_entrega     numeric,
  p_desconto         numeric,
  p_total            numeric,
  p_cupom_id         uuid,
  p_cupom_codigo     text,
  p_itens            jsonb
)
  returns table (pedido_id uuid, token_acesso uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_desconto     numeric := p_desconto;
  v_total        numeric := p_total;
  v_cupom_codigo text    := p_cupom_codigo;
  v_pedido_id    uuid;
  v_token        uuid;
begin
  -- (1) defesa em profundidade: loja inativa abortada no banco, não só na action.
  if not public.loja_esta_ativa(p_loja_id) then
    raise exception 'loja_inativa';
  end if;

  -- (2) trava atômica de cupom (anti over-use / race). 0 linhas ⇒ esgotou na
  --     corrida ⇒ anula desconto, zera código e recomputa total (D5).
  if p_cupom_id is not null then
    update public.cupons
       set usos_contagem = usos_contagem + 1
     where id = p_cupom_id
       and (usos_maximos is null or usos_contagem < usos_maximos);
    if not found then
      v_desconto := 0;
      v_cupom_codigo := null;
      v_total := p_subtotal + p_taxa_entrega;
    end if;
  end if;

  -- (3) INSERT pedido (token_acesso via DEFAULT gen_random_uuid()).
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente'
  )
  returning id, public.pedidos.token_acesso into v_pedido_id, v_token;

  -- (4) INSERT itens com SNAPSHOT (nome/preco vêm do banco via action, não do cliente).
  insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
  select v_pedido_id,
         (i->>'produto_id')::uuid,
         i->>'nome',
         (i->>'preco')::numeric,
         (i->>'quantidade')::int
  from jsonb_array_elements(p_itens) as i;

  return query select v_pedido_id, v_token;
end;
$$;

revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) to service_role;


-- ╔═══ 20260614003500_unique_loja_por_dono.sql
-- RN-01 (v1): uma loja por dono. Defesa em profundidade — a checagem
-- autoritativa é contarLojasDoDono na Server Action (015); o índice barra
-- corridas de duplo-submit que passem pelas duas contagens antes do INSERT.
-- Fase 2 (N lojas por dono) remove este índice por migration. (architecture.md §10)
create unique index lojas_dono_unico on public.lojas(dono_id);


-- ╔═══ 20260614004000_fn_loja_por_email_dono.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- [057] fn_loja_por_email_dono — mapeamento comprador→loja para o webhook Hotmart
-- ─────────────────────────────────────────────────────────────────────────────
-- O webhook (rodando com service_role) precisa achar a loja cujo DONO tem um dado
-- e-mail. Esse vínculo está em `auth.users.email`, que NÃO é tabela PostgREST —
-- service_role não consegue `.from("auth.users")`. A solução (D5) é uma função
-- SECURITY DEFINER que faz o JOIN `lojas ⋈ auth.users` por `lower(email)`.
--
-- `security definer` + `set search_path = public` é a mesma higiene de
-- `loja_esta_ativa`/`criar_pedido` (seguranca.md §2/§10): roda com o dono da
-- função, com search_path fixo contra hijack.
--
-- Execução restrita a service_role: anon/authenticated NUNCA mapeiam e-mail→loja
-- (vazaria PII e o vínculo dono↔loja). O webhook é o único caller legítimo.
create function public.loja_por_email_dono(p_email text)
  returns setof public.lojas
  language sql
  stable
  security definer
  set search_path = public
as $$
  select l.*
  from public.lojas l
  join auth.users u on u.id = l.dono_id
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.loja_por_email_dono(text) from public, anon, authenticated;
grant execute on function public.loja_por_email_dono(text) to service_role;


-- ╔═══ 20260614004500_lojas_protege_billing.sql
-- FIX CRÍTICO (auditoria 057): proteger colunas de billing/identidade de lojas.
--
-- A RLS filtra LINHA, não COLUNA. A policy lojas_update_proprio concede UPDATE
-- da linha inteira ao dono autenticado — então o lojista, via PostgREST direto,
-- poderia reescrever assinatura_status/hotmart_*/dono_id e auto-promover sua
-- assinatura (acesso grátis ao produto pago). Vazamento de autorização.
--
-- Correção: trigger BEFORE UPDATE que REJEITA mudança dessas colunas quando o
-- autor NÃO é sistema (service_role / migrations). O webhook Hotmart roda como
-- service_role e CONTINUA escrevendo billing. Aditivo, sem rollback de dados.

create or replace function public.lojas_protege_billing()
returns trigger
language plpgsql
as $$
begin
  -- Autor é o sistema (webhook Hotmart via service_role, ou migrations/backfill).
  if current_user = 'service_role'
     or current_user = 'postgres'
     or current_user = 'supabase_admin' then
    return new;
  end if;

  -- Demais autores (dono autenticado etc.) não podem tocar billing/identidade.
  if new.assinatura_status        is distinct from old.assinatura_status
     or new.assinatura_inicio         is distinct from old.assinatura_inicio
     or new.assinatura_fim_periodo    is distinct from old.assinatura_fim_periodo
     or new.assinatura_atualizada_em  is distinct from old.assinatura_atualizada_em
     or new.hotmart_subscriber_code   is distinct from old.hotmart_subscriber_code
     or new.hotmart_plano             is distinct from old.hotmart_plano
     or new.dono_id                   is distinct from old.dono_id then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook Hotmart)';
  end if;

  return new;
end;
$$;

create trigger lojas_protege_billing_trg
  before update on public.lojas
  for each row
  execute function public.lojas_protege_billing();

-- ─────────────────────────────────────────────────────────────────────────────
-- Origem: supabase/migrations/20260614005000_vitrine_lojas_assinatura.sql
-- Issue 058 — expor estado de assinatura na vitrine pública.
-- Recria a view `vitrine_lojas` adicionando assinatura_status +
-- assinatura_fim_periodo (estado operante; não PII/pagamento). `create or
-- replace view` não permite mudar a lista de colunas → drop + create.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists public.vitrine_lojas;

create view public.vitrine_lojas
  with (security_invoker = false)
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
    assinatura_fim_periodo
  from public.lojas
  where ativo = true;

grant select on public.vitrine_lojas to anon, authenticated;

