# [022] Validação zod `pedido`, `entrega` e `pagamento`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-05)

## Objetivo
Schemas zod do payload de criação de pedido (só o que o cliente PODE enviar), endereço, zona e forma de pagamento.

## Escopo
- [ ] Criar `src/lib/validacoes/pedido.ts`
- [ ] `schemaPayloadPedido`: `loja_id` uuid, `itens` (array de `{ produto_id uuid, quantidade int > 0 }`), `endereco_entrega` (cep, rua, numero, bairro obrigatórios), `forma_pagamento`, `codigo_cupom` opcional, `nome_cliente` 1+, `telefone_cliente` opcional, `observacoes` opcional
- [ ] **NÃO aceitar** `preco`, `subtotal`, `desconto`, `taxa_entrega`, `total` no schema — devem ser ignorados/rejeitados (seguranca.md §10)
- [ ] Criar `src/lib/validacoes/entrega.ts`: `schemaZona`, `schemaTaxa`, `schemaBairros`
- [ ] Criar `src/lib/validacoes/pagamento.ts`: `schemaFormaPagamento` por tipo (pix valida chave; telefone `55\d{10,11}`, email formato email)

## Fora de escopo
Recálculo no servidor (014). Esta issue só valida o formato de entrada.

## Reuso esperado
- `zod`; reusado no checkout e nas actions de entrega/pagamento

## Segurança
- O schema do pedido é a fronteira que IMPEDE o cliente de enviar valores monetários (seguranca.md §10, tabela "o que o cliente PODE enviar")

## Critério de aceite
- [ ] (crítica) Teste vermelho: payload com `total: 0.01` é descartado/rejeitado (campo não passa); item com `quantidade = 0` rejeitado; endereço sem bairro rejeitado; chave pix telefone fora do formato rejeitada
