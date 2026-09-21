# [247] Extensão do contrato de catálogo: `projetarProdutoVitrine`/`projetarCatalogoVitrine` com vigência

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [224] (`tasks/224-contrato-de-catalogo-produtovitrine-e-projecao.md`), [225] (`tasks/225-quatro-superficies-recebem-produtovitrine-e-correcao-do-d13.md`), [243] (`tasks/243-migration-cardapio-produtos-fks-compostas-e-rls.md`), [245] (`tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md` — é ela que põe `visibilidade` em `vitrine_produtos`/`ProdutoPublico`) e [246] (`tasks/246-vigenciacardapio-cardapioaberto-e-avaliarvigenciadoproduto.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14 · RN-05, RN-06, RN-13
**Fatia crítica:** 3 (extensão do contrato de catálogo)

## Objetivo

Compor `compravel` com a vigência do cardápio no **contrato que o Spec A nomeou**, sem acrescentar
nenhum campo ao objeto, e fazer a projeção **filtrar** o produto que D14 manda sumir — omitindo-o
da lista **antes** do agrupamento, do mesmo jeito que `oculto` já sai.

## Escopo

- [ ] `export type MotivoNaoCompravel = "esgotado" | "fora_da_janela"` — **acrescenta** membro,
      não remove nem renomeia;
- [ ] `projetarProdutoVitrine(produto, cardapios, agora, timezone)` — os dois parâmetros novos são
      **OBRIGATÓRIOS**. Lista vazia ⇒ comportamento idêntico ao v1;
- [ ] `compravel === disponivel && dentroDaJanela`; precedência de RN-05 —
      **`"fora_da_janela"` ganha de `"esgotado"`**, um motivo só, decidido no servidor;
- [ ] `projetarCatalogoVitrine({ produtos, cardapiosPorProduto, agora, timezone })` devolvendo
      **num único objeto**: `produtos` (já filtrada por RN-13), `rotulosVigencia`
      (`produto_id → frase`, uma entrada para **cada** produto com motivo `"fora_da_janela"`) e
      `cardapiosAbertos` (consumido pela issue 248) — os três saem do **mesmo** retorno, para que
      não exista caminho que produza o produto marcado sem o rótulo dele;
- [ ] query nova de cardápios para o SSR (`buscarCardapiosComProdutos(lojaId)` em
      `src/lib/supabase/queries/`), entrando na onda de `Promise.all` que já existe em
      `src/app/(publica)/loja/[slug]/page.tsx` (hoje `buscarCategorias` ‖ `buscarProdutosPublicos`);
- [ ] `agruparCatalogo` (`lib/supabase/queries/produtos.ts:88`) **generalizada, não reescrita**:
      `<T extends { id: string; categoria_id: string | null }>` em vez de `Produto[]`;
- [ ] `page.tsx` passa a projetar na **ordem obrigatória**: `projetarCatalogoVitrine` **→**
      `agruparCatalogo`, invertendo o que existe hoje (linhas 174-190) — é isso que faz a regra
      do grupo vazio da issue 177 continuar cobrindo a categoria esvaziada pela temporada;
- [ ] teste ao lado do módulo com os cenários 3 e 6 literais.

## Fora de escopo

`agruparPorCardapio`, a ordenação das seções e o `foto_url` zerado por produto (issue 248).
O selo e o estado não comprável nos componentes (issue 262). Qualquer campo novo em
`ProdutoVitrine`: a regra 2 do contrato do Spec A é o ponto de extensão **e só ele**, e o rótulo
viaja **ao lado**, no mapa, como `opcionaisPorCategoria` já faz na mesma cadeia. **Nenhuma
proposta de cache do catálogo** (`revalidate`, `'use cache'`, ISR): a vitrine é dado vivo por
decisão documentada e um cardápio que abre às 11:00 tem que abrir às 11:00 — o custo das duas
queries novas é nota para o `acelerar`, **depois** do `executar`.

## Reuso esperado

- `src/lib/utils/catalogoVitrine.ts` (issue 224) — módulo do Spec A, **estendido, não duplicado**.
- `src/lib/utils/vigenciaCardapio.ts` (issue 246) — a decisão de janela vem toda de lá.
- `agruparCatalogo` e a regra "grupo sem produto visível não é devolvido" (issue 177,
  `produtos.ts:78-88`) — reusada de graça pela ordem nova, **sem código de agrupamento novo**.
- `buscarProdutosPublicos` (`produtos.ts`) — lê a view `public.vitrine_produtos` com select
  **nomeado** (`COLUNAS_PRODUTO_PUBLICO`, D4 da 265 — nunca `select("*")`). A coluna
  `visibilidade` **não** "chega sozinha": ela entra como 15ª coluna da view, da constante e de
  `ProdutoPublico` na issue **245** (decisão de recriar a view uma vez só). Esta issue só a
  **consome** de `ProdutoPublico`. **Nenhuma query de produto nova.**
- O padrão de mapa ao lado do catálogo de `opcionaisPorCategoria`.

## Segurança

- `visibilidade` e as colunas cruas de vigência **não trafegam ao cliente**: são **entrada** da
  projeção (regra 6 do contrato do Spec A; mesmo princípio da issue 201 sobre `foto_url`).
- O produto sumido **não é enviado ao browser** — não há estado a forjar no devtools.
- Parâmetros obrigatórios são a trava: sem jsdom, um default "dentro da janela" produziria, em
  silêncio, um catálogo inteiro comprável fora da janela. Obrigatório move o erro para o `tsc`,
  primeiro passo do CI (mesmo princípio do `resolverEndereco` como thunk, issue 160).
- `oculto = true` continua ganhando de tudo e nem chega a virar `ProdutoVitrine`.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do código (fatia 3);
- [ ] `compravel === disponivel && dentroDaJanela`, provado nas seis linhas do cenário 3;
- [ ] fora da janela **e** `disponivel = false` ⇒ motivo `"fora_da_janela"`;
- [ ] produto `'menu'` fora da janela ⇒ `compravel === true` e **nenhum** rótulo;
- [ ] produto sumido **não está** na lista devolvida, e a categoria que ficou só com ele
      **não é devolvida** por `agruparCatalogo`;
- [ ] `visibilidade` **ausente** do objeto projetado (asserção sobre as chaves, não sobre o valor);
- [ ] há rótulo para **todo** produto com motivo `"fora_da_janela"`;
- [ ] a suíte atual de `agruparCatalogo` passa **sem uma edição**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
