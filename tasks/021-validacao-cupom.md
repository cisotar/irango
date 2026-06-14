# [021] Validação zod `cupom`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-06)

## Objetivo
Schema zod de cupom reusado no form e na Server Action de criação/edição.

## Escopo
- [ ] Criar `src/lib/validacoes/cupom.ts`
- [ ] `schemaCupom`: codigo 1+ (uppercase/trim), tipo `percentual|fixo`, `valor > 0`
- [ ] Se `tipo = percentual`: `valor` entre 1 e 100
- [ ] `pedido_minimo >= 0`, `usos_maximos` int positivo ou null, `expira_em` data futura ou null, `ativo` boolean

## Fora de escopo
Validação de validade no momento do uso (ativo/expirado/usos/mínimo) — Server Action `validarCupom` (013). Unicidade do código — banco + Server Action (032).

## Reuso esperado
- `zod`; mesmo schema no `FormCupom` e na action

## Segurança
- Percentual fora de 1..100 abriria desconto absurdo (ex: 1000%) — bloqueado no servidor

## Critério de aceite
- [ ] (crítica) Teste vermelho: percentual `150` rejeitado; `valor = 0` rejeitado; `expira_em` no passado rejeitado; cupom válido aceito
