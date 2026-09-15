# [202] Busca de produtos na vitrine (`BuscaProdutos`)

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 199, 200, 201
**Spec:** specs/busca-e-navegacao-categorias-vitrine.md

## Objetivo

Entregar o campo de busca da vitrine: o cliente digita e o cardápio filtra no
frame, sobre os dados que o SSR já entregou — sem query nova, sem Server Action,
sem fetch.

## Escopo

- [ ] `src/components/vitrine/BuscaProdutos.tsx`: `<form role="search">` +
      `<label class="sr-only">` + `Input` (shadcn) + botão ✕ (`aria-label="Limpar busca"`,
      só com texto). Input a `min-height: 44px` **literal** e `font-size: 16px`
      (`min-h-11` = 52,8px na base 120% não é a régua; `size="icon-sm"` proibido).
- [ ] `CatalogoVitrine` filtra com `filtrarCatalogo` (199), memoizado por `termo`,
      e passa `termo` a `SecaoCatalogo` para o realce (200). Filtragem **sem debounce**.
- [ ] Linha de resumo com termo não vazio: "N produtos encontrados para “x” · [Limpar]",
      ocupando o lugar do trilho de categorias (RN-5 — o trilho de 203 recebe `oculto`).
- [ ] Estado vazio: ícone (`SearchX`) + "Nenhum produto encontrado para “x”." + CTA
      "Ver cardápio completo" (44px) que limpa e devolve o foco ao input. Nunca tela em branco.
- [ ] **Uma única** região `role="status" aria-live="polite" aria-atomic="true"` `sr-only`,
      nunca aninhada, com debounce de **500ms** — precedente em
      `confirmacao/StatusPedidoLive.tsx` e `LinhaTempoStatus.tsx`.
- [ ] Quatro caminhos de limpar (✕, "Limpar" do resumo, CTA do vazio, `Esc` no campo);
      em todos o foco volta ao input.
- [ ] `Esc` com texto: limpa e `stopPropagation()` para não fechar o `Sheet` do carrinho por baixo. Sem texto, propaga normalmente.
- [ ] Foco visível: `outline: 3px solid var(--cor-destaque); outline-offset: 2px`.
- [ ] Adicionar ao carrinho a partir de um resultado filtrado abre o `ProdutoModal` e funciona como sempre.

## Fora de escopo

Chips e scrollspy (203). `?q=` na URL, `sessionStorage`, histórico, autocomplete,
fuzzy, busca por preço, analytics de termo — todos fora da v1 pelo spec.

## Reuso esperado
- `lib/utils/buscarProdutos.ts` (199) — **toda** a lógica de casamento vem daqui.
- `CardProduto` / `ItemProdutoLista` com `termo` (200) — não recriar realce.
- `components/ui/input.tsx`, `components/ui/button.tsx`, `lucide-react` (`Search`, `X`, `SearchX`) — já no projeto.
- Padrão de `aria-live` de `confirmacao/StatusPedidoLive.tsx`.

## Segurança
- Sem dado sensível: o termo fica em memória do componente — não persiste, não vai para a URL, não é logado, não é enviado a lugar nenhum.
- Sem valor monetário novo. Preço/subtotal seguem preview; o valor cobrado continua recalculado na Server Action de checkout a partir do banco (RN-8, `seguranca.md` §10).
- Sem tabela nova, sem RLS nova, sem API externa.
- Bypass de visibilidade impossível: a filtragem é estritamente subtrativa sobre o payload que o servidor já limitou por RLS + `vitrine_lojas` (RN-1).
- O termo nunca vira seletor CSS, `innerHTML`, `RegExp` dinâmica ou parte de URL.

## Critério de aceite
- [ ] Digitar "pao" deixa na tela só as categorias com produto casando, com os títulos de categoria preservados.
- [ ] Nenhuma requisição de rede na aba Network ao digitar.
- [ ] Leitor de tela anuncia a contagem uma vez após parar de digitar (~500ms), não uma vez por tecla.
- [ ] Os quatro caminhos de limpar devolvem o foco ao input (nunca ao `<body>`).
- [ ] `Esc` com texto não fecha o `Sheet` do carrinho.
- [ ] Alvos de 44px em input, ✕, "Limpar" e CTA do vazio, verificados a olho em 360×640.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.
