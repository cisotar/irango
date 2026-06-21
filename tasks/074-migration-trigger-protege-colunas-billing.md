# [074] Migration: estender `lojas_protege_billing` com colunas novas de billing

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [073]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Adicionar `billing_provider`, `provider_subscription_id` e `plano_id` à lista de colunas protegidas do trigger `lojas_protege_billing`, para que o lojista não consiga PATCH direto via PostgREST e auto-promover/trocar plano sem passar pelo webhook.

## Escopo
- [ ] Migration `supabase/migrations/20260621094000_lojas_protege_billing_v2.sql` com `CREATE OR REPLACE FUNCTION public.lojas_protege_billing()`.
- [ ] Manter as colunas já protegidas (`assinatura_*`, `hotmart_*`, `dono_id`) e ADICIONAR à comparação `is distinct from`: `billing_provider`, `provider_subscription_id`, `plano_id`.
- [ ] Manter o bypass para `service_role`/`postgres`/`supabase_admin`.
- [ ] Não recriar o trigger se a assinatura não mudar (só `CREATE OR REPLACE FUNCTION` basta — o trigger já aponta para a função).

## Fora de escopo
Outras colunas. Server Actions que escrevem billing (issues 076/078).

## Reuso esperado
- Função/trigger existentes em `20260614004500_lojas_protege_billing.sql` — ESTENDER, não recriar a estrutura.

## Segurança
- Esta é a barreira que impede vazamento de autorização: sem ela, lojista faz `UPDATE lojas SET plano_id=<plano caro> / billing_provider=NULL` direto e burla cobrança/gate. Invariante central de billing (§9, RN-2, RN-12) → crítica.

## Critério de aceite
- [ ] Teste RED (pglite): como `authenticated` dono da loja, `UPDATE lojas SET billing_provider='x'` / `SET plano_id=<outro>` / `SET provider_subscription_id='y'` é REJEITADO com a exceção do trigger; o mesmo UPDATE como `service_role` passa.
- [ ] Regressão: updates de campos não-billing (nome, slug, tema) continuam permitidos ao dono.
