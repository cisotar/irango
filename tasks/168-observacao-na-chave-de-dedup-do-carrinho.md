# [168] Carrinho: observação entra na chave de dedup de `linhaCarrinhoId`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 167
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Fazer a observação fazer parte da **identidade da linha do carrinho**: mesmo
produto + mesmos opcionais + observações diferentes = duas linhas distintas. E
levar o campo de `ItemCarrinho` até `ItemPayload` no payload da Server Action.

## Por que é crítica

`linhaCarrinhoId` é a chave que governa a **quantidade** de cada linha: o
`adicionar` soma quantidade quando as chaves batem, e `incrementar`/`decrementar`/
`remover` casam a linha por essa mesma chave. Se a observação ficar fora da chave,
duas adições distintas se fundem numa linha só — uma observação é silenciosamente
perdida e a **quantidade enviada ao servidor muda**, alterando o valor recalculado.
Se entrar errada, o inverso: linhas que deveriam somar se multiplicam. São **6
chamadas em 3 arquivos** e há retrocompat a preservar (a chave hoje é o `produtoId`
puro quando não há opcionais, e `EtapaItens`/`Carrinho` dependem disso).

## Escopo

- [ ] `src/types/dominio.ts`: `ItemCarrinho` ganha `observacao?: string`.
- [ ] `src/components/vitrine/checkout/estado.ts`: `ItemPayload` ganha
      `observacao?: string`; `montarPayloadPedido` propaga o campo do `ItemCarrinho`
      para o payload — **sem** tocar em nada monetário.
- [ ] `src/hooks/useCarrinho.ts`: `linhaCarrinhoId(produtoId, opcionais, observacao?)`
      passa a incluir a observação na assinatura. Manter a **retrocompat**: sem
      opcionais e sem observação a chave continua sendo o `produtoId` puro (o
      comentário da linha 33 e o `id` aceito por `incrementar`/`decrementar`/
      `remover` dependem disso).
- [ ] Atualizar as **6 chamadas** de `linhaCarrinhoId`:
      `src/hooks/useCarrinho.ts` (l.105, 107, 112, 125, 136, 145),
      `src/components/vitrine/Carrinho.tsx` (l.62),
      `src/components/vitrine/checkout/EtapaItens.tsx` (l.111) — e o comentário de
      doc da l.36 do `EtapaItens`.
- [ ] `src/components/vitrine/ProdutoModal.tsx`: a assinatura de `onAdicionar` e a
      chamada em `confirmar()` (~l.145) passam a carregar a observação. **Só o
      contrato** — o `<textarea>` é a issue 169.
- [ ] Teste em `src/hooks/useCarrinho.test.ts` / `estado.test.ts` (arquivos
      vizinhos ao módulo).

## Fora de escopo

- Renderizar a observação no carrinho ou no `EtapaItens` (preview visual) — não é
  requisito da spec e não pertence aqui.
- O `<textarea>` e o contador → issue 169.
- Qualquer alteração no cálculo de subtotal — `calcularSubtotal` ignora o campo.

## Reuso esperado

- `src/hooks/useCarrinho.ts` — estender `linhaCarrinhoId`, **não** criar segunda
  função de chave; duplicar a lógica de assinatura é o modo de introduzir a
  divergência que esta issue existe para evitar.
- `src/lib/utils/calcularTotal.ts` (`calcularSubtotal`) — inalterado.
- `src/lib/constants/pedido.ts` (`LIMITE_OBSERVACAO`, issue 167) se algum corte de
  string for necessário — nunca literal `200`.

## Segurança

- É estado de cliente: **preview, não autoridade**. O tamanho já foi travado no
  servidor pela 167 e o valor é recalculado do banco.
- O impacto de segurança está na **quantidade**: a chave de dedup determina quantas
  unidades vão no payload, e a quantidade entra no recálculo do servidor. Toda
  mudança aqui exige teste que prove a contagem de linhas e a quantidade por linha.
- `montarPayloadPedido` continua enviando **só intenção**, nunca
  `preco`/`subtotal`/`total` (`seguranca.md` §10).

## Critério de aceite

- [ ] Teste vermelho escrito e com `FAIL` capturado antes do código de produção.
- [ ] Mesmo produto + mesmos opcionais + observações **diferentes** → 2 linhas, cada
      uma com sua quantidade e sua observação.
- [ ] Mesmo produto + mesmos opcionais + **mesma** observação → 1 linha com as
      quantidades somadas.
- [ ] Mesmo produto sem opcionais e sem observação → chave continua sendo o
      `produtoId` puro (retrocompat); `incrementar`/`decrementar`/`remover` seguem
      funcionando com essa chave.
- [ ] Uma linha com observação e outra sem, do mesmo produto → 2 linhas distintas.
- [ ] `montarPayloadPedido` inclui `observacao` por item e nenhum campo monetário.
- [ ] `grep -rn "linhaCarrinhoId(" src/` mostra todas as chamadas com a assinatura
      nova; `npm run build` verde.
