# [073] Migration: expand `lojas` (billing_provider, provider_subscription_id, plano_id) + CHECK suspensa/cortesia

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [070]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Generalizar `lojas` para ser agnóstica de provider: adicionar colunas genéricas de billing (nullable, expand) e alinhar o CHECK de `assinatura_status` ao domínio do código (incluir `suspensa` e `cortesia`). Backfill das lojas Hotmart existentes.

## Escopo
- [ ] Migration `supabase/migrations/20260621093000_lojas_expand_billing.sql` seguindo a sequência **expand → backfill** do spec (Modelos de Dados → "Generalizar `lojas`").
- [ ] EXPAND: `ADD COLUMN billing_provider text`, `provider_subscription_id text`, `plano_id uuid REFERENCES planos(id)` (todas nullable).
- [ ] Alinhar CHECK: `DROP CONSTRAINT lojas_assinatura_status_check; ADD CONSTRAINT ... CHECK (assinatura_status IN ('trial','ativa','inadimplente','cancelada','suspensa','cortesia'))`.
- [ ] BACKFILL: `UPDATE lojas SET billing_provider='hotmart', provider_subscription_id = hotmart_subscriber_code WHERE hotmart_subscriber_code IS NOT NULL`.
- [ ] NÃO dropar `hotmart_subscriber_code`/`hotmart_plano` (contract é fase futura — coexistência DA-6).

## Fora de escopo
Atualizar o trigger de proteção (issue 074 — depende desta). Lógica de acesso para `cortesia` (issue 075).

## Reuso esperado
- Sequência expand/backfill segura para tabela com dados (`migrar` / `schema.md` §6).
- FK para `planos` (issue 070).

## Segurança
- O CHECK passa a aceitar `suspensa`/`cortesia`, estados de billing autoritativos. As novas colunas (`billing_provider`, `provider_subscription_id`, `plano_id`) são alvo de PATCH não autorizado pelo lojista — DEVEM entrar na proteção do trigger (issue 074). Marcada crítica porque mexe nas colunas de billing.

## Critério de aceite
- [ ] Teste RED (pglite): `UPDATE lojas SET assinatura_status='cortesia'` agora é aceito pelo CHECK (antes violava); `assinatura_status='valor_invalido'` ainda é rejeitado.
- [ ] Backfill: loja com `hotmart_subscriber_code` passa a ter `billing_provider='hotmart'` e `provider_subscription_id` preenchido.
- [ ] Tipos regenerados refletem as novas colunas e o novo union de status.
