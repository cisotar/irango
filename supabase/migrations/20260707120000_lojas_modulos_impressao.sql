-- ─────────────────────────────────────────────────────────────────────────────
-- [127] lojas.modulo_impressao_a4 + lojas.modulo_impressao_termica (entitlement)
--
-- Adiciona as duas flags de entitlement dos módulos de impressão de pedido
-- (spec 4 / DA-M1 → Opção A), ambas `boolean NOT NULL DEFAULT false`.
--
-- DEFAULT false = FAIL-CLOSED (RN-M1): a loja nasce SEM nenhum módulo pago
-- contratado; o acesso só é liberado quando o billing marcar a flag `true`. Um
-- default `true` (ou a ausência de default) liberaria os módulos pagos para toda
-- loja — burla de billing. Por isso esta migration é crítica e o contrato é
-- provado por teste pglite (tests/migrations/modulos_impressao.test.ts).
--
-- SEGURO SEM EXPAND/BACKFILL/CONTRACT (aditivo puro):
--   `ADD COLUMN ... DEFAULT` em Postgres >= 11 NÃO reescreve a tabela: o default
--   CONSTANTE (`false`) é gravado no catálogo (pg_attribute.atthasmissing/
--   attmissingval) e materializado só na próxima escrita de cada linha. Como o
--   default é a constante `false`, o NOT NULL é satisfeito para toda linha
--   existente sem table rewrite e sem backfill. Mesma classe de mudança de
--   `ativo`/`logo_url` (schema.md §lojas) e da issue 121 (whatsapp_envio_automatico).
--
-- Naming: snake_case, `boolean NOT NULL DEFAULT` — padrão de `ativo`.
--
-- RLS: NENHUMA política nova. As colunas caem sob as políticas existentes de
--   `lojas` (UPDATE do dono + escrita admin via service_role escopada por `id`).
--   Entitlement é gravado pelo billing (issue 128), nunca pela allowlist de perfil.
--
-- VIEW vitrine_lojas: INTOCADA de propósito. Entitlement/billing é dado interno do
--   painel, nunca público — ao contrário da issue 121, a vitrine NÃO deve enxergar
--   quais módulos a loja contratou. A guarda de não-vazamento é permanente e está
--   provada no teste [3] (`select modulo_impressao_* from vitrine_lojas` → 42703).
--
-- Rollback: bloco comentado no fim. Aditivo e reversível.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists modulo_impressao_a4      boolean not null default false,
  add column if not exists modulo_impressao_termica boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   alter table public.lojas drop column if exists modulo_impressao_a4;
--   alter table public.lojas drop column if exists modulo_impressao_termica;
-- ─────────────────────────────────────────────────────────────────────────────
