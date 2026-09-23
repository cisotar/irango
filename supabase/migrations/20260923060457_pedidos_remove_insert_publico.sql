-- Issue 294 — remove o INSERT anon/authenticated direto em public.pedidos.
-- Auditoria de segurança de 2026-09-22 (revisada em 2026-09-23): a policy
-- `pedidos_insert_publico` (20260614002500) não tinha cláusula `to`, então valia
-- para {public} — anon E authenticated. Seu WITH CHECK
-- (public.loja_esta_ativa(pedidos.loja_id)) só exigia loja ativa: qualquer um com a
-- anon key gravava um pedido forjado (valores, status e itens arbitrários) direto
-- via PostgREST, contornando o recálculo de valor do servidor (seguranca.md §10).
--
-- O caminho legítimo é a RPC `criar_pedido` (SECURITY INVOKER), chamada pela
-- Server Action de checkout sob service_role — que tem BYPASSRLS e não depende
-- desta policy nem do grant de anon/authenticated. Este drop não afeta o checkout.
--
-- Precedente idêntico: 20260708130000_ip_remove_insert_publico (drop de
-- `itens_pedido_insert_publico`, achado #3A) e 20260621098000 (itens_pedido_opcionais).
-- Aqui, além do drop, revoga-se o privilégio de tabela: defesa em profundidade —
-- uma policy permissiva recriada por engano não reabre a porta sozinha.
--
-- Intactos: `pedidos_acesso_lojista` (dono), `loja_esta_ativa`,
-- `pedido_aceita_itens`, `criar_pedido`. Idempotente.
drop policy if exists "pedidos_insert_publico" on public.pedidos;

revoke insert on public.pedidos from anon, authenticated;

-- ROLLBACK (manual):
-- create policy "pedidos_insert_publico"
--   on public.pedidos for insert
--   with check (public.loja_esta_ativa(pedidos.loja_id));
-- grant insert on public.pedidos to anon, authenticated;
