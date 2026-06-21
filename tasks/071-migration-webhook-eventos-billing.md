# [071] Migration: tabela `webhook_eventos_billing` + RLS deny-all

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Criar o registro imutável de eventos do gateway próprio, espelhando `webhook_eventos_hotmart`, com `UNIQUE (provider, evento_id)` para idempotência e RLS deny-all permanente.

## Escopo
- [ ] Migration `supabase/migrations/20260621091000_webhook_eventos_billing.sql` conforme o spec (Modelos de Dados → "Nova tabela `webhook_eventos_billing`").
- [ ] Colunas: `id`, `provider text NOT NULL`, `evento_id text NOT NULL`, `tipo text NOT NULL`, `payload jsonb NOT NULL`, `processado boolean DEFAULT false`, `criado_em timestamptz DEFAULT now()`, `UNIQUE (provider, evento_id)`.
- [ ] `ENABLE ROW LEVEL SECURITY` + **nenhuma** policy para `anon`/`authenticated` (deny-all permanente). Acesso exclusivo via `service_role`.
- [ ] GRANTs coerentes: `service_role` com acesso; `anon`/`authenticated` sem.

## Fora de escopo
A rota do webhook (issue 077). Inserção de eventos.

## Reuso esperado
- Espelhar exatamente `webhook_eventos_hotmart` (`schema.md` §2/§4) — mesma postura RLS, só adicionando a coluna `provider` e o UNIQUE composto.

## Segurança
- Idempotência (`UNIQUE (provider, evento_id)`) impede replay/dupla entrega aplicar efeito duas vezes (invariante do webhook). Deny-all permanente impede qualquer leitura/escrita por cliente. Ambos são invariantes de segurança → crítica.

## Critério de aceite
- [ ] Teste RED (pglite): `anon` e `authenticated` não conseguem `SELECT/INSERT/UPDATE/DELETE`; `service_role` insere; segundo `INSERT` com mesmo `(provider, evento_id)` viola o UNIQUE.
- [ ] Tipos regenerados incluem `webhook_eventos_billing`.
