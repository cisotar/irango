-- ─────────────────────────────────────────────────────────────────────────────
-- [SEC] vitrine_lojas SELECT-only + loja_por_email_dono service_role-only
--
-- Brecha: 20260614008500 fez GRANT ALL ON ALL TABLES/ROUTINES a anon/authenticated
-- e ALTER DEFAULT PRIVILEGES GRANT ALL. A view auto-atualizável vitrine_lojas
-- (definer, dona=postgres, lojas sem FORCE RLS) virou gravável → PATCH/DELETE
-- anônimo bypassa a RLS de lojas. A mesma migration re-grantou EXECUTE em
-- loja_por_email_dono (SECURITY DEFINER, retorna a linha inteira de lojas),
-- desfazendo o revoke da 004000.
--
-- Fix: revoga escrita/execução indevida. NÃO altera RLS de lojas (correta) nem
-- security_invoker da view (definer é deliberado, §19). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) View pública: SELECT-only para os roles da API.
revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;

-- Reafirma a intenção (aditivo, não anula o revoke acima).
grant select on public.vitrine_lojas to anon, authenticated;

-- 2) Fecha a superfície de escrita default para tabelas/views FUTURAS criadas
--    pelo postgres: default privileges volta a SELECT-only para anon/authenticated.
--    (service_role permanece com ALL — precisa para cadastro/BYPASSRLS.)
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;

-- 3) loja_por_email_dono: só service_role executa (o GRANT ALL ON ROUTINES
--    da 008500 reabriu para anon/authenticated).
revoke all on function public.loja_por_email_dono(text) from anon, authenticated, public;
grant execute on function public.loja_por_email_dono(text) to service_role;
