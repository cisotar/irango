# [007] Util `formatarMoeda`

**crítica:** NÃO
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Função pura de formatação de valor numérico para BRL, usada em toda exibição de preço (vitrine e painel).

## Escopo
- [ ] Criar `src/lib/utils/formatarMoeda.ts`
- [ ] `formatarMoeda(valor: number): string` → `R$ 12,50` via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`

## Fora de escopo
Cálculos monetários (008, 009, 012). Esta issue só formata, não calcula.

## Reuso esperado
- `Intl.NumberFormat` nativo — não criar lógica própria de separador

## Segurança
- Apenas apresentação — não é fonte de valor autoritativo.

## Critério de aceite
- [ ] `formatarMoeda(12.5)` retorna `R$ 12,50`
- [ ] `formatarMoeda(0)` retorna `R$ 0,00`
