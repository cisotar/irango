# HeaderLoja — Cabeçalho da vitrine

**Componente:** `components/vitrine/HeaderLoja.tsx`
**Mundo:** Vitrine (mobile-first) · **Issue:** 028
**Tema:** consome `--cor-primaria` (fundo) e `--cor-destaque` (realce). Texto sobre `--cor-primaria` é **fixado em branco/escuro pelo componente** (não derivado do tema) — risco de contraste do tema custom (design-system §4).

---

## Mobile (≥360px) — loja ABERTA

```
┌────────────────────────────────────────────┐
│  fundo = var(--cor-primaria)                 │
│                                              │
│   ┌──────┐                                   │
│   │ LOGO │   Pão do Ciso                     │  ← nome (text-xl, font-bold, branco)
│   │ 🥖   │   Pães artesanais · Centro        │  ← subtítulo (text-sm, branco/80)
│   └──────┘                                   │
│                                              │
│   ╭─────────────────────╮                    │
│   │ ● Aberto agora      │  [BadgeStatus]     │  ← verde, cor+texto+ícone
│   ╰─────────────────────╯                    │
│                                              │
└────────────────────────────────────────────┘
```

## Mobile — loja FECHADA

```
┌────────────────────────────────────────────┐
│  fundo = var(--cor-primaria)                 │
│   ┌──────┐                                   │
│   │ LOGO │   Pão do Ciso                     │
│   └──────┘   Pães artesanais · Centro        │
│                                              │
│   ╭───────────────────────────────────╮      │
│   │ ○ Fechado · abre seg às 08:00     │      │  ← cinza, cor+texto+ícone
│   ╰───────────────────────────────────╯      │
└────────────────────────────────────────────┘
```

## Desktop (≥768px) — layout em linha

```
┌──────────────────────────────────────────────────────────────────┐
│ fundo=var(--cor-primaria)                                          │
│  ┌──────┐  Pão do Ciso                          ╭───────────────╮  │
│  │ LOGO │  Pães artesanais · Centro             │ ● Aberto agora│  │
│  └──────┘                                        ╰───────────────╯  │
└──────────────────────────────────────────────────────────────────┘
```

## Estados

**Loading (skeleton):**
```
┌────────────────────────────────────────────┐
│  ┌──────┐  ▓▓▓▓▓▓▓▓▓▓▓                       │  ← Skeleton (shadcn)
│  │ ░░░░ │  ▓▓▓▓▓▓                            │
│  └──────┘  ▓▓▓▓▓▓▓▓                          │
└────────────────────────────────────────────┘
```

**Sem logo:** mostra inicial do nome em círculo com `--cor-destaque` de fundo.
```
   ╭───╮
   │ P │   Pão do Ciso
   ╰───╯
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Faixa de fundo | `<header>` | `bg-[var(--cor-primaria)]` |
| Logo | `next/image` + fallback `Avatar` (shadcn) | `rounded-lg`, 56×56 |
| Nome da loja | `<h1>` | `text-xl font-bold text-white` |
| Subtítulo | `<p>` | `text-sm text-white/80` |
| Status | `BadgeStatus` (compartilhado) | ver `badge-status.md` |
| Skeleton | `Skeleton` (shadcn) | — |

## Notas UX / Acessibilidade
- `<h1>` único da página é o nome da loja (semântica/SEO).
- Texto sobre `--cor-primaria` é **branco fixo** — não confiar na luminância do tema do lojista (design-system §4, risco de contraste).
- Logo com `alt` = nome da loja; fallback com inicial tem `aria-hidden` + nome visível ao lado.
- Header é `sticky top-0 z-30` no mobile para o status ficar sempre à vista durante o scroll.
