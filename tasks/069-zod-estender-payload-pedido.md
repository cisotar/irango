# [069] Estender schema zod do payload de pedido (tipo_entrega, endereço condicional, troco)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 067
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Estender `schemaPayloadPedido` em `lib/validacoes/pedido.ts` com `tipo_entrega`, `troco_para`, `endereco_entrega` opcional com refinamento condicional, mantendo `.strict()` (campos monetários rejeitados).

## Escopo
- [ ] Adicionar `tipo_entrega: z.enum(['retirada','entrega'])`
- [ ] Tornar `endereco_entrega` `.optional()` (já existe o objeto com `.strict()`); incluir `cidade`/`uf` conforme spec
- [ ] Adicionar `troco_para: z.number().positive().optional()`
- [ ] `forma_pagamento` permanece enum `['pix','dinheiro','link','cartao']`
- [ ] `.refine(d => d.tipo_entrega === 'retirada' || !!d.endereco_entrega, { message:'Endereço obrigatório para entrega', path:['endereco_entrega'] })`
- [ ] Manter `.strict()` na raiz e nos itens

## Fora de escopo
- Consumo do schema na Server Action (issue 071).
- Componentes de form (issues 074-076).

## Reuso esperado
- `lib/validacoes/pedido.ts` (`schemaPayloadPedido`, `schemaEnderecoEntrega`, `schemaItemPedido`) — estender, não recriar.
- `seguranca.md` §10 — `.strict()` como decisão de segurança.

## Segurança
- `.strict()` rejeita qualquer campo monetário extra mesmo se enviado.
- Refinamento condicional garante endereço presente para entrega (a autoridade final é a Server Action — issue 071).
- `troco_para` validado como número positivo se presente; não entra em cálculo (RN-C3).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde: payload com `total:0.01` extra é rejeitado; `tipo_entrega='entrega'` sem `endereco_entrega` falha no refine; `tipo_entrega='retirada'` sem endereço passa; `troco_para` negativo falha.
