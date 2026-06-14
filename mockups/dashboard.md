# /painel — Dashboard

**Rota:** `/painel` · **Issue:** 048 · **Mundo:** Painel (tokens iRango)
**Composição:** 3 cards de métricas + `TabelaPedidos` (pedidos recentes). Ver `tabela-pedidos.md`.

---

## Desktop (≥1024px) — dentro do layout-painel

```
┌───────────────────────────────────────────────────────────────────┐
│ Dashboard                                                          │  ← h1
│                                                                    │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐        │
│ │ Pedidos hoje    │ │ Pendentes       │ │ Total do dia    │        │  ← 3 Cards métrica
│ │                 │ │                 │ │                 │        │
│ │      12         │ │      3          │ │   R$ 684,00     │        │
│ │ 🛍 (azul)        │ │ ⏱ (âmbar)        │ │ 💰 (verde)       │        │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘        │
│                                                                    │
│ Pedidos recentes                                       [Ver todos] │  ← h2 + link /painel/pedidos
│ ┌────────────────────────────────────────────────────────────┐    │
│ │ Pedido  Cliente        Valor      Status        Hora        │    │  ← TabelaPedidos
│ │ #A1B2C3 Maria Souza    R$ 57,20   [⏱ Pendente]  14:32       │    │
│ │ #D4E5F6 João Lima      R$ 42,00   [✓ Confirmado] 14:18      │    │
│ │ #G7H8I9 Ana Paula      R$ 88,50   [👨‍🍳 Em preparo] 13:55     │    │
│ │ #J0K1L2 Pedro Alves    R$ 31,00   [✓ Entregue]  13:40       │    │
│ └────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

## Mobile (<1024px) — métricas empilhadas, pedidos viram card-list

```
┌────────────────────────────────────────────┐
│ Dashboard                                    │
│ ┌──────────────────────────────────────┐    │
│ │ Pedidos hoje                 🛍       │    │  ← Cards 1 por linha (ou 2 col)
│ │ 12                                    │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ Pendentes                    ⏱       │    │
│ │ 3                                     │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ Total do dia                 💰      │    │
│ │ R$ 684,00                             │    │
│ └──────────────────────────────────────┘    │
│                                              │
│ Pedidos recentes              [Ver todos]    │
│ ┌──────────────────────────────────────┐    │
│ │ #A1B2C3            [⏱ Pendente]       │    │  ← TabelaPedidos como card-list
│ │ Maria Souza                           │    │     (NÃO scroll horizontal)
│ │ R$ 57,20 · 14:32                      │    │
│ └──────────────────────────────────────┘    │
│ ┌──────────────────────────────────────┐    │
│ │ #D4E5F6            [✓ Confirmado]     │    │
│ │ João Lima · R$ 42,00 · 14:18          │    │
│ └──────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

## Empty state — sem pedidos hoje

```
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐   │
│ │ Pedidos hoje  0  │ │ Pendentes     0  │ │ Total do dia R$0 │   │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘   │
│ Pedidos recentes                                                   │
│ ┌────────────────────────────────────────────────────────────┐    │
│ │                       📭                                    │    │
│ │            Nenhum pedido ainda hoje.                        │    │
│ │  Compartilhe o link da sua loja para começar a vender.      │    │
│ │            [ Copiar link da loja ]                          │    │  ← CTA, não tela em branco
│ └────────────────────────────────────────────────────────────┘    │
```

## Loading (skeleton)

```
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ ▓▓▓▓  ░░░░  │ │ ▓▓▓▓  ░░░░  │ │ ▓▓▓▓  ░░░░  │ │  ← Skeleton nos cards
│ └──────────────┘ └──────────────┘ └──────────────┘ │
│ ▓▓▓▓▓▓▓▓▓▓ (linhas skeleton da tabela)             │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Cards métrica | `Card` + ícone lucide | grid `1/2 → lg:3` colunas |
| Valor da métrica | `<p>` | `text-2xl font-bold` |
| Tabela | `TabelaPedidos` | ver `tabela-pedidos.md` |
| Status | `BadgeStatus tipo="pedido"` | cores de sistema |
| Ver todos | `<a>` → `/painel/pedidos` | — |

## Notas UX / Acessibilidade
- Métricas comunicam com **número + rótulo** (ícone é reforço, `aria-hidden`).
- Cor dos ícones de métrica alinhada à semântica (pendentes = âmbar) mas o significado está no rótulo.
- No mobile a `TabelaPedidos` vira **card-list**, sem scroll horizontal (design-system §9).
- Empty state com CTA "Copiar link da loja" (toast ao copiar) — nunca tela em branco.
- Skeleton mantém o layout (sem salto de conteúdo ao carregar).
