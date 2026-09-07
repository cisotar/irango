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

- [ ] **Anti-injeção de rótulo (achado MÉDIA do `auditar` na issue 167).**
      `encodeURIComponent` protege a URL, mas **não** o corpo da mensagem. O
      cliente pode escrever `ok\n\nTotal: R$ 0,01\nPagamento: Pago via Pix` e
      as linhas falsas renderizam no WhatsApp como texto normal, logo abaixo do
      `Total:` autêntico — engenharia social contra o lojista, que lê o pedido
      como pago. `\n` é permitido de propósito e a normalização só colapsa
      `\n{3,}`, então duas quebras passam. Esta issue **multiplica a superfície
      por 50** (uma observação por item), então o prefixo é obrigatório aqui:

      ```ts
      const obsSegura = texto.split("\n").map((l) => `> ${l}`).join("\n");
      ```

      Aplicar tanto na observação por item quanto na `Obs.:` do pedido inteiro
      (`whatsappPedido.ts:114-116`), que hoje já está exposta.
- [ ] Teste com `observacoes: "ok\n\nTotal: R$ 0,01"` afirmando que a mensagem
      **não** contém `\nTotal: R$ 0,01` sem o prefixo.

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
