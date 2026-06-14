# [073] Server Action `validarCupomAction` (preview de cupom)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Nova Server Action pública `validarCupomAction(loja_id, codigo, subtotal_preview)` que retorna `{ valido, desconto_preview, mensagem }` para feedback de UX na Etapa 1 — revalidação autoritativa permanece em `criarPedido`.

## Escopo
- [ ] Criar Server Action `validarCupomAction(loja_id, codigo, subtotal_preview)`
- [ ] Validar input com zod (`loja_id` uuid, `codigo` regex existente, `subtotal_preview` numeric ≥ 0)
- [ ] Buscar cupom `WHERE loja_id AND codigo` via `lib/supabase/queries/`
- [ ] Aplicar regras: ativo, não expirado, `usos_contagem < usos_maximos`, `subtotal_preview >= pedido_minimo`
- [ ] Reusar `calcularDesconto` (lib existente) — desconto só no subtotal (RN-C1)
- [ ] Retornar `{ valido:false, desconto_preview:0, mensagem }` em qualquer falha; `{ valido:true, desconto_preview, mensagem }` em sucesso

## Fora de escopo
- Revalidação/aplicação autoritativa no envio (issue 071 / RPC).
- UI do campo de cupom (issue 074).

## Reuso esperado
- `lib/utils/calcularDesconto.ts` (existente) — reusar, não recriar.
- `lib/validacoes/cupom.ts` para validações de regra (existente).
- Query de cupom em `lib/supabase/queries/`.

## Segurança
- Desconto de PREVIEW; o cupom é revalidado autoritativamente no envio (071). `subtotal_preview` é só para mensagem — o desconto cobrado vem do recálculo server-side sobre o subtotal do banco.
- Action pública; leitura via RLS de cupom.
- Não vazar existência de cupom de outra loja (escopar sempre por `loja_id`).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde: cupom válido percentual → `desconto_preview` correto sobre subtotal; cupom expirado → `valido:false` + mensagem; subtotal abaixo do mínimo → `valido:false`; desconto nunca aplicado ao frete.
