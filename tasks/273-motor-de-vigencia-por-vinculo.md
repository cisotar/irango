# [273] Motor de vigência por vínculo: `VinculoVigencia`, `itemAberto`, rótulos e consumidores autoritativos

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública + painel (contrato de dados compartilhado)
**Depende de:** [272]
**Spec:** specs/vigencia-por-item-do-cardapio.md — RN-01, RN-02, RN-03, RN-04, RN-07, RN-08, RN-09

## Origem

Spec §O motor + §Contrato de dados em TypeScript. Fatia coesa por decisão do
`plan/loop-vigencia-por-item-do-cardapio.md` §5 passo 2: um único vermelho principal cobre a
invariante de dinheiro — **`criarPedido` recusa a Feijoada numa segunda-feira**.

## Objetivo

Trocar o eixo do motor de "cardápio" para "vínculo": `avaliarVigenciaDoProduto` passa a receber
`VinculoVigencia[]`, `itemAberto` filtra **dentro** da janela do cardápio, os rótulos passam a ler os
dias do item, e os dois consumidores autoritativos (`pedido.ts`, `revisarCarrinho.ts`) recusam o item
fora do dia.

## Escopo

- [ ] `vigenciaCardapio.ts`: tipo `VinculoVigencia<C>`, `itemAberto(vínculo, agora, tz)` = `cardapioAberto` **E**
      (`dias_semana` vazio **OU** contém `diaIndex`), `diaIndex` vindo de `partesNoFusoCompletas` (RN-01)
- [ ] `avaliarVigenciaDoProduto(produto, vinculos, agora, timezone)`: união sobre vínculos, curto-circuito
      de `visibilidade === 'menu'` intacto (RN-02); `voltaAAbrir` passa a ser propriedade do vínculo (RN-03)
- [ ] `descreverVigencia.ts`: "Todos os dias" quando os 7 dias estão marcados, num curto-circuito só,
      antes de `corridaDaSemana`, valendo para a prévia longa e o selo curto (RN-07)
- [ ] `descreverVigencia.ts`: `rotuloVoltaQuando` ganha a variante por vínculo — "Só às quartas e sábados",
      teto de 32 caracteres na função pura, faixa de horas vinda do **cardápio**; precedência cardápio
      fechado > item fora do dia (RN-08)
- [ ] `queries/cardapios.ts`: `COLUNAS_CARDAPIO_VIGENCIA` embute `cardapio_produtos(produto_id, dias_semana)`;
      índice `cardapiosPorProduto` **renomeado** para `vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]>`
- [ ] Rename mecânico propagado nos consumidores (17 arquivos não-teste + ~13 de teste), com `tsc` como gate
- [ ] `pedido.ts` (`criarPedido`) e `revisarCarrinho.ts` passam vínculos ao motor — recusa do **pedido inteiro**,
      antes da RPC, no laço que já recusa produto indisponível/oculto/de outra loja (RN-04)
- [ ] `contarProdutosEscondidos.ts`: `CardapiosPorProdutoLidos` → `VinculosPorProdutoLidos` (rename de tipo e
      assinaturas; a mudança de **comportamento** da contagem é [280])

## Fora de escopo

- Filtro por item em `agruparPorCardapio` e sumiço da seção — [279]
- Comportamento novo de `contarProdutosEscondidos`/`diagnosticarSumico` — [280]
- Qualquer Server Action de escrita de dias — [274]
- Qualquer `.tsx` de painel — [275]–[278]
- `voltaAAbrir` resolver a interseção vazia (§Fora do Escopo; mitigado por aviso em [276])

## Reuso esperado

- `partesNoFusoCompletas` (`lib/utils/fusoLoja.ts`) — única fonte de `diaIndex`; nenhum `Intl` novo
- `cardapioAberto`, `proximaAbertura`, `escolherCardapioParaRotulo` — já existem
- `DIAS_LONGOS`/`DIAS_PLURAIS`/`DIAS_CURTOS`, `corridaDaSemana`, `enumerar` em `descreverVigencia.ts` —
  **nenhuma segunda tabela de nome de dia** (mandato 2)
- `src/lib/actions/paridade-preview-autoritativo.test.ts` como gate de paridade preview × autoritativo

## Segurança

- Muda o predicado que decide **se um item pode ser vendido** → caminho autoritativo do pedido
- Cliente nunca envia dia, hora, fuso nem preço; `criarPedido` recalcula do banco (`seguranca.md` §10)
- Nenhum motivo novo em `MotivoNaoCompravel`: item fora do dia produz `"fora_da_janela"`
- Nenhuma tabela nova, nenhuma RLS nova

## Critério de aceite

- [ ] RED capturado com `FAIL` real, em `src/lib/actions/pedido.vigencia-cardapio.test.ts`:
      `criarPedido` recusa a Feijoada (vínculo `{qua, sáb}` em cardápio aberto os 7 dias) numa segunda-feira
- [ ] RED também em `src/lib/utils/descreverVigencia.test.ts` para "Só às quartas e sábados" e "Todos os dias"
- [ ] `npx vitest run src/lib/actions/pedido.vigencia-cardapio.test.ts src/lib/actions/revisarCarrinho.vigencia.test.ts src/lib/utils/vigenciaCardapio.test.ts src/lib/utils/descreverVigencia.test.ts` verde
- [ ] `grep -r cardapiosPorProduto src/` → **vazio**
- [ ] `npx tsc --noEmit` = 0 erros; `npm test` verde, com `paridade-preview-autoritativo.test.ts` verde
