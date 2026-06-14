# CardProduto — Card de produto na vitrine

**Componente:** `components/vitrine/CardProduto.tsx`
**Mundo:** Vitrine (mobile-first) · **Issue:** 029
**Tema:** botão "Adicionar" usa `--cor-primaria` (fundo) com **texto branco fixo** (não derivado do tema). Preço formatado por `lib/utils/formatarMoeda.ts` (BRL).

---

## Mobile — card padrão

```
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │
│ │                              │ │
│ │      FOTO (aspect 4:3)       │ │  ← next/image, object-cover, rounded-t-lg
│ │         🥖                   │ │
│ └──────────────────────────────┘ │
│                                  │
│ Pão de fermentação natural       │  ← nome (text-base font-semibold)
│ Casca crocante, miolo aerado.    │  ← descrição (text-sm text-muted, 2 linhas máx)
│                                  │
│ R$ 18,00          ┌────────────┐ │
│ (text-lg bold)    │ + Adicionar│ │  ← Button, bg=var(--cor-primaria), ≥44px
│                   └────────────┘ │
└──────────────────────────────────┘
```

## Mobile — produto JÁ no carrinho (mostra stepper)

```
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │
│ │      FOTO (4:3)  🥖          │ │
│ └──────────────────────────────┘ │
│ Pão de fermentação natural       │
│ Casca crocante, miolo aerado.    │
│                                  │
│ R$ 18,00      ┌───┬─────┬───┐    │
│               │ − │  2  │ + │    │  ← stepper, cada alvo ≥44×44px
│               └───┴─────┴───┘    │     borda=var(--cor-primaria)
└──────────────────────────────────┘
```

## Produto INDISPONÍVEL

```
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │
│ │   FOTO (4:3, opacity-50)     │ │
│ │   ╭────────────────╮         │ │
│ │   │ Indisponível   │ [Badge] │ │  ← cor + texto (não só cor)
│ │   ╰────────────────╯         │ │
│ └──────────────────────────────┘ │
│ Pão de fermentação natural       │
│ R$ 18,00          ┌────────────┐ │
│                   │ Indisponível│ │  ← Button disabled
│                   └────────────┘ │
└──────────────────────────────────┘
```

## Loading (skeleton)

```
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │  ← Skeleton 4:3
│ └──────────────────────────────┘ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓                     │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                 │
│ ▓▓▓▓▓      ░░░░░░░░░░            │
└──────────────────────────────────┘
```

## Grid responsivo
- **Mobile (360px):** 1 coluna (`grid-cols-1`) ou 2 colunas a partir de ~400px.
- **Tablet (≥640px):** `sm:grid-cols-2`
- **Desktop (≥1024px):** `lg:grid-cols-3`

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Container | `Card` (shadcn) | `rounded-lg overflow-hidden` |
| Foto | `next/image` | `aspect-[4/3] object-cover` |
| Nome | `<h3>` | `text-base font-semibold` |
| Descrição | `<p>` | `text-sm text-muted-foreground line-clamp-2` |
| Preço | `<span>` | `text-lg font-bold` (formatarMoeda) |
| Adicionar | `Button` | `bg-[var(--cor-primaria)] text-white min-h-11` |
| Stepper | `Button`×2 + valor | cada botão `size-11` (≥44px) |
| Indisponível | `Badge` + overlay | cor + texto |

## Notas UX / Acessibilidade
- Alvo de toque do "Adicionar" e do stepper **≥44×44px** (design-system §5).
- Texto do botão é **branco fixo** sobre `--cor-primaria` — protege contra cor de marca clara (risco de contraste, §4).
- Toast (sonner) ao adicionar: "Adicionado ao carrinho" — feedback imediato.
- `alt` da foto = nome do produto. Stepper com `aria-label` "Diminuir/Aumentar quantidade".
- Descrição truncada em 2 linhas (`line-clamp-2`) para manter altura uniforme do grid.
- Indisponível: card não fica só esmaecido — tem badge textual + botão desabilitado (não só cor).
