-- ─────────────────────────────────────────────────────────────────────────────
-- [073] lojas — expand billing (provider-agnóstico) + CHECK suspensa/cortesia
--
-- Generaliza `lojas` para ser agnóstica de provider de cobrança e alinha o CHECK
-- de `assinatura_status` ao domínio do código (spec cobranca-assinatura-propria.md
-- → Modelos de Dados → "Generalizar `lojas`").
--
-- Tabela COM dados em prod → sequência EXPAND segura (schema.md §6):
--   - Colunas novas NULLABLE (não quebram INSERT/UPDATE existentes; sem default
--     que exija reescrita de toda a tabela).
--   - BACKFILL idempotente das lojas Hotmart na MESMA migration (UPDATE só toca
--     linhas com hotmart_subscriber_code preenchido).
--   - As colunas legadas `hotmart_subscriber_code`/`hotmart_plano` NÃO são dropadas
--     aqui — coexistência DA-6 / contract é fase futura.
--
-- RLS: `lojas` já tem RLS e políticas (20260614001000_rls_lojas). Esta migration
-- NÃO cria nem altera política alguma. As novas colunas de billing são alvo de
-- PATCH não autorizado pelo lojista e DEVEM entrar no trigger de proteção
-- (lojas_protege_billing) — isso é a issue 074, FORA do escopo desta migration.
--
-- CHECK: o constraint inline da coluna recebeu o nome auto-gerado pelo Postgres
-- `lojas_assinatura_status_check` (padrão <tabela>_<coluna>_check). O conjunto
-- atual já inclui 'suspensa'; falta apenas 'cortesia'. Recriamos o constraint com
-- ambos para deixar o set completo e explícito.
--
-- Rollback: ver bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────── EXPAND (colunas nullable)
alter table public.lojas
  add column if not exists billing_provider         text,   -- 'hotmart' | '<gateway>' (DA-1); NULL = sem provider (trial puro)
  add column if not exists provider_subscription_id text,   -- id da assinatura no provider (genérico)
  add column if not exists plano_id                 uuid references public.planos(id);  -- ON DELETE RESTRICT (default): plano em uso não some

-- ─────────────────────────────────────────────── CHECK assinatura_status (+cortesia)
alter table public.lojas
  drop constraint if exists lojas_assinatura_status_check;

alter table public.lojas
  add constraint lojas_assinatura_status_check
  check (assinatura_status in ('trial','ativa','inadimplente','cancelada','suspensa','cortesia'));

-- ─────────────────────────────────────────────────────── BACKFILL (lojas Hotmart)
-- Idempotente: só preenche onde ainda não há billing_provider, e só linhas que de
-- fato têm o código Hotmart. Re-aplicar a migration não reescreve dado já migrado.
update public.lojas
   set billing_provider         = 'hotmart',
       provider_subscription_id = hotmart_subscriber_code
 where hotmart_subscriber_code is not null
   and billing_provider is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   -- restaura o CHECK anterior (sem 'cortesia'):
--   alter table public.lojas drop constraint if exists lojas_assinatura_status_check;
--   alter table public.lojas add constraint lojas_assinatura_status_check
--     check (assinatura_status in ('trial','ativa','inadimplente','cancelada','suspensa'));
--
--   -- remove as colunas de billing (IRREVERSÍVEL — descarta o backfill):
--   alter table public.lojas
--     drop column if exists billing_provider,
--     drop column if exists provider_subscription_id,
--     drop column if exists plano_id;
--
-- Janela segura: reverter antes de qualquer loja passar a depender das colunas
-- novas (assinatura própria iniciada / cortesia concedida). Após o CHECK aceitar
-- 'cortesia' E existir loja com assinatura_status='cortesia', reverter o CHECK
-- violaria essas linhas — limpe-as antes. DROP das colunas só é seguro enquanto
-- nenhuma loja tiver billing_provider de gateway próprio.
-- ─────────────────────────────────────────────────────────────────────────────
