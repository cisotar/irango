# [170] WhatsApp: linha `obs:` por item em `montarLinkWhatsappPedido`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 166 (tipo com `observacao`)
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Encaixar a observação de cada item na mensagem de WhatsApp gerada após o pedido
ser persistido — o texto vem do **snapshot do banco**, não do estado do cliente.

## Escopo

- [ ] `src/lib/utils/whatsappPedido.ts`, no `flatMap` que serializa cada item
      (~l.57-71): quando `item.observacao` existir, acrescentar a linha
      `  obs: <texto>` **depois** da linha do item e das linhas de opcionais.
- [ ] Item sem observação (`null`) não gera linha nem rótulo vazio.
- [ ] Teste em `src/lib/utils/whatsappPedido.test.ts` (criar ao lado do módulo se
      ainda não existir).

## Fora de escopo

- Formatar/quebrar observação longa em várias linhas.
- Qualquer mudança nos totais ou na ordem das seções da mensagem.

## Reuso esperado

- `src/lib/utils/whatsappPedido.ts` — estender o `flatMap` existente; não criar
  função nova de serialização de item.
- `encodeURIComponent` já aplicado à mensagem inteira — **não** escapar de novo.
- `formatarMoeda` — inalterado.

## Segurança

- Texto de cliente na mensagem: o `encodeURIComponent` já existente escapa para a
  URL; não há quebra de query string. Não adicionar escape manual em cima.
- Nenhum valor monetário: a observação não entra em `totalItem` nem nos totais.
- O texto é lido do pedido persistido (autoritativo), não do estado do carrinho.

## Critério de aceite

- [ ] Item com observação produz uma linha `  obs: sem cebola` logo após o item e
      seus opcionais.
- [ ] Item com `observacao: null` não produz linha alguma.
- [ ] Observação com `\n` e com caracteres especiais (`&`, `#`, `?`) gera `href`
      válido após o `encodeURIComponent`.
- [ ] Os totais da mensagem são idênticos com e sem observação.
- [ ] `npx vitest run src/lib/utils/whatsappPedido.test.ts` verde.
