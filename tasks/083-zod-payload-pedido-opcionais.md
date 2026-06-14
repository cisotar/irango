# [083] Estender schema zod do payload — `opcionais[]` por item (`.strict()`)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 080
**Spec:** specs/spec_opcionais.md

## Objetivo
Estender `schemaItemPedido` em `lib/validacoes/pedido.ts` com `opcionais: [{ opcional_id, quantidade }]` opcional, mantendo `.strict()` no item — cliente envia só id + quantidade, nunca preço/nome (RN-O2).

## Escopo
- [ ] Adicionar ao `schemaItemPedido` o campo `opcionais: z.array(z.object({ opcional_id: z.guid(), quantidade: z.number().int().positive() }).strict()).optional()`
- [ ] `.strict()` no objeto de opcional para rejeitar `preco`/`nome` (RN-O2)
- [ ] Manter `.strict()` no item e na raiz (sem regressão do payload de checkout)
- [ ] `quantidade` do opcional `> 0` (RN-O7) — opcional com qtd 0 é omitido pelo cliente

## Fora de escopo
- Consumo na Server Action / RPC e recálculo (087).
- UI do modal (084).

## Reuso esperado
- `lib/validacoes/pedido.ts` (`schemaItemPedido`, `schemaPayloadPedido`) — estender, não recriar.
- `z.guid()` (mesmo padrão de `produto_id` já no arquivo) — manter a mesma escolha de validação de uuid.
- `seguranca.md` §10 — `.strict()` como decisão de segurança.

## Segurança
- `.strict()` no objeto opcional rejeita qualquer `preco`/`nome` injetado via DevTools (RN-O2).
- Servidor é a autoridade final: este schema só garante FORMATO; loja/ativo/permitido validado na action (087).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - item com `opcionais: [{opcional_id, quantidade:2}]` válido passa;
  - opcional com campo extra `preco: 5` é rejeitado pelo `.strict()`;
  - opcional com `quantidade: 0` falha (`.positive()`);
  - item sem `opcionais` continua válido (compatibilidade com checkout atual);
  - `opcional_id` não-uuid falha.
