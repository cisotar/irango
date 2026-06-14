# Carrinho — Drawer/Sheet de carrinho

**Componente:** `components/vitrine/Carrinho.tsx`
**Mundo:** Vitrine (mobile-first) · **Issue:** 029
**Tema:** "Finalizar pedido" usa `--cor-primaria`. Preview de frete/desconto/total é **estimativa de UX** — valor cobrado é recalculado no servidor (design-system §1.5, §6).
Estado em `hooks/useCarrinho.ts` (sessionStorage).

---

## Mobile — Sheet aberto lateralmente (com itens)

```
┌────────────────────────────────────────────┐
│ Seu pedido                            [✕]   │  ← SheetHeader, ✕ = SheetClose (aria-label)
├────────────────────────────────────────────┤
│ ┌──┐ Pão fermentação natural               │
│ │🥖│ R$ 18,00                               │
│ └──┘  ┌───┬─────┬───┐            [🗑]        │  ← stepper + remover (aria-label)
│       │ − │  2  │ + │                        │
│       └───┴─────┴───┘                        │
│ ────────────────────────────────────────── │
│ ┌──┐ Focaccia de alecrim                    │
│ │🫓│ R$ 22,00                               │
│ └──┘  ┌───┬─────┬───┐            [🗑]        │
│       │ − │  1  │ + │                        │
│       └───┴─────┴───┘                        │
├────────────────────────────────────────────┤
│ Cupom de desconto                            │
│ ┌──────────────────────┐ ┌──────────────┐  │
│ │ PAOCISO10            │ │   Aplicar    │  │  ← Input + Button(outline)
│ └──────────────────────┘ └──────────────┘  │
│ ✓ Cupom PAOCISO10 aplicado (−10%)           │  ← feedback verde (texto)
├────────────────────────────────────────────┤
│ Entregar em                                  │
│ ┌──────────────────────────────────────┐   │
│ │ Centro — R$ 5,00              ▾       │   │  ← Select (zona de entrega)
│ └──────────────────────────────────────┘   │
├────────────────────────────────────────────┤
│ ⓘ Valores estimados. O total é confirmado   │  ← nota de estimativa (text-xs muted)
│   na finalização.                            │
│                                              │
│ Subtotal                          R$ 58,00   │
│ Frete (Centro)                    R$  5,00   │
│ Desconto (PAOCISO10)             − R$  5,80   │  ← em --cor-destaque ou verde
│ ─────────────────────────────────────────── │
│ Total estimado                    R$ 57,20   │  ← text-lg bold
│                                              │
│ ┌──────────────────────────────────────┐   │
│ │        Finalizar pedido               │   │  ← Button bg=var(--cor-primaria), ≥44px
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

## Estado VAZIO

```
┌────────────────────────────────────────────┐
│ Seu pedido                            [✕]   │
├────────────────────────────────────────────┤
│                                              │
│                  🛒                          │
│                                              │
│        Seu carrinho está vazio               │  ← texto
│   Adicione itens da loja para começar.       │
│                                              │
│        ┌──────────────────────┐              │
│        │   Ver produtos       │              │  ← CTA fecha o sheet
│        └──────────────────────┘              │
└────────────────────────────────────────────┘
```

## Estado de ERRO no cupom

```
│ ┌──────────────────────┐ ┌──────────────┐  │
│ │ CUPOMERRADO         │ │   Aplicar    │  │  ← Input aria-invalid
│ └──────────────────────┘ └──────────────┘  │
│ ⚠ Cupom inválido ou expirado.    [Tentar]   │  ← erro (text-destructive) + retry
```

## Loading no submit

```
│ ┌──────────────────────────────────────┐   │
│ │   ◌ Finalizando…                      │   │  ← Button disabled + spinner
│ └──────────────────────────────────────┘   │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Container | `Sheet` + `SheetContent` (shadcn, side="right") | full-height mobile |
| Fechar | `SheetClose` + `X` icon | `aria-label="Fechar carrinho"` |
| Linha de item | `<li>` + thumb 48×48 | `divide-y` |
| Stepper | `Button`×2 | `size-11` (≥44px) |
| Remover | `Button` ghost + `Trash2` | `aria-label="Remover {produto}"` |
| Cupom | `Input` + `Button` outline | — |
| Zona | `Select` (shadcn) | label "Entregar em" |
| Resumo | `<dl>` | `text-sm`, total `text-lg font-bold` |
| Nota estimativa | `<p>` + `Info` icon | `text-xs text-muted-foreground` |
| Finalizar | `Button` | `bg-[var(--cor-primaria)] text-white min-h-11` |

## Notas UX / Acessibilidade
- **Sempre acessível** via FAB (mobile) / sidebar (desktop) — design-system §6.
- **"Valores estimados"** explícito acima do resumo — preview é estética; servidor é autoridade (§1.5).
- Desconto exibido com sinal negativo e cor de realce + **texto** "(PAOCISO10)" (não só cor).
- Remover item é trivial e imediato; zerar o stepper remove o item (reversibilidade, §6).
- Erro de cupom com `aria-invalid` no input + `aria-describedby` na mensagem + botão "Tentar".
- "Finalizar pedido" desabilita e mostra spinner durante a Server Action (evita duplo envio).
- `Sheet` (Radix) já entrega foco preso, ESC fecha, `role="dialog"`.
