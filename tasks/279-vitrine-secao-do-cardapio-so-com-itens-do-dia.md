# [279] Vitrine: a seção do cardápio lista só os itens abertos hoje e some quando não há nenhum

**crítica:** NÃO — projeção de exibição; a recusa de compra já está travada em [273]
**Mundo:** vitrine pública
**Depende de:** [273]
**Spec:** specs/vigencia-por-item-do-cardapio.md — RN-05, RN-08, RN-15/D16, §Decisões (a)

## Origem

Spec §Vitrine da loja: numa quarta, "Especiais do Dia" mostra só a Feijoada; o Virado e a Dobradinha
continuam nas categorias deles, marcados, com o selo vindo dos **dias do item**.

## Objetivo

Fazer `agruparPorCardapio` consultar `itemAberto(vínculo)` em vez de `cardapioAberto(cardapio)`, e
confirmar que a seção vazia cai pelo filtro `secao.produtos.length > 0` que já existe.

## Escopo

- [ ] `catalogoVitrine.ts`: `agruparPorCardapio(produtos, cardapiosAbertos, vinculosPorProduto)` empurra
      o produto na seção só quando `itemAberto` (RN-05)
- [ ] **Nenhuma linha nova de filtro**: a seção sem item do dia some pelo `.filter(secao => secao.produtos.length > 0)` existente
- [ ] `projetarCatalogoVitrine` consome `vinculosPorProduto` (contrato de [273]) e o selo do item fora do
      dia lê os dias do **item** (RN-08)
- [ ] `page.tsx` da vitrine: só o nome do índice muda — nenhuma query nova
- [ ] `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `CatalogoVitrine`,
      `NavCategorias`, `ancoraSecao`, `filtrarCatalogo` — **não tocar**

## Fora de escopo

- `contarProdutosEscondidos`/`diagnosticarSumico` — [280]
- Ordenar produtos dentro da seção ou reordenar seções (§Fora do Escopo)
- Cache do catálogo da vitrine — continua proibido

## Reuso esperado

- `itemAberto` / `avaliarVigenciaDoProduto` ([273]) — nenhuma regra de dia reescrita aqui
- `rotuloVoltaQuando` por vínculo ([273]) para o selo
- `paridade-preview-autoritativo.test.ts` como gate de que a vitrine não diverge do servidor

## Segurança

- Decisão sempre em SSR, no fuso da loja, no instante do request; o cliente nunca avalia dia
- Nenhum campo novo em `ProdutoVitrine`, nenhum motivo novo em `MotivoNaoCompravel`

## Critério de aceite

- [ ] Teste em `src/lib/utils/catalogoVitrine.test.ts`: numa quarta, a seção do cardápio aberto os 7 dias
      contém só o item `{qua, sáb}`; num domingo sem nenhum item aberto, a seção **não é devolvida**
- [ ] Teste: produto `visibilidade = 'menu'` com vínculo agendado continua comprável todo dia
- [ ] Teste: o item fora do dia continua na categoria, desabilitado, com selo "Só às quartas e sábados"
- [ ] `npx vitest run src/lib/utils/catalogoVitrine.test.ts src/lib/actions/paridade-preview-autoritativo.test.ts` verde
- [ ] `npx tsc --noEmit` = 0 · `npm run build` verde
