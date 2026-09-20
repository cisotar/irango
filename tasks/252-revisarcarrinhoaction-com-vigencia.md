# [252] `revisarCarrinhoAction` ganha vigência: preview = autoritativo

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [228] (`tasks/228-revisarcarrinhoaction-preview-igual-ao-autoritativo.md`) e [249] (`tasks/249-criarpedido-recusa-item-fora-da-janela.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14 · RN-06, RN-08, RN-13
**Fatia crítica:** 6 (preview = autoritativo para vigência)

## Objetivo

Fazer a revisão do carrinho e `criarPedido` darem **o mesmo veredito** para o mesmo carrinho e o
mesmo `agora`. Um preview mais generoso que o autoritativo é oráculo (`seguranca.md` §10-A); um
preview mais severo é o cliente bloqueado sem motivo.

## Escopo

- [ ] cada linha do retorno de `revisarCarrinhoAction` ganha `compravel` + `motivoNaoCompravel`,
      derivados **da mesma** `avaliarVigenciaDoProduto` do SSR e do pedido (RN-06);
- [ ] a leitura de cardápios do carrinho reusa **exatamente** a mesma query e a mesma cadeia que
      a issue 249 montou para `criarPedido` — nunca uma segunda leitura com outro filtro;
- [ ] o item de temporada encerrada volta `compravel: false`, `motivoNaoCompravel:
      "fora_da_janela"` e **sem rótulo de volta** — é o único consumidor em que o rótulo genérico
      é caso real de negócio, não fallback defensivo;
- [ ] **item que a revisão não encontra no banco é tratado como não comprável, nunca ignorado**:
      sumir da conta seria alterar o carrinho do cliente por omissão;
- [ ] teste de **paridade**: para o mesmo carrinho e o mesmo `agora`, o conjunto de itens que a
      revisão marca como bloqueados é **igual** ao conjunto que `criarPedido` usa para recusar;
- [ ] teste: `produto_id` de outra loja é recusado, com o fragmento da mensagem afirmado.

## Fora de escopo

A UI do checkout — `EtapaItens`, `ResumoValores` e o gate de `podeConfirmar` são a issue 262
(as três travas de tela do não comprável). Qualquer "confirmar assim mesmo" para item fora da
janela: não existe preço que torne o item vendável, e isso não é D11. Omitir o item da revisão
porque ele sumiu da vitrine.

## Reuso esperado

- `revisarCarrinhoAction` (issue 228, Spec A) — **estendida**, nunca duplicada.
- `src/lib/utils/vigenciaCardapio.ts` (issue 246) — a mesma função pura, terceiro consumidor.
- `buscarProdutosPorIds` (`produtos.ts:158`) — já é o ponto autoritativo de recálculo e já traz
  `visibilidade` pelo `select("*")`.
- A query de cardápios por ids de produto criada na issue 249.

## Segurança

- **Preview mais generoso que o autoritativo é oráculo** (§10-A). A garantia aqui é
  **estrutural** — a mesma função pura nos dois caminhos —, não "os dois foram escritos com
  cuidado".
- O cliente não manda horário, janela, cardápio nem `visibilidade`: o `agora` é do servidor e o
  `timezone` é da loja.
- A revisão **nomeia** o item (o cliente já autenticou os ids mandando-os); `criarPedido` não.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do código (fatia 6);
- [ ] paridade provada: mesmo carrinho, mesmo `agora` ⇒ mesmo veredito nos dois caminhos;
- [ ] item de temporada encerrada volta bloqueado e **sem** rótulo de volta;
- [ ] item inexistente no banco volta **bloqueado**, não some;
- [ ] `produto_id` de outra loja recusado, fragmento afirmado;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
