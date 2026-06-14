# / — Landing page (iRango)

**Rota:** `/` · **Issue:** (landing) · **Mundo:** Produto/marketing (tokens iRango — sem tema de loja)
**CTA principal:** "Crie sua loja grátis" → `/cadastro`.

---

## Mobile

```
┌────────────────────────────────────────────┐
│ 🥖 iRango                         [Entrar]  │  ← topbar simples
├────────────────────────────────────────────┤
│                                              │
│   Sua loja online,                           │  ← HERO headline (h1, text-3xl bold)
│   pronta em minutos.                         │
│                                              │
│   Receba pedidos pelo celular, sem taxa      │  ← subheadline (text-muted)
│   de marketplace. Você no controle.          │
│                                              │
│   ┌──────────────────────────────────────┐ │
│   │      Crie sua loja grátis             │ │  ← Button primário ≥44px → /cadastro
│   └──────────────────────────────────────┘ │
│   Já tem conta? Entrar                       │  ← link
│                                              │
│   ┌──────────────────────────────────────┐ │
│   │     [ ilustração / mockup vitrine ]   │ │
│   └──────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│ Por que o iRango                             │  ← h2
│                                              │
│ ┌──────────────────────────────────────┐    │
│ │ 🎨  Sua marca, suas cores             │    │  ← Card benefício 1
│ │ Personalize a vitrine com o tema da   │    │
│ │ sua loja.                             │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ 📱  Cliente compra pelo celular       │    │  ← Card benefício 2
│ │ Sem app, sem login, sem fricção.      │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ 💸  Sem comissão por pedido           │    │  ← Card benefício 3
│ │ Você fica com o valor das suas        │    │
│ │ vendas.                               │    │
│ └──────────────────────────────────────┘    │
├────────────────────────────────────────────┤
│        Comece a vender hoje                  │  ← CTA secundário (h2)
│   ┌──────────────────────────────────────┐ │
│   │      Crie sua loja grátis             │ │  ← Button primário → /cadastro
│   └──────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│ 🥖 iRango · Termos · Privacidade · Contato   │  ← footer
└────────────────────────────────────────────┘
```

## Desktop (≥1024px) — hero em 2 colunas, benefícios em 3 colunas

```
┌──────────────────────────────────────────────────────────────────┐
│ 🥖 iRango                                              [Entrar]    │
├────────────────────────────────────────┬─────────────────────────┤
│ Sua loja online, pronta em minutos.     │                         │
│ Receba pedidos pelo celular, sem taxa.  │   [ mockup vitrine ]    │
│ [ Crie sua loja grátis ]  Entrar        │                         │
├──────────────────────────────────────────────────────────────────┤
│ Por que o iRango                                                   │
│ ┌────────────┐  ┌────────────┐  ┌────────────┐                    │
│ │🎨 Sua marca│  │📱 No celular│  │💸 Sem comis.│  ← 3 colunas      │
│ └────────────┘  └────────────┘  └────────────┘                    │
│                  [ Crie sua loja grátis ]   ← CTA secundário       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Topbar | `<header>` + `Button` ghost (Entrar) | — |
| Hero CTA | `Button` | primário, `min-h-11`, `text-base` |
| Benefícios | `Card`×3 + ícone lucide | grid `1 → md:3` colunas |
| CTA rodapé | `Button` | mesmo estilo do hero |
| Footer | `<footer>` + links | `text-sm text-muted` |

## Notas UX / Acessibilidade
- Headline é o único `<h1>`; benefícios e CTA secundário são `<h2>`.
- CTA primário "Crie sua loja grátis" aparece **duas vezes** (hero + rodapé) — mesma copy, mesmo destino.
- Cada card de benefício: ícone (`aria-hidden`) + título + texto — não depende só do ícone.
- Tokens iRango (não tema de loja) — esta é página de marca do produto.
- Layout funciona a partir de 360px (tudo empilha em 1 coluna).
