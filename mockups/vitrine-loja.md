# /loja/[slug] — Vitrine pública

**Rota:** `/loja/[slug]` · **Issue:** 036 · **Mundo:** Vitrine (mobile-first, sem login)
**Tema:** página inteira usa `--cor-fundo`; HeaderLoja e CTAs usam `--cor-primaria`; realces usam `--cor-destaque`. Injetados via CSS custom properties no SSR (design-system §4).

---

## Mobile — vitrine com produtos + FAB do carrinho

```
┌────────────────────────────────────────────┐
│ [ HeaderLoja ]  fundo=var(--cor-primaria)    │  ← ver header-loja.md (sticky)
│  🥖 Pão do Ciso     ● Aberto agora           │
├────────────────────────────────────────────┤  fundo da página = var(--cor-fundo)
│                                              │
│ 🔍 ┌──────────────────────────────────────┐ │
│    │ Buscar produto…                      │ │  ← Input busca (opcional)
│    └──────────────────────────────────────┘ │
│                                              │
│ [ Pães ] [ Doces ] [ Bebidas ]               │  ← Tabs / chips de categoria (âncoras)
│                                              │
│ ▸ Pães                                       │  ← título de seção (h2)
│ ┌──────────────────────────────────────┐    │
│ │ [ CardProduto ]  Pão fermentação      │    │  ← ver card-produto.md
│ │ R$ 18,00            [+ Adicionar]     │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ [ CardProduto ]  Focaccia alecrim     │    │
│ │ R$ 22,00            [+ Adicionar]     │    │
│ └──────────────────────────────────────┘    │
│                                              │
│ ▸ Doces                                      │
│ ┌──────────────────────────────────────┐    │
│ │ [ CardProduto ]  Brioche de doce      │    │
│ │ R$ 12,00            [+ Adicionar]     │    │
│ └──────────────────────────────────────┘    │
│                                              │
│            ┌─────────────────────────┐       │
│            │ 💬 Falar no WhatsApp    │       │  ← link wa.me (só se loja tem)
│            └─────────────────────────┘       │
│                                              │
│                              ╭─────────────╮ │
│                              │ 🛒 Ver       │ │  ← FAB carrinho (fixo, bottom-right)
│                              │  3 · R$57,20 │ │     bg=var(--cor-primaria), ≥44px
│                              ╰─────────────╯ │
└────────────────────────────────────────────┘
```

## Desktop (≥1024px) — grid + sidebar do carrinho

```
┌──────────────────────────────────────────────────────────────────┐
│ [ HeaderLoja ]                                                     │
├───────────────────────────────────────────────┬──────────────────┤
│  [Pães] [Doces] [Bebidas]                       │  Seu pedido      │
│                                                 │  ──────────────  │
│  ▸ Pães                                         │  Pão...  R$18,00 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │  Focaccia R$22   │
│  │CardProd │ │CardProd │ │CardProd │            │  ──────────────  │
│  └─────────┘ └─────────┘ └─────────┘            │  Total estimado  │
│  ▸ Doces                                        │      R$ 57,20    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │  [Finalizar]     │
│  └─────────┘ └─────────┘ └─────────┘            │  (sidebar fixa)  │
└─────────────────────────────────────────────────┴──────────────────┘
```
No desktop o `Carrinho` vira **sidebar fixa** (não Sheet); no mobile é FAB → `Sheet`.

## Empty state — loja sem produtos

```
├────────────────────────────────────────────┤
│                                              │
│                  📦                          │
│      Esta loja ainda não tem produtos.       │
│   Volte em breve ou fale no WhatsApp.        │
│        ┌─────────────────────────┐           │
│        │ 💬 Falar no WhatsApp    │           │  ← CTA (se houver)
│        └─────────────────────────┘           │
└────────────────────────────────────────────┘
```

## Loja FECHADA (banner persistente)

```
├────────────────────────────────────────────┤
│ ⓘ Loja fechada agora — abre seg às 08:00.    │  ← banner (cor+texto)
│   Você pode montar o pedido para depois.     │     Adicionar continua liberado*
├────────────────────────────────────────────┤
```
\*Decisão de negócio (pode permitir montar e bloquear só no checkout) — confirmar no spec.

## Loading (skeleton)

```
│ [Pães] [Doces]                               │
│ ┌─────────┐ ┌─────────┐                      │
│ │ ░░░░░░░ │ │ ░░░░░░░ │  ← CardProduto skeletons
│ │ ▓▓▓▓    │ │ ▓▓▓▓    │
│ └─────────┘ └─────────┘
```

---

## Anatomia / primitives

| Parte | Primitive / componente | Token / classe |
|-------|------------------------|----------------|
| Topo | `HeaderLoja` | `bg-[var(--cor-primaria)]` |
| Página | `<main>` | `bg-[var(--cor-fundo)]` |
| Busca | `Input` + `Search` | opcional |
| Categorias | `Tabs` ou chips com âncora | scroll suave até seção |
| Seção | `<section>` + `<h2>` | — |
| Cards | `CardProduto` | grid responsivo |
| FAB | `Button` fixo + `Sheet` trigger | `bg-[var(--cor-primaria)]`, `fixed bottom-4 right-4`, ≥44px |
| WhatsApp | `<a>` wa.me + `Button` | só se `loja.whatsapp` |

## Notas UX / Acessibilidade
- **Carrinho sempre acessível:** FAB no mobile (com contador + total estimado), sidebar fixa no desktop.
- Fundo da página = `--cor-fundo`; garantir contraste do texto dos cards independente da cor escolhida (cards usam superfície branca/neutra por cima do fundo).
- WhatsApp é `<a href="https://wa.me/55...">` com `aria-label` claro; some se a loja não configurou.
- Chips de categoria são âncoras (`#paes`) com scroll suave; `aria-current` na seção ativa.
- FAB tem `aria-label="Abrir carrinho, 3 itens, R$ 57,20"`.
- Funciona a partir de 360px (1 coluna).
