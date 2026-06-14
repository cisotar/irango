# [009] Util `calcularDesconto`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-05, RN-06)

## Objetivo
Função pura que calcula o valor do desconto de um cupom sobre um subtotal. Usada no preview da vitrine e na validação autoritativa do servidor.

## Escopo
- [ ] Criar `src/lib/utils/calcularDesconto.ts`
- [ ] Assinatura: `calcularDesconto(cupom: { tipo, valor }, subtotal: number): number`
- [ ] `tipo = 'percentual'`: `subtotal * valor / 100`
- [ ] `tipo = 'fixo'`: `valor`
- [ ] Desconto nunca maior que o subtotal (clamp em `subtotal`)
- [ ] Arredondamento a 2 casas

## Fora de escopo
Validação de validade do cupom (ativo/expirado/usos/mínimo) — isso é da Server Action `validarCupom` (013). Esta issue só calcula o valor.

## Reuso esperado
- Tipos de `src/types/supabase.ts` (017)
- Lógica do `lojinhaonline` portada em TS

## Segurança
- Fonte única de cálculo de desconto — reusada no preview e no servidor (seguranca.md §9, §10)

## Critério de aceite
- [ ] (crítica) Teste vermelho: percentual de 10% sobre 100 → 10; fixo de 15 → 15; desconto fixo maior que subtotal é limitado ao subtotal; arredondamento correto
