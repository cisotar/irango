# Nav de categorias (carrossel) + busca de produtos — contrato de interação (UX/a11y)

Tela: `/loja/[slug]` (vitrine pública, cliente final, sem login)
Fonte real: `src/app/(publica)/loja/[slug]/page.tsx`, `src/components/vitrine/SecaoCatalogo.tsx`
Preview: `mockups/vitrine-nav-categorias-e-busca.html`
Status: **mockup para aprovação** — nada implementado em `src/`.

Este documento é **contrato de interação**, não plano de implementação.

---

## Gate de reuso

- **shadcn/ui varridos:** `ui/input.tsx`, `ui/button.tsx`, `ui/badge.tsx`,
  `ui/card.tsx`, `ui/separator.tsx`, `ui/sheet.tsx`, `ui/dialog.tsx`,
  `ui/menu.tsx`, `ui/accordion.tsx`, `ui/label.tsx`. **Não existe `ui/tabs.tsx`
  nem `ui/carousel.tsx`** — e nenhum dos dois deve ser gerado (justificativa em §2).
- **Componentes vitrine/painel:** `vitrine/SecaoCatalogo.tsx` (já emite
  `id={ancora(...)}` + `scroll-mt-24` em cada `<section>` — **a âncora que o
  carrossel precisa já existe**), `vitrine/HeaderLoja.tsx` (banda `--cor-primaria`,
  texto branco fixo), `vitrine/CardProduto.tsx`, `vitrine/ItemProdutoLista.tsx`,
  `vitrine/VitrineClient.tsx` (padrão de barra fixa + escada de largura),
  `vitrine/confirmacao/LinhaTempoStatus.tsx:37-39` e
  `confirmacao/StatusPedidoLive.tsx:314` (**precedente autoritativo de `aria-live`**:
  região viva única, `sr-only`, nunca aninhada).
- **Tokens (`@theme` de `globals.css`):** `--cor-primaria`, `--cor-fundo`,
  `--cor-destaque`, `--marrom-cafe`, `--texto`, `--texto-muted`, `--borda-nav`,
  `--cinza-medio`, `--cinza-claro`, `--radius`. `html { font-size: 120% }`
  (`globals.css:212`) — base rem = 19.2px.
- **Utils:** `formatarMoeda`, `fotoSegura`. Normalização sem acento existe só
  dentro de `lib/validacoes/loja.ts` (slug) — **não é reutilizável**.
- **Decisão: REUSAR + CRIAR (2 componentes de vitrine + 1 util puro)**
- **Justificativa:** zero token novo, zero cor nova, zero primitivo shadcn novo;
  as âncoras de seção já existem em `SecaoCatalogo` e o `Input` do shadcn cobre
  o campo de busca com override de altura.

---

## 0. Dois achados encontrados na leitura do código

### 0.1 `scroll-mt-24` vai ficar errado assim que a barra virar sticky

`SecaoCatalogo.tsx` usa `scroll-mt-24` = 6rem = **115px** na base de 19.2px. A
barra sticky proposta mede ~112px (busca 44 + gaps + trilho 44). Hoje o valor
sobra; com a barra, passa a ser coincidência. **Contrato:** `scroll-margin-top`
das seções lê a mesma variável CSS que define a altura da barra
(`--altura-barra`), para que só exista **um** lugar a ajustar. Valor mágico
duplicado aqui é regressão silenciosa: o título da categoria fica escondido atrás
da barra e o cliente acha que o link não funcionou.

### 0.2 `HeaderLoja` não é sticky — e não deve virar

O header tem 80px de logo + nome + badge + WhatsApp. Grudar isso no topo come
metade de um 360×640. **Contrato:** o header rola normalmente; só a barra
busca+categorias é sticky (`top-0`).

---

## 1. Layout

```
┌──────────────────────────────────────────┐
│  HeaderLoja (rola com a página)          │
│  ( logo )  PÃO DO CISO                   │
│            [● Aberto agora]              │
│            (11) 90000-0000               │
├──────────────────────────────────────────┤ ← sticky top-0, z-30
│  ( 🔍 Buscar no cardápio…          ✕ )  │   BuscaProdutos   44px
│  (PÃES)(SALGADOS)(DOCES)(BOLOS)(BEB… →  │   NavCategorias   44px
└──────────────────────────────────────────┘   borda + sombra sutil
│  ──────────── PÃES ────────────          │ ← scroll-margin-top: var(--altura-barra)
│  ┌────────┐ ┌────────┐                   │
│  │ [foto] │ │ [foto] │                   │   grid-cols-2 md:3 lg:4 xl:6
│  │ Pão fr.│ │ Pão q. │                   │   (SecaoCatalogo, inalterado)
│  │ R$1,20 +│ │ R$4,50 +│                  │
│  └────────┘ └────────┘                   │
│  ──────── BEBIDAS ────────                │
│  Suco de laranja ······· R$ 9,00          │   exibir_imagens=false
└──────────────────────────────────────────┘
│  [ 2 itens / R$ 27,40 ]  [ VER CARRINHO ]│ ← barra fixa (já existe)
```

### Modo busca (input com texto)

O carrossel **é substituído** pela linha de resumo — ele não pode continuar
visível porque suas âncoras apontam para seções que a filtragem removeu do DOM.
Clicar num chip que não leva a lugar nenhum é pior que não ter o chip.

```
├──────────────────────────────────────────┤ ← sticky
│  ( 🔍 pao                           ✕ )  │
│  3 produtos encontrados para “pao”  [LIMPAR] │
└──────────────────────────────────────────┘
│  ──────────── PÃES ────────────           │   agrupamento por categoria
│  ┌────────┐ ┌────────┐                   │   PRESERVADO (dá contexto:
│  │**Pão** fr│ │**Pão** q│                  │   "isso é da categoria Pães")
```

---

## 2. `NavCategorias` — carrossel de categorias

### Anatomia

```
<nav aria-label="Categorias do cardápio">     ← NÃO é tablist
  <ul class="trilho">                          ← overflow-x-auto, scroll-snap
    <li><a href="#cat-<id>" aria-current="true">Pães</a></li>
    ...
```

### Por que `<nav>` + `<a href="#…">` e não `Tabs` do shadcn

| Alternativa | Por que foi descartada |
|---|---|
| `Tabs` (Base UI) | Tab implica **painéis mutuamente exclusivos**: só um visível por vez, setas ←/→ movem a seleção e trocam conteúdo. Aqui todas as seções continuam na página e o usuário rola livremente entre elas. Anunciar "aba 3 de 7, selecionada" para algo que é navegação por âncora **mente para o leitor de tela**. |
| `<button>` + `scrollIntoView` | Perde o link. Sem JS (ou antes da hidratação) não faz nada; não abre em nova aba; não copia link para a categoria. |
| Carousel lib | Não há carousel a "avançar": é uma lista rolável nativa. Zero dependência nova. |

Link âncora funciona **antes da hidratação** e sem JS. O JS só acrescenta o
estado ativo e o auto-centramento do chip.

### Props

```ts
type NavCategoriasProps = {
  /** id da âncora + rótulo — derivados das MESMAS categorias de SecaoCatalogo. */
  categorias: { ancora: string; nome: string }[];
};
```

A função `ancora(id, indice)` hoje é **privada** dentro de `SecaoCatalogo.tsx`.
Contrato: ela é exportada (ou sobe para o `page.tsx`) para que nav e seções
**não possam divergir**. Duas implementações de âncora = links quebrados na
primeira vez que alguém mexer numa.

### Estado ativo

- `IntersectionObserver` sobre as `<section>`, `rootMargin:
  "-<altura-barra> 0px -55% 0px"` — a seção só conta como ativa quando o topo
  dela passa **abaixo** da barra sticky. Sem listener de `scroll` (evita jank no
  mobile).
- Empate (duas seções visíveis): vence a **primeira na ordem do catálogo**.
- O chip ativo é centralizado no trilho com
  `scrollIntoView({ inline: "center", block: "nearest" })`.
  **`block: "nearest"` é obrigatório** — sem ele o `scrollIntoView` sequestra o
  scroll vertical da página e o catálogo "pula" sozinho enquanto o cliente rola.
- Clique no chip marca o ativo imediatamente (antes do observer reagir), senão o
  chip pisca no estado antigo durante o scroll suave.

### Visual

| Estado | Tratamento |
|---|---|
| Inativo | fundo branco, borda `--borda-nav`, texto `--texto` |
| Ativo | fundo `--cor-primaria`, **texto branco fixo** (design-system §4 — nunca derivar a cor do texto do tema da loja), + `box-shadow: inset 0 -3px 0 rgba(255,255,255,.45)` |
| Foco | `outline: 3px solid var(--cor-destaque); outline-offset: 2px` |

O sublinhado interno do chip ativo existe para **não depender só de cor**
(WCAG 1.4.1): loja com `primaria` muito próxima do branco perde a distinção
cromática, mas mantém o sublinhado.

Affordance de "tem mais categorias à direita": `mask-image` com fade de 16px nas
duas bordas do trilho. Sem botões de seta — no mobile ninguém usa, e no desktop
o Tab já percorre a lista.

---

## 3. `BuscaProdutos` — filtro conforme se digita

### Anatomia

```
<form role="search">
  <label class="sr-only" for="busca-produto">Buscar produto no cardápio</label>
  <Input id="busca-produto" type="search" aria-describedby="busca-resumo" />
  <button aria-label="Limpar busca">✕</button>   ← só quando há texto
</form>
<p id="busca-resumo" class="sr-only" role="status" aria-live="polite" aria-atomic="true" />
```

### Por que NÃO é um combobox

`role="combobox"` + `aria-expanded` + `aria-activedescendant` é o padrão de
**autocomplete com popup**. Aqui não há popup: o resultado é a própria página
filtrada. Combobox aqui obrigaria a gerenciar foco em listbox e quebraria o
scroll do catálogo. O padrão correto é **search + live region**.

### Props

```ts
type BuscaProdutosProps = {
  termo: string;
  onTermoChange: (termo: string) => void;
  /** Contagem do resultado — quem filtra é o pai, não a busca. */
  totalResultados: number;
};
```

Estado do termo vive no pai (client component que envolve nav + busca +
`SecaoCatalogo`), porque **os três precisam do mesmo termo**.

### Filtragem

- **Puramente no cliente.** O catálogo inteiro já vem no SSR (`buscarCatalogoPublico`)
  — dezenas de itens. Nada de round-trip: digitar tem que responder no frame.
  Nenhuma Server Action nova, nenhuma query nova.
- Nova função **pura** `lib/utils/buscarProdutos.ts` (testável em Vitest):

```ts
export function normalizarBusca(s: string): string   // NFD, sem acento, lowercase, trim
export function filtrarCatalogo(
  categorias: CategoriaComProdutos[],
  termo: string,
): CategoriaComProdutos[]                             // categoria sem match é removida
```

- Casa em **nome + descrição**, sem acento e sem caixa: `pao` acha "Pão",
  `CAFE` acha "Café". `substring`, não fuzzy — fuzzy traz falso positivo e
  confunde mais do que ajuda num cardápio de 40 itens.
- Agrupamento por categoria **preservado** no resultado (o título da seção diz
  de onde o produto veio).
- Trecho que casou recebe `<mark>` — mostra **por que** aquele item apareceu.
- Sem debounce na filtragem (é síncrona e barata). Debounce de **500ms só no
  `aria-live`**, senão o leitor de tela recita um número a cada tecla.

### Empty state

Nunca tela em branco: ícone + "Nenhum produto encontrado para “xis”." + CTA
**"Ver cardápio completo"** (44px), que limpa a busca e devolve o foco ao input.

### Escape hatches

| Gesto | Efeito |
|---|---|
| `Esc` com texto no campo | limpa a busca, foco fica no campo (`stopPropagation` para não fechar o `Sheet` do carrinho por baixo) |
| Botão ✕ no campo | limpa, foco volta ao campo |
| "Limpar" na linha de resumo | limpa, foco volta ao campo |
| CTA do empty state | limpa, foco volta ao campo |

O foco **sempre** volta ao input: limpar a busca não pode jogar o foco no
`<body>` — o usuário de teclado perderia a posição e teria de tabular a página toda.

---

## 4. Acessibilidade — checklist de aceite (WCAG 2.1 AA)

| Critério | Contrato |
|---|---|
| 2.5.5 Alvo de toque | chip, input, ✕, "Limpar", CTA do vazio: `min-height: 44px` **literal** (não `min-h-11`, que na base 120% vale 52.8px e não é a régua). |
| 2.1.1 Teclado | Carrossel é lista de links: Tab percorre, Enter navega. **Nada de `tabindex` custom, nada de setas ←/→ sequestradas** — o usuário ainda precisa das setas para rolar a página. |
| 2.4.7 Foco visível | `outline: 3px solid var(--cor-destaque); outline-offset: 2px` em chip e input. Chip fora da viewport do trilho **precisa** ser trazido para dentro ao receber foco (o `scrollIntoView` do estado ativo não cobre navegação por Tab — o browser rola o container sozinho, mas confirmar). |
| 4.1.3 Mensagem de status | **Uma** região `role="status" aria-live="polite" aria-atomic="true"` `sr-only`, debounce 500ms, nunca aninhada (precedente `LinhaTempoStatus.tsx:37-39`). |
| 3.3.2 Rótulo | `<label class="sr-only">` no input — placeholder **não** é label. |
| 1.4.1 Uso da cor | Chip ativo = cor + sublinhado interno. "Esgotado" = cor + texto (já existe). |
| 1.4.3 Contraste | Texto sobre `--cor-primaria` é **branco fixo**, nunca derivado do tema. Chip inativo usa `--texto` (#3e2723) sobre branco = ~11:1. |
| 1.4.4 Zoom / iOS | `font-size: 16px` no input — abaixo disso o Safari iOS dá zoom no focus e desloca o layout inteiro. |
| 1.4.10 Reflow | Testado em 360px: trilho rola em X, catálogo nunca rola em X. |
| 2.3.3 Movimento | `scroll-behavior: smooth` só dentro de `@media (prefers-reduced-motion: no-preference)`. |
| 4.1.2 Nome/função | ✕ tem `aria-label="Limpar busca"`; `<nav aria-label="Categorias do cardápio">` distingue das outras `<nav>` da página (a barra do carrinho já usa `aria-label`). |

---

## 5. Atritos por impacto

| Impacto | Atrito | Fix no contrato |
|---|---|---|
| **ALTO** | Barra sticky come altura útil num 360×640 e empurra o catálogo | Busca + trilho somam ~112px e **só eles** são sticky; o `HeaderLoja` rola (§0.2). Se ainda apertar, colapsar o campo de busca em ícone ao rolar **não** é opção — busca escondida não é usada. |
| **ALTO** | Âncora escondida atrás da barra ao clicar num chip | `scroll-margin-top` lê `--altura-barra`; sem valor mágico duplicado (§0.1) |
| **ALTO** | Carrossel visível durante a busca com âncoras mortas | Trilho é substituído pela linha de resumo + "Limpar" (§1) |
| **MÉDIO** | `scrollIntoView` do chip ativo rolando a página vertical | `block: "nearest"` obrigatório (§2) |
| **MÉDIO** | Leitor de tela recitando a contagem a cada tecla | debounce de 500ms só na live region (§3) |
| **MÉDIO** | Cliente não entende por que um produto apareceu na busca | `<mark>` no trecho que casou + título da categoria preservado |
| **MÉDIO** | `Esc` no campo fechando o `Sheet` do carrinho por engano | `stopPropagation` quando há texto no campo |
| **BAIXO** | Loja com 1 ou 2 categorias ganha um trilho inútil | Renderizar `NavCategorias` só com **≥3 categorias** (abaixo disso o catálogo cabe na rolagem natural) |
| **BAIXO** | Nome de categoria longo ("Bolos e Tortas") esticando o chip | `white-space: nowrap` + o trilho rola; não truncar (nome truncado de categoria não identifica nada) |
| **BAIXO** | Loja sem produto (`temVazio`) renderizando barra vazia | Barra inteira não renderiza quando `temVazio` |

---

## 6. Onde o trabalho cai

- Escopo **novo**, sem relação com a branch atual
  (`feat/enderecos-curtos-maps-e-observacao`). Issue nova em `tasks/` + branch
  própria.
- São **duas** issues, não uma: a busca depende só do util puro; o carrossel
  depende de exportar `ancora()` e de tornar a barra sticky. A busca é a mais
  barata e entrega valor sozinha.
- **Nada crítico** no sentido dos três mandatos: zero valor monetário, zero RLS,
  zero Server Action, zero schema. Filtro e scroll são 100% UX de cliente. →
  cabe em `/fluxo` sem `tdd` red-first; o único teste obrigatório é o unitário
  de `lib/utils/buscarProdutos.ts` (acento, caixa, descrição, categoria vazia).
- **Não testável automaticamente neste ambiente:** não há Playwright nem MCP de
  browser. Scrollspy, `scroll-snap` e alvo de toque verificam-se **a olho**
  abrindo `mockups/vitrine-nav-categorias-e-busca.html` e depois a vitrine real.
