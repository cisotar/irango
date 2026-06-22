-- ─────────────────────────────────────────────────────────────────────────────
-- [077] loja_por_subscription_id — mapeamento assinatura→loja para o webhook billing
-- ─────────────────────────────────────────────────────────────────────────────
-- O webhook de billing (rodando com service_role) resolve a loja pelo
-- `provider_subscription_id` do payload (RN-9: o vínculo principal do provider
-- próprio é a assinatura, não o e-mail). Espelha `loja_por_email_dono` (D-1):
-- SECURITY DEFINER, `set search_path = public`, grant restrito a service_role.
--
-- RN-9 vira INVARIANTE DE BANCO: o filtro `billing_provider = p_provider AND
-- provider_subscription_id = p_subscription_id` no SQL garante que um webhook de
-- provider X jamais retorne uma loja de provider Y. Retorna a LINHA COMPLETA da
-- loja (`setof public.lojas`) — o webhook precisa de `assinatura_status`/
-- `assinatura_inicio`/`assinatura_fim_periodo` para os guards RN-10 e primeira
-- ativação; o caller usa `.maybeSingle()`, como `buscarLojaPorEmailDono`.
--
-- Execução restrita a service_role: anon/authenticated NUNCA mapeiam assinatura→
-- loja (vazaria o vínculo provider↔loja e o estado de billing). O webhook é o
-- único caller legítimo.
create or replace function public.loja_por_subscription_id(
  p_provider        text,
  p_subscription_id text
)
  returns setof public.lojas
  language sql
  stable
  security definer
  set search_path = public
as $$
  select l.*
  from public.lojas l
  where l.billing_provider = p_provider          -- RN-9 no banco
    and l.provider_subscription_id = p_subscription_id
  limit 1;
$$;

revoke all on function public.loja_por_subscription_id(text, text) from public, anon, authenticated;
grant execute on function public.loja_por_subscription_id(text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop function if exists public.loja_por_subscription_id(text, text);
--
-- Janela segura: enquanto o webhook (issue 077) não estiver em produção usando o
-- lookup. Depois disso, dropar quebra o mapeamento assinatura→loja do webhook.
-- ─────────────────────────────────────────────────────────────────────────────
