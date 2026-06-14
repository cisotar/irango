# [013] Server Action `validarCupom`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 009, 025
**Spec:** specs/spec_irango_mvp.md (RN-06)

## Objetivo
Server Action que recebe `{ loja_id, codigo, subtotal }`, busca UM cupom no servidor, valida todas as condições e retorna apenas o veredito + desconto. Usada no preview da vitrine (UX) e como base da revalidação no checkout.

## Escopo
- [ ] Criar `src/lib/actions/cupom.ts` (`'use server'`)
- [ ] `validarCupom(loja_id, codigo, subtotal)` → `{ valido: boolean; desconto?: number; motivo?: string }`
- [ ] Regras (RN-06): `ativo = true`, `expira_em` null ou futura, `usos_contagem < usos_maximos` (ou null), `subtotal >= pedido_minimo`
- [ ] Desconto via `calcularDesconto` (009)
- [ ] Nunca retornar a lista de cupons — só o veredito do código digitado
- [ ] Erros internos não vazam ao client (seguranca.md §14)

## Fora de escopo
Incremento de `usos_contagem` (acontece atomicamente no `criarPedido` — 014). Cálculo bruto de desconto (009).

## Reuso esperado
- `buscarCupom` (025), `calcularDesconto` (009)

## Segurança
- Validação completa SEMPRE no servidor — nunca SELECT aberto de cupons no client (seguranca.md §9)
- Rate limit ~20/min por IP (seguranca.md §12) — anti-enumeração de códigos

## Critério de aceite
- [ ] (crítica) Teste vermelho: cupom expirado → inválido; subtotal abaixo do mínimo → inválido; usos esgotados → inválido; cupom válido → desconto correto; código de outra loja → inválido
