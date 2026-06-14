# [059] Reconciliação de comprador sem conta (compra antes do cadastro)

**crítica:** SIM (TDD red-first)
**Mundo:** auth
**Depende de:** 015, 057
**Spec:** specs/spec_irango_mvp.md (Adendo — Webhook "ramo de reconciliação"; Estados de Borda; RN-A1)

## Objetivo
Quando alguém compra a assinatura na Hotmart **antes** de criar conta no iRango, o webhook gravou o evento com `loja_id = null`. No cadastro, vincular esse(s) evento(s) à loja recém-criada por email igual e aplicar o estado de assinatura correspondente — server-side, sem o lojista poder forjar o vínculo.

## Escopo
- [ ] Criar `src/lib/assinatura/reconciliar.ts` com `reconciliarAssinaturaPendente(email, lojaId)` (server-only, `service_role`)
- [ ] Buscar em `webhook_eventos_hotmart` eventos com `loja_id IS NULL` e `email_comprador = normalizar(email)`
- [ ] Aplicar o evento mais recente relevante via `traduzirEvento` (056) → UPDATE da loja (`assinatura_status`, datas, `hotmart_subscriber_code`, `hotmart_plano`)
- [ ] Atualizar `webhook_eventos_hotmart.loja_id = lojaId` nos eventos reconciliados (não reprocessar de novo)
- [ ] Chamar `reconciliarAssinaturaPendente` ao final da criação da loja na Server Action de cadastro (015), por email do usuário autenticado
- [ ] Idempotência: rodar a reconciliação 2x não muda o estado além do correto

## Fora de escopo
Webhook em si (057). Tradução evento→status (056). Gate de vitrine/checkout (058).

## Reuso esperado
- `traduzirEvento` (056), normalização de email (mesma do webhook 057), helper `service_role`
- `cadastrar` (015) — ponto de chamada

## Segurança
- Vínculo por email só é confiável porque o email do lojista vem da sessão autenticada / `auth.users`, não de input arbitrário do client (RN-A1)
- Escrita de assinatura só via `service_role`; lojista nunca grava status (RN-A5)
- Não vincular evento de email diferente do email confirmado da conta

## Critério de aceite
- [ ] (crítica) Teste vermelho: evento de compra aprovada com `loja_id null` + cadastro com mesmo email → loja vira `ativa` e evento ganha `loja_id`; email diferente → nada reconciliado; rodar 2x não duplica efeito; lojista não consegue reivindicar evento de outro email
