# Mockup — linha de produto em `/painel/produtos`

**Escopo (revisado, conservador):** só reposicionamento de dois elementos na linha de
produto do painel. Nada de switch, nada de edição inline, nada de redistribuir ações.

1. Os botões **Ocultar** e **Disponibilizar** ficam exatamente como estão.
2. O **kebab (⋮)** sai da linha órfã e passa para a **direita dos dois botões**.
3. As **pills de opcionais** saem de "ao lado do título" e passam para **abaixo do título**.

**Preview no navegador:**
- `mockups/produtos-linha-desktop.html`
- `mockups/produtos-linha-mobile.html`

> Mundo: **painel**, não vitrine. O tema por loja (`lojas.tema` → `primaria`/`fundo`/`destaque`)
> **não se aplica aqui** — o painel usa a superfície fixa de `design-system.md` §10
> (creme `#f5f0e6`, card branco, limite `#8a8a8a`). Por isso os HTMLs não têm config de cor de
> loja. Eles usam CSS puro recriando os primitivos shadcn (`.card`, `.chip`, `.btn`), sem CDN,
> para abrirem offline. Base de fonte em **120%**, como `globals.css`, para que os 44px
> apareçam na proporção real.

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`): `button`, `badge`, `card`, `menu`, `dialog`,
  `sheet`, `accordion`, `checkbox`, `input`, `label`, `separator`, `switch`, `textarea`,
  `alert-dialog`, `radio-group`
- **Componentes vitrine/painel**: `ThumbProduto`, `BadgeStatus`, `BarraSelecaoLote`,
  `GerenciarCategorias`, `LinhaItemOpcional`, `CardapioAdminClient` (consome o mesmo
  `ProdutosClient`)
- **Tokens** (`globals.css` `@theme`): `--color-promo-texto`, `--border`/`.superficie-painel`
- **Telas comparadas**: `CuponsClient.tsx`, `OpcionaisClient.tsx`, `CardapioAdminClient.tsx`

**Decisão: REUSAR.**
**Justificativa:** nenhum componente, variante, token ou prop novo — a mudança é ordem de
filhos no flex e uma classe de posicionamento; os mesmos `Button`, `Badge` e `Menu` de hoje.

---

## 1. Como está — desktop 920px

```
┌─ Pães ─────────────────────────── ^   ⚙ Opcionais   ＋ Novo produto ─┐
│ [img] Pão de campanha    (Coloração)(Antipasti)(Bebidas) [Ocultar][Disponibilizar]
│       R$ 30,00 (Esgotado)
│  [⋮]                       ← kebab órfão, linha própria, ancorado à ESQUERDA
│                            ← ~50px de banda morta por produto
└──────────────────────────────────────────────────────────────────────┘
```

`ProdutosClient.tsx:885-1137`. A linha é `flex flex-wrap` e o kebab é
`order-3 sm:order-last` (**linha 1010**). No desktop a ordem fica thumb → texto → chips →
botões → kebab e a soma das larguras mínimas estoura:

| Filho | Largura mínima | Encolhe? |
|---|---|---|
| `ThumbProduto` | 44px | não (`flex: none`) |
| bloco nome/preço | `sm:min-w-[14rem]` ≈ 269px na base de 120% | até o piso |
| `<ul>` de 3 chips (linha 1078) | ~250px | **não** |
| par de botões | ~280px | não |
| kebab | 44px | não |

O último item da ordem (o kebab) forma uma segunda linha de flex e, com `justify-content`
padrão, ancora à esquerda: o ⋮ do "Pão de campanha" fica mais perto do "Pão italiano" do que
do produto que ele controla.

### Como está — mobile 360px

Três faixas por produto, porque o kebab entra em `order-3`, antes dos chips:

```
[img] Pão de campanha                        [⋮]      ← faixa 1
      R$ 30,00 (Esgotado)
(Coloração)(Antipasti)(Bebidas)                       ← faixa 2  (w-full)
[   Ocultar   ][   Disponibilizar   ]                 ← faixa 3  (basis-full, flex-1)
```

Ordem de leitura: nome → ⋮ → chips → ações.

---

## 2. Proposta

### 2.1 Pills de opcionais descem para baixo do título

A `<ul>` de `opcionaisPorCategoria[p.categoria_id]` (hoje **irmã** da linha, linha 1078)
passa a morar **dentro** do bloco de texto (`div.min-w-0.flex-1.sm:min-w-[14rem]`), logo
abaixo da faixa de preço/status — antes dos chips de cardápio e do aviso âmbar de RN-12,
que continuam na ordem de hoje.

- Some o único filho da linha que **não encolhe** → o wrap do kebab acaba como efeito
  colateral, sem tocar em regra de negócio;
- o nome do produto recupera a largura que as pills consumiam;
- no mobile, some uma faixa inteira por produto.

**Classes:** perde `order-4 flex w-full min-w-0 shrink flex-wrap gap-1.5 sm:order-3 sm:w-auto`,
fica `mt-1.5 flex flex-wrap gap-1.5`.

**Acessibilidade (achado corrigido de graça):** a `<ul>` não tem rótulo acessível hoje — um
leitor de tela anuncia "lista, 3 itens" sem dizer de quê. Abaixo do nome, ganha
`aria-label="Opcionais da categoria {nome}"`.

### 2.2 Kebab vira o último filho do grupo de ação

O `<Menu>` do kebab (hoje linha 1003, **antes** dos chips no DOM) passa para dentro do `div`
que já agrupa os dois botões, como último filho:

```
<div class="order-last flex w-full basis-full gap-2 sm:w-auto sm:basis-auto">
  [Ocultar]  [Disponibilizar]  [⋮]
</div>
```

- perde `order-3 sm:order-last`, ganha `shrink-0` — a ordem do DOM já é a ordem visual nos
  dois breakpoints;
- se um dia quebrar, quebra **junto com os botões do produto dele**, nunca sozinho;
- no mobile o ⋮ para de vir antes do conteúdo na navegação por teclado e leitor de tela.

**Os dois `Button` não mudam:** mesmos rótulos que alternam (`Ocultar`/`Exibir`,
`Marcar esgotado`/`Disponibilizar`), mesmo `variant="outline"`, mesmo `min-h-[44px] flex-1
sm:flex-none`, mesmos `aria-label` nominais, mesmo `disabled` durante a alternância.

### Desktop proposto

```
┌─ Pães ─────────────────────────── ^   ⚙ Opcionais   ＋ Novo produto ─┐
│ [img] Pão de campanha                  [Ocultar][Disponibilizar] [⋮]
│       R$ 30,00 (Esgotado)
│       (Coloração)(Antipasti)(Bebidas)
└──────────────────────────────────────────────────────────────────────┘
```

### Mobile 360px proposto

```
[img] Pão de campanha
      R$ 30,00 (Esgotado)
      (Coloração)(Antipasti)(Bebidas)
[  Ocultar  ][ Disponibilizar ][⋮]        ← faixa única de controle
```

**Cabe:** largura útil ≈ 321px (360 − `px-4` nas duas bordas, base 120%).
Ocultar ≈ 88 + "Marcar esgotado" ≈ 153 + ⋮ 44 + 2 gaps de 9,6 ≈ **304px**. O rótulo mais
longo é o pior caso e ainda passa sem quebrar texto — o `whitespace-nowrap` do `Button` do
shadcn segue seguro.

---

## 3. Anatomia depois da mudança

```
linha do produto  (flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3)
├── [modoSelecao] <label> checkbox         44×44 literal — inalterado
├── ThumbProduto                           44×44 — inalterado
├── bloco de texto  (min-w-0 flex-1 sm:min-w-[14rem])
│   ├── nome                               line-clamp-2
│   ├── preço · badgeStatus · exclusivo · promoção
│   ├── <ul> opcionais                     ← MOVIDO para cá (2.1)
│   ├── <ul> cardápios vinculados          inalterado
│   └── <p role="alert"> aviso RN-12       inalterado
└── grupo de ação  (order-last, basis-full no mobile, auto em sm)
    ├── <Button> Ocultar / Exibir          inalterado
    ├── <Button> Marcar esgotado / Disponibilizar   inalterado
    └── <Menu> kebab                       ← MOVIDO para cá (2.2), último filho
```

Nenhuma prop nova. O contrato `AcoesProdutosClient` (21 chaves, duas variantes — lojista e
admin, issue 160) não é tocado. Como `CardapioAdminClient` usa o mesmo componente, a mudança
aparece nos dois mundos — e é o comportamento desejado, já que é só layout.

---

## 4. Atritos endereçados

| Impacto | Atrito | Onde | Fix |
|---|---|---|---|
| ALTO | kebab órfão, posse ambígua, ancorado à esquerda | `ProdutosClient.tsx:1010` | 2.2 |
| MÉDIO | ~50px de banda morta por linha | consequência do acima | 2.1 + 2.2 |
| MÉDIO | no mobile o kebab vem antes do conteúdo (`order-3`) | 1010 | 2.2 |
| MÉDIO | pills disputam largura com o nome do produto | 1078 | 2.1 |
| BAIXO | `<ul>` de opcionais sem rótulo acessível | 1078 | `aria-label` em 2.1 |

**Fora de escopo nesta rodada** (registrado, não proposto): hierarquia das ações, formato do
`badgeStatus`, repetição das pills de categoria em toda linha, edição inline.

---

## 5. Acessibilidade (WCAG 2.1 AA)

**Preservado:**
- alvos com **44px literal** (`min-h-[44px] min-w-[44px]`) — nunca `min-h-11` (52,8px) nem
  `size="icon-sm"` (33,6px) na base de 120% (§5);
- `aria-label` nominal no kebab ("Mais ações de {nome}") e nos dois botões;
- `badgeStatus` não depende só de cor: "Oculto" carrega `EyeOff` + texto;
- contraste: `--promo-texto` `#166534` sobre `--promo-fundo` `#dcfce7` ≈ 7:1;
  `text-amber-700` sobre branco passa AA.

**Melhora:** ordem de foco por teclado passa a ser nome → opcionais → Ocultar →
Disponibilizar → ⋮, em vez de nome → ⋮ → opcionais → ações. A ação destrutiva (Remover, dentro
do kebab) fica por último, depois das ações reversíveis.

**Novo:** `aria-label` na `<ul>` de opcionais.

---

## 6. Workflow

`/polir` — mudança puramente visual: ordem de filhos no JSX e classes Tailwind de
posicionamento. Zero Server Action, zero schema, zero valor monetário, zero teste novo
obrigatório. Gate: `npx tsc --noEmit` → `npm run lint` → `npm run build`.
