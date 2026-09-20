# [263] D16 na tela: seções de destaque, `ancoraCardapio`, `idNaSecao` e as pílulas do trilho

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [262] (`tasks/262-selo-de-fora-da-janela-nas-superficies-da-vitrine.md`) e [248] (`tasks/248-agruparporcardapio-cardapiosabertos-e-foto-url-por-produto.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D16, D16-a · RN-15, RN-16 · design §13.1
**Fatia:** 19

## Objetivo

Fazer o cardápio aberto **aparecer** para o cliente: uma seção no topo do catálogo, com o nome
que o lojista deu, que some sozinha quando ele fecha — sem que o produto saia da categoria dele,
sem que a busca passe a mentir e sem `id` de DOM duplicado.

> ⚠️ **Depende da issue 262 e NUNCA roda em paralelo com ela:** as duas editam
> `SecaoCatalogo.tsx` e `CardProduto.tsx`. É o único conflito de arquivo real entre as fatias de
> UI deste spec.

## Escopo

- [ ] `ancoraCategoria` (`lib/utils/ancoraCategoria.ts`) fica **intocada, byte a byte** (a suíte
      dela passa sem edição) e o módulo ganha duas irmãs: `ancoraCardapio(id) → \`cardapio-${id}\``
      e o despachante `ancoraSecao(secao, indice)`. O módulo continua **puro e sem `'use client'`**
      (decisão D1 da issue 201);
- [ ] `SecaoCatalogo` e `NavCategorias` passam a chamar **`ancoraSecao`** — os dois derivam a
      âncora da **mesma** função, que é o que impede `id` de `<section>` e `href` de chip de
      divergirem (issue 201);
- [ ] `SecaoCatalogo` passa a receber `SecaoVitrine[]` em vez de `CategoriaComProdutos[]` — **um
      campo a mais (`tipo`), não um tipo novo**; o laço de render não muda de forma;
- [ ] `CatalogoVitrine` ganha **`secoesDestaque: SecaoVitrine[]` como prop SEPARADA** de
      `categorias`: `filtrarCatalogo` e `contarProdutos` recebem **só** `categorias`, e o destaque
      é concatenado **apenas** no ramo `emBusca === false` — booleano que **já existe** e já
      decide trilho × `ResumoBusca` (linhas 163-170). Nenhum estado novo, nenhuma condição nova;
- [ ] `idNaSecao(ancoraSecao, produtoId)` e `CardProduto` trocando o prop `id` por
      **`idNaSecao`, obrigatório** — hoje o `id` não é emitido no DOM (`CardProduto.tsx:10`), e é
      por isso que a trava tem de ser agora. `ItemProdutoLista` **não** recebe id e **não pode
      ganhar** um que não seja escopado;
- [ ] `NavCategorias` recebe `[...secoesDestaque, ...categorias]`; `CategoriaNavegavel` ganha
      **um** campo (`tipo`). Scrollspy, `useMediaQuery`, `scrollIntoView` e chip ativo **não
      mudam**; `MINIMO_CATEGORIAS = 3` passa a contar as seções de destaque junto;
- [ ] cabeçalho da seção: `<h2>` com o **nome do lojista, sem prefixo**, mais **um** rótulo de
      janela à direita (`Até domingo` / `Hoje, até as 15:00` / `Hoje`, ≤20 caracteres), vindo de
      `descreverVigencia`. **Nenhum badge de estado na vitrine**;
- [ ] mesma grade do catálogo (`grid-cols-2 md:grid-cols-3 xl:grid-cols-4`), **nunca carrossel
      nem scroll horizontal**; mesmo `scroll-margin-top` das categorias;
- [ ] produto de categoria "ocultar" aparece no destaque **sem foto**, com o **mesmo placeholder
      de gradiente** que o grid já usa;
- [ ] `page.tsx` monta `secoesDestaque` a partir de `agruparPorCardapio` (issue 248) e passa as
      duas listas separadas.

## Fora de escopo

`agruparPorCardapio`, a ordenação e o `foto_url` (issue 248, pura). Mudar `filtrarCatalogo`,
`agruparCatalogo` ou o `ProdutoModal` — os três ficam **intocados**; o modal é singleton fora do
laço, com `key={produtoSelecionado?.id ?? "vazio"}`, e abrir a Lasanha pelo destaque ou pela
categoria dá o mesmo modal. Trocar a `key` dos cards: chave só precisa ser única **entre
irmãos**, `key={produto.id}` continua correto e trocá-la remontaria o card à toa. Seção de
destaque no resultado de busca (§Fora do Escopo). Filtrar a vitrine por cardápio. UI de
reordenar cardápios. **E, por serem decisões de produto ainda pendentes no desenho (P3), ficam
fora desta issue:** o teto de 6 produtos renderizados por seção com a linha
`[ Ver os 14 produtos… ]` e o colapso automático a partir da terceira seção aberta — o spec
**não** impõe teto e registra o caso como nota para o `desenhar`; não implementar sem decisão do
dono do produto.

## Reuso esperado

- `ancoraCategoria.ts` — **estendido aditivamente**, nunca reescrito.
- `CatalogoVitrine`, `SecaoCatalogo`, `NavCategorias` — **modificados minimamente**; o `emBusca`
  que já existe, o scrollspy que já existe, o `MINIMO_CATEGORIAS` que já existe.
- `descreverVigencia` (issue 254) — terceiro consumidor do mesmo módulo (M6).
- O placeholder de gradiente que o grid já usa para produto sem foto.

## Segurança

- **D16 não acrescenta superfície de segurança**: seção é apresentação, o conjunto de produtos já
  veio do SSR sob `anon` + RLS, o nome do cardápio já era público e forjar uma seção no devtools
  pinta a tela sem comprar nada.
- **A trava da busca é ausência, não filtro:** prop separada move o erro para o `tsc`, primeiro
  passo do CI. Um filtro é uma linha que alguém esquece, e sem jsdom não é travável por teste.
- **`ResumoBusca` não pode passar a mentir**: "3 resultados" com 2 produtos na tela é erro
  anunciado em `aria-live`, pior que a duplicata visual.
- Prefixos de âncora **disjuntos por construção** (`cat-` × `grupo-` × `cardapio-`) — não depender
  de unicidade acidental de uuid entre duas tabelas.
- `idNaSecao` obrigatório: passar um `produto.id` cru **não compila**.

## Critério de aceite

- [ ] com busca vazia, o cenário 8 bate: 3 produtos, **5 cards**, 3 seções, destaque primeiro;
- [ ] buscando "lasanha": **1 card**, só a seção "Massas", `ResumoBusca` diz *"1 resultado"*,
      trilho desmontado;
- [ ] os dois cards da Lasanha dizem **exatamente** a mesma coisa (mesma referência de objeto);
- [ ] `grep` prova que `filtrarCatalogo` e `contarProdutos` **nunca** recebem `secoesDestaque`;
- [ ] a suíte de `ancoraCategoria` passa **sem edição**;
- [ ] `CardProduto` não compila se receber `id` em vez de `idNaSecao`;
- [ ] cardápio fechando ⇒ a seção **some sozinha**, sem ninguém publicar nada;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
