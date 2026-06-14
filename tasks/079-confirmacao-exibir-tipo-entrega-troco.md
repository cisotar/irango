# [079] Confirmação — exibir `tipo_entrega` e `troco_para`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 067, 078
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Ajustar a página de confirmação (`/loja/[slug]/confirmacao`) para exibir `tipo_entrega` (retirada vs entrega) e, se pagamento em dinheiro, `troco_para` — sem alterar o visual base.

## Escopo
- [ ] Ler `tipo_entrega` e `troco_para` na leitura por id + token (server-side, service_role)
- [ ] Exibir "Retirada" ou "Entrega" (e ocultar bloco de endereço em retirada)
- [ ] Se `forma_pagamento='dinheiro'` e `troco_para` presente → exibir "Troco para R$ X" nas instruções
- [ ] Não alterar o visual de `design-claude/vitrine/confirmacao.html`

## Fora de escopo
- Mudança de comportamento da confirmação (mantida).
- Migration das colunas (067 — já feito).

## Reuso esperado
- Query de pedido por token em `lib/supabase/queries/pedidos.ts` (existente), `formatarMoeda` (007).

## Segurança
- Leitura escopada por id + token_acesso (service_role) — PII do cliente nunca exposta publicamente sem token.

## Critério de aceite
- [ ] Pedido de retirada mostra "Retirada" e oculta endereço.
- [ ] Pedido em dinheiro com troco mostra "Troco para R$ X".
- [ ] Pedido de entrega mantém exibição de endereço.
