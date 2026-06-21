-- ─────────────────────────────────────────────────────────────────────────────
-- [071] webhook_eventos_billing — registro imutável de eventos do gateway próprio
--
-- Espelha public.webhook_eventos_hotmart (schema_inicial, §2/§4 schema.md): tabela
-- de eventos de webhook com RLS habilitada e SEM policy = deny-all permanente para
-- anon/authenticated. Acesso exclusivo via service_role (BYPASSRLS) — o webhook do
-- gateway insere por aqui (issue 077). Nenhum cliente lê ou escreve.
--
-- Diferenças vs. Hotmart (spec cobranca-assinatura-propria §Modelos de Dados →
-- "Nova tabela webhook_eventos_billing"):
--   - coluna `provider text` → o gateway próprio pode ter múltiplos providers
--   - UNIQUE (provider, evento_id) composto, em vez do UNIQUE simples evento_id
--     → idempotência: replay/entrega dupla com mesmo (provider, evento_id) viola o
--       UNIQUE, sustentando o ON CONFLICT (provider, evento_id) DO NOTHING da rota.
--
-- Aditivo puro (tabela nova, 0 linhas em prod) — sem backfill, sem coreografia.
--
-- GRANTs: o modelo Supabase concede ALL aos três roles e deixa a CONTENÇÃO para a
-- RLS (ver 20260614008500_grants_roles_supabase.sql). Como aquela migration também
-- emitiu ALTER DEFAULT PRIVILEGES, esta tabela já nasce com os GRANTs; o GRANT
-- explícito abaixo é idempotente e torna a migration auto-contida.
--
-- Rollback: ver bloco comentado no fim do arquivo. Janela segura: enquanto a rota
-- 077 não estiver em produção inserindo eventos (DROP perde os eventos gravados).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.webhook_eventos_billing (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  evento_id   text not null,                 -- id único do evento no provider
  tipo        text not null,
  payload     jsonb not null,
  processado  boolean not null default false,
  criado_em   timestamptz not null default now(),
  unique (provider, evento_id)               -- idempotência (espelha UNIQUE do Hotmart)
);

-- RLS habilitada SEM policy: deny-all permanente para anon/authenticated.
-- service_role (BYPASSRLS) é o único caminho de acesso — estado final, não temporário.
alter table public.webhook_eventos_billing enable row level security;

-- GRANTs coerentes com o padrão Supabase (a contenção real é a RLS acima).
grant all on table public.webhook_eventos_billing to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop table if exists public.webhook_eventos_billing;
-- ─────────────────────────────────────────────────────────────────────────────
