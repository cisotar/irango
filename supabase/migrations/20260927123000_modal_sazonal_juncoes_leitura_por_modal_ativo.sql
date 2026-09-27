-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 317 — leitura pública das junções do modal sazonal filtrada POR MODAL
-- ATIVO. Spec: specs/arquivo/modal-divulgacao-sazonal.md (RN-03, rascunho não
-- vaza) · endurecido em specs/modal-sazonal-mensagem-formatada.md.
--
-- Antes (20260925140000) `modal_sazonal_categorias_leitura_publica` e
-- `modal_sazonal_cardapios_leitura_publica` filtravam só `loja_esta_ativa`:
-- `anon` lia as junções de um RASCUNHO (id do rascunho + quais categorias e
-- cardápios a próxima campanha vai divulgar), embora `modais_sazonais` devolvesse
-- zero linhas. Agora a junção só é pública se o SEU modal (`m.id =
-- modal_sazonal_id`, não "algum modal da loja") está ativo numa loja ativa —
-- mesma condição de `modais_sazonais_leitura_publica`.
--
-- `m.loja_id = <junção>.loja_id` é redundante com a FK composta
-- (modal_sazonal_id, loja_id), mas deixa o escopo explícito na policy.
-- `public.loja_esta_ativa()` (security definer) e não EXISTS em `lojas`: a base
-- não tem SELECT público.
--
-- CUSTO: o EXISTS casa `m.id = modal_sazonal_id`, lookup pela PK de
-- `modais_sazonais` (uma linha por junção). A vitrine lê as junções embutidas no
-- SELECT do modal ativo (um modal, até 50 + 50 linhas), então são no máximo ~100
-- lookups por PK por render. Nenhum índice novo é necessário.
--
-- As policies `*_leitura_propria` (dono lê as próprias, inclusive rascunho) e
-- `*_escrita_propria` NÃO mudam. Nenhum GRANT muda.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy "modal_sazonal_categorias_leitura_publica" on public.modal_sazonal_categorias;

create policy "modal_sazonal_categorias_leitura_publica"
  on public.modal_sazonal_categorias for select
  using (
    exists (
      select 1 from public.modais_sazonais m
       where m.id = modal_sazonal_categorias.modal_sazonal_id
         and m.loja_id = modal_sazonal_categorias.loja_id
         and m.ativo
         and public.loja_esta_ativa(m.loja_id)
    )
  );

drop policy "modal_sazonal_cardapios_leitura_publica" on public.modal_sazonal_cardapios;

create policy "modal_sazonal_cardapios_leitura_publica"
  on public.modal_sazonal_cardapios for select
  using (
    exists (
      select 1 from public.modais_sazonais m
       where m.id = modal_sazonal_cardapios.modal_sazonal_id
         and m.loja_id = modal_sazonal_cardapios.loja_id
         and m.ativo
         and public.loja_esta_ativa(m.loja_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático). Reabre o vazamento
-- do rascunho; não perde dado.
--
--   drop policy "modal_sazonal_categorias_leitura_publica" on public.modal_sazonal_categorias;
--   create policy "modal_sazonal_categorias_leitura_publica"
--     on public.modal_sazonal_categorias for select
--     using (public.loja_esta_ativa(modal_sazonal_categorias.loja_id));
--   drop policy "modal_sazonal_cardapios_leitura_publica" on public.modal_sazonal_cardapios;
--   create policy "modal_sazonal_cardapios_leitura_publica"
--     on public.modal_sazonal_cardapios for select
--     using (public.loja_esta_ativa(modal_sazonal_cardapios.loja_id));
-- ─────────────────────────────────────────────────────────────────────────────
