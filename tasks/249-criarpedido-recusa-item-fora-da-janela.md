# [249] `criarPedido` recusa o **pedido inteiro** por item fora da janela

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [229] (`tasks/229-criarpedido-snapshot-de-preco-e-a-trava-de-reconfirmacao.md`), [246] (`tasks/246-vigenciacardapio-cardapioaberto-e-avaliarvigenciadoproduto.md`) e [245] (`tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14 · RN-08, RN-13
**Fatia crítica:** 4 (recusa do servidor em `criarPedido`)

## Objetivo

Fazer valer o mandato: **a UI não é a proteção**. O card desabilitado é cortesia para quem está
olhando a tela; a recusa é do servidor, no mesmo laço em que `pedido.ts` já recusa produto
indisponível, oculto ou de outra loja.

## Escopo

- [ ] `src/lib/actions/pedido.ts`: **uma condição a mais** no laço de recusa que já existe
      (linhas 173-179), derivada de `avaliarVigenciaDoProduto` — nunca de aritmética nova;
- [ ] a leitura dos cardápios entra no **mesmo `Promise.all`** da onda única de leituras
      (linhas 113-122), sob `service_role`;
- [ ] a query de cardápios do caminho autoritativo **não filtra por `ativo`** — pelo mesmo motivo
      que `buscarProdutosPorIds` não filtra por `disponivel` (`produtos.ts:153-157`): o recálculo
      precisa enxergar para recusar. A regra "inativo não restringe" mora na função pura;
- [ ] recusa do **PEDIDO INTEIRO**, **antes** de chamar a RPC — nada gravado, nenhum item
      descartado em silêncio;
- [ ] mensagem ao cliente: `"Um item do seu pedido saiu do cardápio deste horário. Revise o
      carrinho."` — específica, **não nomeia o item**, mesma classe de `"Loja fechada no momento."`;
- [ ] o payload continua `.strict()` e **não ganha nenhum campo** de janela, horário, cardápio
      ou `visibilidade`;
- [ ] testes: payload forjado com produto fora da janela ⇒ recusa e **zero linhas** em `pedidos`
      e `itens_pedido`; produto dentro da janela passa; cardápio inativo **não** bloqueia produto
      `'menu'`; produto `'cardapio'` de temporada encerrada é **recusado, não omitido**.

## Fora de escopo

`revisarCarrinhoAction` (issue 252) — preview é outra fatia, e é ela que **nomeia** o item.
Qualquer mudança na RPC `criar_pedido`: ela não ganha nada, continua transacional e não é oráculo
de regra. Qualquer branch novo para o produto "sumido": `dentroDaJanela` já é `false` para ele e a
recusa o cobre sem código adicional (RN-13).

## Reuso esperado

- `src/lib/utils/vigenciaCardapio.ts` (issue 246) — **a mesma** função pura da vitrine.
- `buscarProdutosPorIds` (`produtos.ts:158`) — já faz `select("*")`: `visibilidade` chega sozinha.
  **Nenhuma query de produto nova** (mandato 2).
- O laço de recusa e o padrão de mensagem que `pedido.ts` já tem para indisponível/oculto/de
  outra loja (linhas 173-179, 196-202).

## Segurança

- **Este é o caminho que a RLS não protege**: `createServiceClient()` tem `BYPASSRLS`. Nenhuma
  regra desta feature pode morar só na policy, ou ela não existe aqui.
- **Fail-closed:** falha ao ler cardápios ⇒ o `Promise.all` rejeita ⇒ catch externo ⇒
  `ERRO_GENERICO` ⇒ pedido recusado. Sem branch novo.
- Aceitar o resto do carrinho seria entregar ao cliente um pedido que ele não montou.
- A mensagem **não é oráculo**: a mesma informação já está pública no selo da vitrine.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do código (fatia 4);
- [ ] payload forjado com item fora da janela ⇒ **pedido inteiro** recusado, **antes** da RPC,
      com asserção de que nada foi gravado;
- [ ] produto `'menu'` em cardápio fechado **passa** — o cardápio não o afeta (D14);
- [ ] cardápio **inativo** não bloqueia nada;
- [ ] falha simulada na leitura de cardápios ⇒ pedido recusado (fail-closed);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
