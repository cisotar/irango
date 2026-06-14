# [032] Server Actions de cupons, entrega e pagamento

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 005, 006, 021, 022, 025
**Spec:** specs/spec_irango_mvp.md (Cupons, Entregas, Pagamentos)

## Objetivo
Server Actions de CRUD de cupons, zonas/taxas/bairros e formas de pagamento, com validação zod e escopo à loja.

## Escopo
- [ ] Criar `src/lib/actions/cupom.ts` (estender com CRUD; `validarCupom` já existe em 013), `src/lib/actions/entrega.ts`, `src/lib/actions/pagamento.ts` (`'use server'`)
- [ ] Cupom: `salvarCupom` (valida `schemaCupom`, código único por loja → erro "Este código já existe"), `alternarAtivo`, `removerCupom`
- [ ] Entrega: `salvarZona` (INSERT zona + taxa + bairros conforme tipo), `editarZona`, `alternarZona`, `removerZona`, `gerenciarBairros`
- [ ] Pagamento: `ativarForma`, `atualizarForma` (valida config por tipo — `schemaFormaPagamento` 022), `removerForma`
- [ ] Tudo escopado à loja do `auth.uid()`
- [ ] `revalidatePath` da vitrine

## Fora de escopo
`validarCupom` no checkout (013). UI (045, 046, 047).

## Reuso esperado
- `schemaCupom` (021), `schemaZona`/`schemaTaxa`/`schemaFormaPagamento` (022), queries (025)

## Segurança
- Código de cupom único por loja: validação na action + UNIQUE `(loja_id, codigo)` no banco
- Percentual 1..100 garantido (RN-06); escrita só na própria loja (RN-02)

## Critério de aceite
- [ ] (crítica) Teste vermelho: código de cupom duplicado na loja → erro; lojista B não escreve em zona/forma/cupom de A; cupom percentual `200` rejeitado; chave pix inválida rejeitada
