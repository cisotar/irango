-- ─────────────────────────────────────────────────────────────────────────────
-- [072] pagamentos_assinatura — histórico de cobranças da assinatura própria
--
-- Cria a tabela de histórico de faturas da assinatura do lojista (spec
-- cobranca-assinatura-propria.md → Modelos de Dados → "Nova tabela
-- pagamentos_assinatura"). Alimentada EXCLUSIVAMENTE pelo webhook de billing via
-- service_role (issue 077); nunca escrita pelo lojista.
--
-- Decisões de design (spec §Modelos de Dados / §Segurança, schema.md §6):
--   - valor numeric(10,2): é dinheiro (nunca float). AUTORITATIVO do servidor —
--     vem do webhook do provider, não do cliente (seguranca.md §10, RN-1).
--   - status CHECK ('pendente','pago','falhou','estornado'): defesa-em-profundidade
--     no banco; a autoridade real de escrita é o webhook (service_role).
--   - loja_id ... ON DELETE CASCADE: fatura é filho da loja — some com a loja
--     (schema.md §6, padrão dos demais filhos da loja).
--   - UNIQUE (provider, provider_payment_id): idempotência de cobrança — replay/
--     entrega dupla do webhook não duplica fatura. Idêntico em espírito ao UNIQUE
--     de webhook_eventos. NULL em provider_payment_id NÃO colide (semântica SQL de
--     UNIQUE com NULL): cobranças ainda-sem-id no provider coexistem.
--   - index por loja_id: a TabelaFaturas (issue 081) lê o histórico escopado por
--     loja; o lookup do webhook também resolve por loja.
--
-- RLS (seguranca.md §2 — tabela nova nasce com RLS na mesma migration):
--   - SELECT escopado por dono: lojista vê SÓ as faturas das próprias lojas, via
--     EXISTS contra lojas.dono_id = auth.uid() (mesmo padrão de cupons/pedidos,
--     migration 20260614002500). Loja A não enxerga fatura da loja B.
--   - SEM policy de INSERT/UPDATE/DELETE: com RLS ON, ausência de policy = deny-all
--     para anon e authenticated. Só service_role (BYPASSRLS) escreve, via webhook.
--     valor/status são autoritativos do servidor — o lojista nunca os escreve (RN-1,
--     RN-2). Mesmo modelo deny-all de webhook_eventos_hotmart.
--
-- GRANTs: a 20260614008500 já fez ALTER DEFAULT PRIVILEGES (tabelas futuras nascem
-- com GRANT ALL aos 3 roles); a contenção real é a RLS acima. GRANT explícito aqui
-- por clareza/idempotência — sem ele o role recebe 42501 antes mesmo da policy.
--
-- Aditivo puro — tabela nova, 0 linhas em prod. Sem backfill, sem coreografia
-- expand→contract. Rollback: ver bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.pagamentos_assinatura (
  id                  uuid primary key default gen_random_uuid(),
  loja_id             uuid not null references public.lojas(id) on delete cascade,
  provider            text not null,
  provider_payment_id text,
  valor               numeric(10,2) not null,
  status              text not null
                        check (status in ('pendente','pago','falhou','estornado')),
  metodo              text,
  fatura_url          text,
  competencia         timestamptz,
  criado_em           timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

-- Histórico escopado por loja (TabelaFaturas + lookup do webhook).
create index if not exists pagamentos_assinatura_loja_id_idx
  on public.pagamentos_assinatura (loja_id);

-- Tabela nova nasce com RLS habilitada (seguranca.md §2).
alter table public.pagamentos_assinatura enable row level security;

-- SELECT só o dono das próprias faturas (padrão cupons/pedidos: EXISTS por dono_id).
-- Sem policy de escrita → INSERT/UPDATE/DELETE deny-all p/ anon+authenticated;
-- só service_role (BYPASSRLS) escreve via webhook.
create policy "pagamentos_assinatura_select_dono"
  on public.pagamentos_assinatura for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = pagamentos_assinatura.loja_id
        and lojas.dono_id = auth.uid()
    )
  );

-- GRANTs coerentes com o modelo Supabase (contenção real é a RLS acima).
grant select on public.pagamentos_assinatura to anon, authenticated, service_role;
grant insert, update, delete on public.pagamentos_assinatura to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop policy if exists "pagamentos_assinatura_select_dono" on public.pagamentos_assinatura;
--   drop table if exists public.pagamentos_assinatura;  -- CASCADE não necessário (sem filhos)
--
-- Janela segura: enquanto a tabela tiver 0 fatura real de prod, o DROP não perde
-- dado. Após o webhook (issue 077) começar a inserir, dropar PERDE histórico de
-- cobrança — só reverter recriando do zero.
-- ─────────────────────────────────────────────────────────────────────────────
