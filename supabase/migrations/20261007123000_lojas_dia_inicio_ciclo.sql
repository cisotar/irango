-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 354 — migration C: ciclo mensal do relatório de vendas em `lojas`.
-- Spec: specs/relatorio-vendas.md (RN-V08).
-- Plano: plan/tecnico-relatorio-vendas.md §6.4.
--
-- `dia_inicio_ciclo smallint NOT NULL DEFAULT 1`, CHECK 1..28 (fevereiro sempre
-- tem o dia). `ADD COLUMN … NOT NULL DEFAULT <constante>` é metadata-only.
--
-- Não é billing nem PII:
--   - fora de CAMPOS_LOJA_SOMENTE_SERVIDOR (src/lib/actions/admin-loja.ts);
--   - o trigger `lojas_protege_billing` (20260708120000) compara colunas
--     nomeadas e não a bloqueia;
--   - gravável pelo dono via RLS `lojas_update_proprio`
--     (20260614001000_rls_lojas.sql) e pelo admin via `escopo.atualizarLoja`;
--   - NÃO entra na view `vitrine_lojas` (projeção com colunas explícitas).
-- RLS: nenhuma policy nova. Idempotente.
--
-- Rollback:
--   alter table public.lojas
--     drop constraint if exists lojas_dia_inicio_ciclo_check,
--     drop column if exists dia_inicio_ciclo;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists dia_inicio_ciclo smallint not null default 1;

alter table public.lojas drop constraint if exists lojas_dia_inicio_ciclo_check;
alter table public.lojas
  add constraint lojas_dia_inicio_ciclo_check check (dia_inicio_ciclo between 1 and 28);

comment on column public.lojas.dia_inicio_ciclo is
  'RN-V08: dia (1..28) em que comeca o ciclo mensal do relatorio de vendas. Nao e billing nem PII: fora de CAMPOS_LOJA_SOMENTE_SERVIDOR e do trigger lojas_protege_billing; gravavel pelo dono (lojas_update_proprio) e pelo admin (escopo.atualizarLoja). Nao entra em vitrine_lojas.';
