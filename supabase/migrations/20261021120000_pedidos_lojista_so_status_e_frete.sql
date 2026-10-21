-- Issue 330 — restringe DELETE e as colunas de identificação de `pedidos` ao lojista.
-- Achado da auditoria da issue 299 (commit 2c4ef61).
--
-- A RLS filtra LINHA, não COLUNA. `20260614008500_grants_roles_supabase.sql` deu
-- GRANT ALL em public.pedidos a anon/authenticated (só INSERT foi revogado depois,
-- em 20260923060457), e a policy `pedidos_acesso_lojista` (20260614002500) era
-- FOR ALL sem cláusula `to`. Com o próprio JWT, via PostgREST direto, o dono:
--   - apagava pedido (DELETE /rest/v1/pedidos) — some histórico, relatório e prova;
--   - reescrevia token_acesso, nome/telefone/endereço do cliente, criado_em,
--     loja_id (dentro das próprias lojas), observacoes etc.
-- Os triggers de valor (20260925130000), status (20260930130000) e cliente_id
-- (20261003120000) cobrem só as colunas que conhecem; coluna nova nascia editável.
--
-- Correção: privilégio por COLUNA (allowlist) + policies separadas por comando.
--   - revoke update, delete, truncate, trigger, references de anon/authenticated;
--   - grant update só em (status, taxa_entrega, total, frete_a_combinar) a
--     authenticated — exatamente o que src/lib/actions/status.ts e
--     src/lib/actions/freteCombinado.ts gravam. Coluna nova nasce NÃO editável.
--   - `pedidos_acesso_lojista` (FOR ALL) vira `pedidos_select_lojista` (FOR SELECT)
--     + `pedidos_update_lojista` (FOR UPDATE), ambas `to authenticated`, mesmo
--     predicado de dono. Sem policy de DELETE: deny-all por RLS também.
-- SELECT de anon/authenticated segue concedido (a RLS filtra a linha);
-- `pedidos_select_cliente` (20261003120000) NÃO é tocada.
--
-- Caminhos de sistema NÃO dependem do grant de authenticated:
--   - `anonimizar_pedidos_do_cliente()` (trigger) e `expurgar_pedidos_antigos()`
--     são SECURITY DEFINER com owner postgres
--     (20261003123000_anonimizar_cliente_pedidos.sql:30-50,133) — rodam com o
--     privilégio do dono, não do chamador;
--   - checkout (`criar_pedido`) e confirmação rodam sob service_role (BYPASSRLS,
--     grant próprio, intocado aqui).
--
-- Sem mudança de coluna (database.types.ts intacto). Idempotente.

revoke update, delete, truncate, trigger, references on public.pedidos from anon, authenticated;

grant update (status, taxa_entrega, total, frete_a_combinar) on public.pedidos to authenticated;

drop policy if exists "pedidos_acesso_lojista" on public.pedidos;
drop policy if exists "pedidos_select_lojista" on public.pedidos;
drop policy if exists "pedidos_update_lojista" on public.pedidos;

-- Dono lê só os pedidos das próprias lojas.
create policy "pedidos_select_lojista"
  on public.pedidos for select to authenticated
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- Dono atualiza (status / frete combinado) só os pedidos das próprias lojas.
-- WITH CHECK mantido como defesa em profundidade: loja_id já não tem grant de
-- UPDATE, mas uma regressão no grant não reabre a troca de loja.
create policy "pedidos_update_lojista"
  on public.pedidos for update to authenticated
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Reabre DELETE e a reescrita de token_acesso/PII/criado_em/loja_id pelo lojista
-- via PostgREST direto. Só reverta junto de outra proteção.
--
--   drop policy if exists "pedidos_update_lojista" on public.pedidos;
--   drop policy if exists "pedidos_select_lojista" on public.pedidos;
--   create policy "pedidos_acesso_lojista"
--     on public.pedidos for all
--     using (exists (select 1 from public.lojas
--                    where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()))
--     with check (exists (select 1 from public.lojas
--                         where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()));
--   revoke update (status, taxa_entrega, total, frete_a_combinar) on public.pedidos from authenticated;
--   grant update, delete, truncate, trigger, references on public.pedidos to anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────────
