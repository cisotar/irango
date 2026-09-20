-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 220 (migration 2 de 5 do Spec A) — `lojas.modal_promocoes` (D6).
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md §Modelos de Dados
--       (migration 2) · D6 · RN-16.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md, onda 1.
--
-- O QUE É: preferência operacional da loja — "abrir o modal de promoções na
-- vitrine quando houver produto em promoção". `boolean NOT NULL DEFAULT true`:
-- D6 fecha o default como LIGADO. Mesma família e mesmo padrão de
-- `whatsapp_envio_automatico` (20260704120000) e de `ativo`.
--
-- SEGURO SEM EXPAND/BACKFILL/CONTRACT (aditivo puro):
--   `ADD COLUMN ... DEFAULT <constante>` em Postgres >= 11 NÃO reescreve a
--   tabela: o default vai para o catálogo (pg_attribute.attmissingval) e é
--   materializado só na próxima escrita de cada linha. O NOT NULL é satisfeito
--   para toda linha existente sem rewrite e sem backfill; nenhuma escrita
--   concorrente é perdida. Toda loja existente em produção nasce com o modal
--   ligado — que é exatamente o contrato de D6.
--
-- RLS: NENHUMA política nova, nenhuma alterada. A coluna cai sob as políticas
--   existentes de `lojas`: leitura própria (`lojas_leitura_propria`), UPDATE do
--   dono (`lojas_update_proprio`) e escrita admin via service_role escopada por
--   `id` (`escopo.atualizarLoja`). RLS filtra LINHA, não COLUNA — o lojista A
--   não alcança a linha da loja B, logo não alcança o toggle dela.
--
-- CLASSIFICAÇÃO (spec §Modelos de Dados): NÃO é PII, NÃO é billing. Portanto
--   fica FORA de `CAMPOS_LOJA_SOMENTE_SERVIDOR` e FORA da lista de 14 colunas
--   de `lojas_protege_billing()` — nada aqui toca a trigger. Entra na allowlist
--   explícita de `montarPatchPerfil` na issue 231 (não nesta).
--
-- VIEW `vitrine_lojas`: NÃO é tocada neste arquivo. A recriação da view (que
--   projeta esta coluna para o SSR da vitrine) é a migration seguinte,
--   20260920122000 — separada de propósito para que o diff da view seja lido
--   isolado, sem ruído (é o ponto de maior risco do Spec A).
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists modal_promocoes boolean not null default true;

comment on column public.lojas.modal_promocoes is
  'D6/RN-16: quando true (default), a vitrine abre o modal de promocoes se houver produto com desconto vigente no request. Preferencia de UI: nao e PII nem billing; gravavel pelo dono (allowlist de montarPatchPerfil) e pelo admin. Projetada em public.vitrine_lojas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Ordem obrigatória: PRIMEIRO reverter a 20260920122000 (a view referencia
-- esta coluna — `drop column` com a view dependente falha com 2BP01, e
-- `drop column ... cascade` derrubaria a view inteira e a vitrine junto).
--
-- Janela segura: ATÉ o primeiro lojista desligar o toggle em produção. Antes
-- disso toda linha vale `true` (= default) e a reversão é SEM PERDA. Depois,
-- `drop column` apaga a preferência de quem desligou — irreversível, mas de
-- baixo impacto (é preferência de UI, não dado de negócio).
--
--   alter table public.lojas drop column if exists modal_promocoes;
-- ─────────────────────────────────────────────────────────────────────────────
