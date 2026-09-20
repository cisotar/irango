-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 265 — correção de achado do `auditar` (severidade BAIXA).
--
-- View definer comum é "flattened": o planner mistura os quals do usuário com os
-- da própria view e ordena por custo. Como `loja_esta_ativa()` é plpgsql (cost
-- 100) e um cast do atacante custa ~0,005, um qual que ERRE citando o dado roda
-- em linha que a view deveria esconder:
--
--   select id from public.vitrine_produtos where nome::int = 1
--     => invalid input syntax for type integer: "SEGREDO-INATIVA"
--
-- ou seja, o nome de produto de loja INATIVA aparece na mensagem de erro.
--
-- `security_barrier = true` proíbe esse pushdown: os quals do usuário passam a
-- ser avaliados DEPOIS dos da view. Custo desprezível aqui — `loja_esta_ativa`
-- já era o termo caro do filtro.
--
-- Vale para as duas views públicas: `vitrine_lojas` tem a mesma propriedade
-- desde que nasceu (20260614001500), e não é achado novo desta issue.
--
-- Aproveita para trocar o `revoke insert, update, delete` de `vitrine_lojas`
-- pelo `revoke all` que `references/seguranca.md` §19 exige. Inerte na prática
-- (os default privileges já são SELECT-only desde 20260702140000), mas a regra
-- escrita e o SQL passam a dizer a mesma coisa.
-- ─────────────────────────────────────────────────────────────────────────────

alter view public.vitrine_produtos set (security_barrier = true);
alter view public.vitrine_lojas   set (security_barrier = true);

revoke all on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;

-- Rollback (sem perda de dado):
--   alter view public.vitrine_produtos reset (security_barrier);
--   alter view public.vitrine_lojas   reset (security_barrier);
