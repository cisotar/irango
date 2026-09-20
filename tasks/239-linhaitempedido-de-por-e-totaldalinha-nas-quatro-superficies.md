# [239] `LinhaItemPedido` (o par "de/por") + `totalDaLinha` nas quatro superfícies

**crítica:** NÃO
**Mundo:** painel · vitrine pública
**Depende de:** [226] (`tasks/226-totaldalinha-e-a-invariante-de-soma.md`) e [229] (`tasks/229-criarpedido-snapshot-de-preco-e-a-trava-de-reconfirmacao.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D7, D12, D15 · RN-14, RN-20 · design §11

## Objetivo

Entregar as duas metades de exibição que dependem do snapshot: o par "de R$ 100,00 por R$ 80,00"
por **um** helper (RN-14) e a troca da aritmética de total de linha pela função única (RN-20), nas
**quatro** superfícies de uma vez.

## Escopo

- [ ] `src/lib/utils/linhaItemPedido.ts` — helper `LinhaItemPedido` (nome do **Spec A**, que vence
      em conflito de nome), **puro**: `parDePor(item): { teve, de, por, sufixo } | null` e
      `textoDePor(item): string | null` (variante de texto plano para o WhatsApp);
- [ ] `preco_original === null` ⇒ o helper devolve `null` ⇒ **nada é renderizado**. Nenhuma
      superfície tem um `if` próprio sobre `preco_original` (M3);
- [ ] o par é **unitário**, sempre (RN-14): é o que D7 diz, é o número que o cliente reconhece do
      card, e um par de linha misturaria quantidade, desconto e opcionais. Com `quantidade > 1` o
      par imprime o sufixo `/un.`;
- [ ] as **quatro** superfícies passam a consumir `totalDaLinha` (RN-20) **e** o helper:
      `(publica)/loja/[slug]/confirmacao/page.tsx` (linhas 169-173),
      `components/painel/DetalhePedido.tsx` (202-205, 216-218),
      `components/painel/ReciboCliente.tsx` (87, 95),
      `lib/utils/whatsappPedido.ts` (76-85);
- [ ] `whatsappPedido` e a confirmação passam a usar `mapearOpcionaisExibicao` em vez de ler
      `preco_snapshot` na mão — **nenhum mapper novo**;
- [ ] WhatsApp em texto plano usa **parênteses**, nunca `~tachado~`
      (`- 1x Feijoada completa — R$ 80,00 (de R$ 100,00)`);
- [ ] térmica (§11.3): hierarquia por **tamanho, posição e a palavra "de"** — nunca por cor (no
      papel cinza é preto) e nunca dependendo do `line-through`, que some em 203dpi.

## Fora de escopo

`totalDaLinha` em si (issue 226 — aqui só se **consome**). O selo `[PROMO]` na comanda (issue 240):
a comanda recebe **só o selo, nenhum valor** (D12, RN-14-a). `paraLinhaPedido` / `TabelaPedidos`
**não mudam** — a exclusão é deliberada e confirmada pelo dono do produto; um par por item não cabe
numa linha de tabela de pedidos. Nenhuma coluna de economia agregada. Nenhuma regra `@media print`
nova.

> ⚠️ **Corrigir só uma das quatro telas está errado, mesmo que a tela fique certa.** Quatro
> correções independentes reproduzem exatamente a situação que criou o defeito de D15.

## Reuso esperado

- `src/lib/utils/calcularTotal.ts` → `totalDaLinha` (issue 226) — a **mesma** função que produz
  `calcularSubtotal`.
- `src/lib/utils/rotulosPedido.ts` → `mapearOpcionaisExibicao` (linhas 46-55), que já devolve
  `{ preco, quantidade }` — exatamente o shape de `ItemCalculo.opcionais`.
- `formatarMoeda`, `citarTextoCliente` (WhatsApp) — nada novo.

## Segurança

- Apresentação, sem decisão monetária: a origem do dado (`itens_pedido.preco` /
  `preco_original`, snapshot imutável do banco) é que é crítica, e ela é da issue 229.
- O ganho é de **documento**: a linha do recibo passa a fechar com o subtotal do próprio recibo.
  2 pizzas de R$ 50,00 + 1 borda de R$ 10,00 imprimem **R$ 110,00** (o cobrado), nunca R$ 120,00.
- O texto do WhatsApp é montado no servidor a partir do snapshot; nada é recalculado no envio.

## Critério de aceite

- [ ] `linhaItemPedido.test.ts`: `preco_original === null` ⇒ `null`; com desconto ⇒ par unitário
      com o sufixo `/un.` quando `quantidade > 1`;
- [ ] a linha "2× Pizza R$ 50,00 + borda R$ 10,00" exibe **R$ 110,00** nas quatro superfícies;
- [ ] `grep -rn "preco_snapshot" src/lib/utils/whatsappPedido.ts src/app/\(publica\)/loja/\[slug\]/confirmacao/page.tsx`
      **não devolve nada** (passaram pelo mapper);
- [ ] `grep -rn ") \* item.quantidade\|) \* quantidade" src/components/painel/{DetalhePedido,ReciboCliente}.tsx
      src/lib/utils/whatsappPedido.ts` não mostra nenhuma cópia da aritmética antiga;
- [ ] `calcularTotal.test.ts` continua passando **sem edição**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
