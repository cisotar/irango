# [072] Migration: tabela `pagamentos_assinatura` + RLS por dono

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Criar o histórico de cobranças da assinatura, com `UNIQUE (provider, provider_payment_id)` para idempotência de cobrança e RLS que deixa o lojista ver só as próprias faturas (escopo por `dono_id`), escrita só por `service_role`.

## Escopo
- [ ] Migration `supabase/migrations/20260621092000_pagamentos_assinatura.sql` conforme o spec (Modelos de Dados → "Nova tabela `pagamentos_assinatura`").
- [ ] Colunas: `id`, `loja_id uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE`, `provider text NOT NULL`, `provider_payment_id text`, `valor numeric(10,2) NOT NULL`, `status text CHECK IN ('pendente','pago','falhou','estornado')`, `metodo text`, `fatura_url text`, `competencia timestamptz`, `criado_em timestamptz DEFAULT now()`, `UNIQUE (provider, provider_payment_id)`.
- [ ] Index por `loja_id` para a `TabelaFaturas`.
- [ ] RLS: SELECT só onde `auth.uid() = lojas.dono_id` (join/subquery para `loja_id`).
- [ ] INSERT/UPDATE/DELETE deny-all para `anon`/`authenticated` — só `service_role` (via webhook).

## Fora de escopo
Inserir pagamento (acontece no webhook, issue 077). A `TabelaFaturas` UI (issue 081).

## Reuso esperado
- Padrão de RLS por dono usado em `cupons`/`pedidos` (escopo por `lojas.dono_id`) — `seguranca.md`/`schema.md` §4.
- `numeric(10,2)` para `valor` (`schema.md` §6).

## Segurança
- `valor`/`status` são AUTORITATIVOS do servidor (vêm do webhook), nunca escritos pelo lojista — escrita deny-all é invariante (RN-1, §10).
- SELECT escopado por `dono_id` impede vazamento de faturas entre lojas → crítica.
- `UNIQUE (provider, provider_payment_id)` garante idempotência de cobrança.

## Critério de aceite
- [ ] Teste RED (pglite): lojista A vê só faturas da própria loja; não vê as da loja B; `INSERT/UPDATE` por `authenticated` rejeitado; `service_role` insere; UNIQUE bloqueia 2ª cobrança com mesmo `(provider, provider_payment_id)`.
- [ ] Tipos regenerados incluem `pagamentos_assinatura`.
