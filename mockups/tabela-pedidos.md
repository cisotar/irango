# TabelaPedidos — lista de pedidos (com card-list mobile)

**Componente:** `components/painel/TabelaPedidos.tsx` · **Issue:** 050 · **Mundo:** Painel
**Usada em:** dashboard (recentes) e `/painel/pedidos` (gestão completa). Badge colorido por status via `BadgeStatus tipo="pedido"` — cores de sistema, **não** do tema (design-system §8).

---

## Desktop (≥768px) — tabela densa

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Pedido   Cliente         Valor      Status            Hora      Ações      │  ← cabeçalho
├──────────────────────────────────────────────────────────────────────────┤
│ #A1B2C3  Maria Souza     R$ 57,20   [⏱ Pendente]      14:32     [Ver] ▾    │
│ #D4E5F6  João Lima       R$ 42,00   [✓ Confirmado]    14:18     [Ver] ▾    │
│ #G7H8I9  Ana Paula       R$ 88,50   [👨‍🍳 Em preparo]    13:55     [Ver] ▾    │
│ #M3N4O5  Lucas Reis      R$ 25,00   [🛵 Saiu entrega]  13:30     [Ver] ▾    │
│ #J0K1L2  Pedro Alves     R$ 31,00   [✓ Entregue]      13:40     [Ver] ▾    │
│ #P6Q7R8  Bia Nunes       R$ 19,00   [✕ Cancelado]     12:10     [Ver] ▾    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Cores do badge por status (cor + texto + ícone — ver badge-status.md)
```
[⏱ Pendente]     → âmbar    (requer ação)
[✓ Confirmado]   → azul     (em fila)
[👨‍🍳 Em preparo]  → índigo   (em andamento)
[🛵 Saiu entrega] → ciano    (em trânsito)
[✓ Entregue]     → verde    (sucesso, terminal)
[✕ Cancelado]    → vermelho (encerrado sem sucesso)
```

### Ação por linha (DropdownMenu) — avança a máquina de estados
```
[Ver] ▾
 ├ Ver detalhes
 ├ Confirmar          ← pendente → confirmado
 ├ Marcar em preparo  ← confirmado → em_preparo
 ├ Saiu pra entrega   ← em_preparo → saiu_entrega
 ├ Marcar entregue    ← saiu_entrega → entregue
 └ Cancelar pedido    ← destrutivo (AlertDialog confirma)
```
(opções visíveis dependem do status atual — só transições válidas da RN-08)

## Mobile (<768px) — card-list (NÃO scroll horizontal)

```
┌────────────────────────────────────────────┐
│ ┌──────────────────────────────────────┐    │
│ │ #A1B2C3              [⏱ Pendente]     │    │  ← id curto + badge no topo
│ │ Maria Souza                           │    │
│ │ R$ 57,20 · 14:32                      │    │
│ │ ┌──────────┐  ┌───────────────────┐   │    │
│ │ │ Detalhes │  │ Confirmar pedido  │   │    │  ← ação principal do estado, ≥44px
│ │ └──────────┘  └───────────────────┘   │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ #G7H8I9            [👨‍🍳 Em preparo]    │    │
│ │ Ana Paula                             │    │
│ │ R$ 88,50 · 13:55                      │    │
│ │ ┌──────────┐  ┌───────────────────┐   │    │
│ │ │ Detalhes │  │ Saiu pra entrega  │   │    │
│ │ └──────────┘  └───────────────────┘   │    │
│ └──────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

## Filtros (em /painel/pedidos)

```
┌────────────────────────────────────────────┐
│ [Todos] [Pendentes] [Em preparo] [Entregues] │  ← Tabs / Toggle de filtro de status
│ 🔍 Buscar por cliente ou #pedido             │
└────────────────────────────────────────────┘
```

## Confirmação de cancelamento (AlertDialog)

```
┌──────────────────────────────────────┐
│ Cancelar pedido #A1B2C3?              │  ← AlertDialog
│                                       │
│ O cliente Maria Souza será            │  ← deixa claro O QUE acontece
│ notificado. Esta ação não pode ser    │
│ desfeita.                             │
│                                       │
│        [ Voltar ]  [ Cancelar pedido ]│  ← destrutivo diferenciado (vermelho)
└──────────────────────────────────────┘
```

## Empty state

```
│ ┌────────────────────────────────────────┐  │
│ │              📭                          │  │
│ │   Nenhum pedido neste filtro.            │  │
│ │   [ Limpar filtros ]                     │  │  ← CTA
│ └────────────────────────────────────────┘  │
```

## Loading (skeleton)

```
│ ▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓  ▓▓▓▓  ░░░░░░  ▓▓▓▓  │  ← linhas skeleton
│ ▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓  ▓▓▓▓  ░░░░░░  ▓▓▓▓  │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Tabela (desktop) | `Table` (shadcn) | `hidden md:table` |
| Card-list (mobile) | `Card`×N | `md:hidden`, ação ≥44px |
| Status | `BadgeStatus tipo="pedido"` | cores de sistema |
| Ações por linha | `DropdownMenu` | só transições válidas |
| Cancelar | `AlertDialog` | destrutivo, diz o que acontece |
| Filtros | `Tabs` / `ToggleGroup` + `Input` busca | — |

## Notas UX / Acessibilidade
- **Mesma fonte de dados** alimenta tabela (desktop) e card-list (mobile) — sem scroll horizontal (design-system §9).
- Status sempre **cor + texto + ícone** (`BadgeStatus`); cores de sistema, não tema da loja.
- Menu de ação mostra **só transições válidas** do status atual (RN-08) — evita estado inválido.
- Cancelamento usa `AlertDialog` (Radix) deixando claro o que acontece e que é irreversível; botão destrutivo diferenciado (vermelho).
- No mobile, a ação principal do estado vira botão visível no card (não escondida em menu) — ≥44px.
- Id curto (`#A1B2C3`) é o identificador legível; valor formatado por `formatarMoeda`.
