-- ─────────────────────────────────────────────────────────────────────────────
-- [070] planos — catálogo de planos de assinatura (preço AUTORITATIVO)
--
-- Tabela base do fluxo de cobrança (spec cobranca-assinatura-propria.md →
-- Modelos de Dados → "Nova tabela planos"). `lojas.plano_id` (issue 073) vai
-- referenciar esta tabela, então ela vem primeiro.
--
-- `preco` é a ÚNICA fonte do valor cobrado (RN-1). O lojista NUNCA escreve nesta
-- tabela: a contenção de escrita é uma invariante de segurança.
--   - SELECT permitido a `authenticated` apenas onde ativo = true (catálogo
--     semipúblico ao lojista logado; planos retirados não vazam).
--   - INSERT/UPDATE/DELETE: deny-all para anon/authenticated. Em RLS, sem policy
--     permissiva a operação é negada — só `service_role` (BYPASSRLS) escreve,
--     via migration/admin. Mesmo padrão de escrita travada de
--     webhook_eventos_hotmart (schema.md §4).
--
-- `numeric(10,2)` para dinheiro (schema.md §6); nunca float.
--
-- Tabela nova SEM dados em prod → criação direta (sem expand/backfill/contract).
-- RLS + policy na MESMA migration (seguranca.md §2): tabela nunca nasce sem RLS.
--
-- GRANTs: ALTER DEFAULT PRIVILEGES (20260614008500) já concede a tabelas FUTURAS,
-- mas explicitamos aqui para não depender da ordem de aplicação. A contenção real
-- é a RLS, não o GRANT (modelo Supabase).
--
-- Rollback: ver bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.planos (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  preco             numeric(10,2) not null check (preco >= 0),  -- AUTORITATIVO (RN-1)
  intervalo         text not null default 'mensal' check (intervalo in ('mensal','anual')),
  provider_price_id text,        -- id do preço/plano no provider (ex: Stripe price_xxx)
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.planos enable row level security;

-- SELECT: lojista logado lê apenas planos ativos. Sem leitura para anon.
-- Sem policy de INSERT/UPDATE/DELETE = escrita deny-all (só service_role).
create policy "planos_leitura_ativos"
  on public.planos
  for select
  to authenticated
  using (ativo = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (coerentes com 20260614008500_grants_roles_supabase)
-- ─────────────────────────────────────────────────────────────────────────────
grant all on public.planos to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed — plano único mensal (DA-3). Preço PLACEHOLDER (R$ 49,00); o valor real e
-- o provider_price_id são definidos pelo dono do SaaS antes do go-live.
-- Idempotente: re-aplicar a migration não duplica o seed.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.planos (nome, preco, intervalo, ativo)
select 'Plano Mensal', 49.00, 'mensal', true
where not exists (
  select 1 from public.planos where nome = 'Plano Mensal' and intervalo = 'mensal'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop policy if exists "planos_leitura_ativos" on public.planos;
--   drop table if exists public.planos;  -- irreversível: descarta o catálogo
--
-- Janela segura: até lojas.plano_id (issue 073) passar a referenciar esta tabela.
-- Depois disso, o DROP exige tratar a FK primeiro.
-- ─────────────────────────────────────────────────────────────────────────────
