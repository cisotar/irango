# Layout do Painel — sidebar + topbar mobile

**Componente:** layout de `/painel/*` · **Issue:** 039 · **Mundo:** Painel (tokens iRango, sem tema de loja)
**Navegação:** Dashboard, Pedidos, Produtos, Cupons, Configurações, Logout. Item ativo destacado.

---

## Desktop (≥1024px) — sidebar fixa

```
┌──────────────┬───────────────────────────────────────────────────┐
│ 🥖 iRango     │  Dashboard                                    Ciso ▾│  ← topbar (título + menu usuário)
│              │                                                    │
│ ▸ Dashboard  │  ┌─────────────────────────────────────────────┐  │  ← item ATIVO: bg-accent,
│   Pedidos    │  │                                             │  │     borda-l var(--cor-primaria?),
│   Produtos   │  │           ÁREA DE CONTEÚDO                   │  │     ícone + texto
│   Cupons     │  │           (página atual)                    │  │
│   Config.    │  │                                             │  │
│              │  └─────────────────────────────────────────────┘  │
│ ──────────── │                                                    │
│   Sair       │                                                    │  ← Logout no rodapé da sidebar
└──────────────┴───────────────────────────────────────────────────┘
```
Item ativo: `aria-current="page"` + fundo `bg-accent` + ícone com cor de destaque. Cada item tem ícone lucide + texto.

## Mobile (<1024px) — topbar com hamburger

```
┌────────────────────────────────────────────┐
│ ☰  Dashboard                          Ciso ▾│  ← topbar; ☰ abre Sheet, ≥44px
├────────────────────────────────────────────┤
│                                              │
│            ÁREA DE CONTEÚDO                  │
│            (página atual)                    │
│                                              │
└────────────────────────────────────────────┘
```

## Mobile — drawer de navegação aberto (Sheet)

```
┌──────────────────────────┬─────────────────┐
│ 🥖 iRango          [✕]    │                 │  ← SheetHeader + close (aria-label)
│                          │                 │
│ ▸ Dashboard              │   (conteúdo      │
│   Pedidos                │    escurecido    │
│   Produtos               │    por overlay)  │
│   Cupons                 │                 │
│   Configurações          │                 │
│ ──────────────────────── │                 │
│   Sair                   │                 │
└──────────────────────────┴─────────────────┘
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Sidebar (desktop) | `<nav>` + lista | `hidden lg:flex w-60` |
| Drawer (mobile) | `Sheet` + `SheetContent side=left` | `lg:hidden` |
| Gatilho hamburger | `Button` ghost + `Menu` icon | `aria-label="Abrir menu"`, ≥44px |
| Item de nav | `<a>` + ícone lucide | ativo: `bg-accent aria-current="page"` |
| Menu usuário | `DropdownMenu` | nome + "Sair" |
| Logout | item de nav / dropdown | `LogOut` icon |

## Notas UX / Acessibilidade
- **Item ativo** marcado com `aria-current="page"` **e** estilo visual (não só cor — também peso/fundo).
- Hamburger ≥44×44px com `aria-label`; `Sheet` (Radix) entrega foco preso + ESC.
- Mesma lista de navegação em desktop e mobile (uma fonte de verdade).
- Tokens iRango — painel não usa tema da loja (esse tema é só da vitrine).
- Conteúdo da página rola; sidebar/topbar ficam fixas.
