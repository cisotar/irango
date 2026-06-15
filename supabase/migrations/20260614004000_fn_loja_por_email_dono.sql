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
