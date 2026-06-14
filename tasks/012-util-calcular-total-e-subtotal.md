# [012] Util `calcularSubtotal` e `calcularTotal`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-05)

## Objetivo
Funções puras de composição financeira do pedido: subtotal a partir de itens (preço do banco × quantidade) e total = subtotal − desconto + frete.

## Escopo
- [ ] Criar `src/lib/utils/calcularTotal.ts`
- [ ] `calcularSubtotal(produtos, itens): number` — soma `preco_do_banco * quantidade`
- [ ] `calcularTotal({ subtotal, desconto, taxaEntrega }): number`
- [ ] Total nunca negativo (clamp em 0)
- [ ] Arredondamento a 2 casas em cada etapa

## Fora de escopo
Frete (008), desconto (009). Esta issue só compõe os valores já calculados.

## Reuso esperado
- `calcularFrete` (008) e `calcularDesconto` (009) são as fontes dos componentes
- Tipos de `src/types/supabase.ts` (017)

## Segurança
- Subtotal usa SEMPRE o preço do banco, nunca o preço enviado pelo client (seguranca.md §10)

## Critério de aceite
- [ ] (crítica) Teste vermelho: subtotal com itens variados; total = subtotal − desconto + frete; total nunca negativo; preço do client é ignorado (só `produto_id`+`quantidade` entram)
