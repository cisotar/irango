# [071] Emenda `criarPedido` + RPC `criar_pedido` (tipo_entrega, troco, frete fallback)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 067, 068, 069, 070
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Atualizar a Server Action `criarPedido` e a RPC `public.criar_pedido` para aceitar `tipo_entrega`/`troco_para`, forçar `taxa_entrega=0` em retirada (RN-C2), aplicar frete com fallback `taxa_entrega_fora_zona` (RN-C4) e manter desconto somente no subtotal (RN-C1).

## Escopo
- [ ] Ajustar signature da RPC `public.criar_pedido` para receber `tipo_entrega` e `troco_para` (nova migration de função)
- [ ] Persistir `tipo_entrega` e `troco_para` no INSERT de `pedidos`
- [ ] RN-C2: se `tipo_entrega='retirada'` → `taxa_entrega=0` e ignorar `endereco_entrega` (não chamar frete)
- [ ] RN-C4: se `tipo_entrega='entrega'` → calcular frete via util (070) com zonas do banco + `lojas.taxa_entrega_fora_zona`; sem zona e sem fallback → recusar com "Entrega não disponível para o seu bairro"
- [ ] RN-C1: `desconto = calcularDesconto(cupom, subtotal)`; `total = (subtotal - desconto) + taxa_entrega` (desconto nunca no frete)
- [ ] Normalização de bairro em escopo = `normalizarBairro` simples (070); reconciliação CEP↔bairro fica para issue 064
- [ ] Manter gates existentes: `lojaAberta` (RN-C6), assinatura, validação de produto (RN-C5)
- [ ] Atualizar Server Action `criarPedido` para repassar os novos campos e usar `schemaPayloadPedido` estendido (069)

## Fora de escopo
- Reconciliação CEP↔bairro (064).
- Idempotência de submit (063).
- UI do wizard (074-076).

## Reuso esperado
- RPC `public.criar_pedido` (014) — emendar, não recriar.
- `lib/utils/calcularFrete.ts` (070), `calcularDesconto.ts`, `calcularTotal.ts`, `lojaAberta.ts` — todas existentes.
- `schemaPayloadPedido` (069).

## Segurança
- Recálculo autoritativo no servidor (seguranca.md §10): cliente nunca envia valor monetário.
- `troco_para` salvo mas fora de qualquer cálculo (RN-C3).
- Cupom esgotado na corrida não bloqueia o pedido — segue sem desconto (decisão de produto na RPC).
- RPC permanece `SECURITY INVOKER` + `SET search_path` + grants restritos (schema.md §6).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - retirada com endereço enviado → `taxa_entrega=0`;
  - entrega bairro fora de zona com `taxa_entrega_fora_zona=8` → frete 8;
  - entrega fora de zona com fallback NULL → pedido recusado;
  - cupom `percentual` aplica desconto só no subtotal, total = (subtotal-desconto)+frete;
  - payload com `total` adulterado é ignorado (servidor recalcula);
  - `troco_para` persiste sem alterar total.
