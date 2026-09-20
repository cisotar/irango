# [248] D16 puro: `agruparPorCardapio` + ordenação determinística + `foto_url` zerado **por produto**

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [247] (`tasks/247-extensao-do-contrato-de-catalogo-com-vigencia.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D16, D16-a · RN-15, RN-16 (a parte pura), RN-06 (o `foto_url`) · design §13.1
**Fatia:** 18

## Objetivo

Entregar D16 **inteiro na camada pura**, antes de qualquer componente — é o que torna as
invariantes de seção de destaque traváveis num repo sem jsdom — e mover o zeramento de
`foto_url` para dentro da projeção, fechando o vazamento que a duplicata de render criaria.

## Escopo

- [ ] `agruparPorCardapio` — função pura, **irmã** de `agruparCatalogo`, no mesmo módulo
      (`lib/supabase/queries/produtos.ts` ou `lib/utils/catalogoVitrine.ts`, o que ficar mais
      coeso). **Não é refactor de `agruparCatalogo`**: são duas visões da mesma lista;
- [ ] ela consome `cardapiosAbertos` do retorno de `projetarCatalogoVitrine` (issue 247) e
      **não reavalia janela nenhuma** — "está aberto?" tem UMA resposta por request;
- [ ] `filter(s => s.produtos.length > 0)` — seção de destaque vazia **não é emitida**
      (mesma regra da issue 177, aplicada de novo, não reinventada);
- [ ] ordenação determinística: **`cardapios.ordem` crescente → `nome` (`localeCompare` pt-BR)
      → `id`** — a mesma escada de RN-07;
- [ ] o tipo `SecaoVitrine = CategoriaComProdutos & { tipo: "cardapio" | "categoria" }` —
      **um campo a mais, não um tipo novo**: a seção de categoria continua sendo o objeto de hoje;
- [ ] **o zeramento de `foto_url` vira propriedade do PRODUTO**, dentro de
      `projetarCatalogoVitrine`, que passa a receber as categorias (ou um
      `Map<categoria_id, exibir_imagens>`) e devolve `foto_url` já resolvido. Sai de
      `page.tsx:188-190`, onde é decidido **por grupo**;
- [ ] teste ao lado do módulo com o cenário 8 literal.

## Fora de escopo

Qualquer render: `CatalogoVitrine`, `SecaoCatalogo`, `NavCategorias`, `ancoraCardapio`,
`idNaSecao` e `CardProduto.idNaSecao` são a issue 263. Unificar `agruparCatalogo` com
`agruparPorCardapio` num agrupador com dois modos e parâmetro de tipo — é exatamente o refactor
que quebra o teste existente. Reordenar produtos **dentro** da seção (§Fora do Escopo: a seção
não reordena nada) e UI de arrastar para reordenar cardápios.

## Reuso esperado

- `agruparCatalogo` (`produtos.ts:88`), já generalizado pela issue 247 — **não** reescrever, e
  **não** criar um segundo agrupador.
- `projetarCatalogoVitrine` (issue 247) — de onde saem `produtos` e `cardapiosAbertos`.
- A regra "grupo sem nenhum produto visível não é devolvido" (issue 177).
- A decisão da issue 201 sobre `foto_url` em categoria "ocultar": zerado **no SSR**, não escondido
  no render — o payload RSC não carrega a URL.

## Segurança

- **A correção do `foto_url` é vazamento, não estética.** Com D16-a o produto aparece também na
  seção de destaque, que não é de categoria nenhuma: a cópia de lá carregaria a URL da foto que o
  lojista escolheu esconder, regredindo a issue 201.
- Nenhuma decisão de valor ou permissão vive aqui: seção é apresentação, o conjunto de produtos
  já veio do SSR sob `anon` + RLS, e forjar uma seção no devtools pinta a tela sem comprar nada.
- **A duplicata é de RENDER, nunca de dado**: carrinho, checkout e `criarPedido` continuam vendo
  **um** produto.

## Critério de aceite

- [ ] **a suíte atual de `agruparCatalogo` passa SEM UMA EDIÇÃO** — se precisou editar, o refactor
      mudou comportamento: reverter, não ajustar o teste;
- [ ] seção de destaque vazia não é emitida;
- [ ] **nenhum produto de seção de destaque está fora da janela** (propriedade da função pura:
      a seção só existe para cardápio aberto e `dentroDaJanela` é união);
- [ ] produto esgotado **aparece** na seção de destaque, com o selo de esgotado;
- [ ] produto em dois cardápios abertos sai nas **duas** seções **e** na categoria dele;
- [ ] ordem `ordem → nome → id` estável, provada com empate nos dois primeiros critérios;
- [ ] `foto_url` de produto de categoria "ocultar" é `null` **também** na seção de destaque, e o
      render das seções de categoria é **idêntico ao de hoje**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
