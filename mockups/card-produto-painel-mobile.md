# Card de produto no painel — correção de layout mobile

Tela: `/painel/produtos`
Fonte real: `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx` (linhas 358–442)

## Gate de reuso

- shadcn/ui varridos: `ui/button.tsx` (variants `ghost`/`outline`, sizes `sm`/`icon-sm`), `ui/badge.tsx` (`secondary`/`outline`), `ui/card.tsx`, `ui/menu.tsx` (Menu/MenuTrigger/MenuPortal/MenuPositioner/MenuPopup/MenuItem), `ui/separator.tsx`
- Componentes vitrine/painel: `painel/ThumbProduto.tsx` (thumb 40px com fallback de inicial), `painel/SeletorImprimirPedido.tsx` (padrão de menu kebab já em uso no painel), `painel/TabelaPedidos.tsx`
- Tokens: `@theme` de `globals.css` — `--color-foreground`, `--color-muted-foreground`, `--color-border`, `--color-destructive`, `--radius`. Escala de espaçamento padrão do Tailwind (múltiplos de 4)
- **Decisão: ADAPTAR** (layout do bloco de linha) + **CONSOLIDAR** (Editar/Remover para dentro do `ui/menu.tsx` que já é usado no painel)
- Justificativa: nenhum componente novo, nenhum token novo — só reflow do container e reuso do menu kebab que já existe em `SeletorImprimirPedido`.

## Causa do bug

`ProdutosClient.tsx:361` monta a linha inteira como um único flex sem quebra:

```
className="flex min-h-11 items-center gap-3 px-4 py-3"
```

Sete filhos disputam a largura, seis deles `shrink-0` de fato (thumb, 4 botões) e só o bloco de texto é `min-w-0 flex-1` (`:364`) — ou seja, ele absorve todo o déficit e é esmagado até quase zero.

Com `html { font-size: 120% }` (`globals.css:212`, base rem = 19.2px) a soma mínima em 360px de viewport é:

| Elemento | Largura mínima |
|---|---|
| `px-4` do container (2×) | ~38px |
| `ThumbProduto` (`size-10`) | 48px |
| "Ocultar" (`size="sm"`, `text-[0.8rem]`) | ~68px |
| "Marcar esgotado" | ~125px |
| Editar (`icon-sm`) | 34px |
| Remover (`icon-sm`) | 34px |
| 6 × `gap-3` | ~86px |
| **Total fixo** | **~433px** |

Sobram −73px para nome + preço + badges. Resultado: nome truncado a nada, preço colidindo com o botão "Ocultar" e o segundo ícone (Remover) cortado na borda direita. Não é caso isolado — acontece em toda linha de toda categoria.

Nota: os botões já têm `min-h-11`, então o alvo de toque está garantido; o problema de estouro é exclusivamente horizontal. **Correção da rodada 2:** `min-h-11` não é 44px nesta base — `11 × 0.25rem = 2.75rem`, e com `html { font-size: 120% }` isso vira **52,8px**. É a causa do "botão alto demais" apontado no feedback. Ver "Rodada 2" abaixo.

## Layout proposto

### Mobile (< 640px, `sm`)

```
┌────────────────────────────────────────────────┐  ← borda do Card
│ ┌────┐  Pão de queijo assado             ┌───┐ │
│ │IMG │  R$ 30,00   [ Disponível ]        │ ⋮ │ │
│ └────┘                                   └───┘ │
│         [Coloração] [Ponto do pão]             │
│         ┌───────────────┐ ┌──────────────────┐ │
│         │    Ocultar    │ │ Marcar esgotado  │ │
│         └───────────────┘ └──────────────────┘ │
├────────────────────────────────────────────────┤
│ ┌────┐  Panini de frango com catupiry    ┌───┐ │
│ │ P  │  R$ 42,90   [ Esgotado ]          │ ⋮ │ │
│ └────┘                                   └───┘ │
│ ...                                            │
└────────────────────────────────────────────────┘

  ⋮ abre:  ┌──────────────────┐
           │ ✎  Editar        │
           │ 🗑  Remover       │  ← text-destructive
           └──────────────────┘
```

### Desktop (≥ 640px) — volta à linha única, sem colisão

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ┌────┐ Pão de queijo assado  [Disponível]                                 │
│ │IMG │ R$ 30,00  [Coloração] [Ponto]   [Ocultar] [Marcar esgotado]   [⋮] │
│ └────┘                                                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

## Componentes e classes

| Região | Componente | Classe |
|---|---|---|
| Linha (wrapper) | `div` | `flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3` — `flex-wrap` + `items-start` é o coração do fix |
| Thumb | `ThumbProduto` (inalterado) | `size-10 shrink-0` (já no componente) |
| Bloco de identidade | `div` | `min-w-0 flex-1` |
| Nome | `span` | `line-clamp-2 font-medium text-foreground` — troca `truncate` por `line-clamp-2`: em 360px o nome cabe em 2 linhas em vez de sumir |
| Preço + status | `div` | `mt-0.5 flex flex-wrap items-center gap-2` |
| Preço | `span` | `shrink-0 text-sm font-medium tabular-nums text-foreground` — sobe de `text-muted-foreground` para `text-foreground` (é dado primário do lojista) e ganha `tabular-nums` |
| Badge status | `Badge` `secondary`/`outline` | inalterado (`badgeStatus()`, mantém ícone `EyeOff` em "Oculto") |
| Badges de opcionais | `ul`/`Badge secondary` | `mt-2 flex w-full flex-wrap gap-1.5 sm:w-auto` |
| Ações principais | 2 × `Button` `outline` `sm` | `min-h-11 flex-1 sm:flex-none` dentro de `order-last w-full basis-full sm:order-none sm:w-auto sm:basis-auto` |
| Mais ações | `Menu` + `MenuTrigger render={<Button variant="ghost" size="icon" />}` | `min-h-11 min-w-11 shrink-0`, `aria-label="Mais ações de {nome}"` |
| Itens do menu | `MenuItem` | Editar (`Pencil`), Remover (`Trash2 text-destructive`) |

## Notas UX / acessibilidade

1. **Ocultar / Marcar esgotado passam de `ghost` para `outline`.** Como agora ocupam a linha inteira, `ghost` viraria dois blocos de texto solto sem affordance de botão. `outline` mantém a hierarquia certa (nenhum dos dois é CTA primário do painel) e dá borda visível.
2. **Editar e Remover saem para o kebab.** Elimina os dois ícones cortados na borda e resolve o atrito de reversibilidade: "Remover" é destrutivo e não deve ficar a 34px de "Marcar esgotado" num alvo de toque apertado. O `AlertDialog` de confirmação existente (`ProdutosClient.tsx:540`) continua igual.
3. **Um layout só, dois breakpoints.** Nada de renderizar duas árvores por `useMediaQuery` — o mesmo markup com `flex-wrap` resolve os dois casos, sem hidratação divergente.
4. **Toque ≥ 44px:** os dois botões de ação mantêm `min-h-11`; o kebab passa de `icon-sm` (34px) para `icon` com `min-h-11 min-w-11`, corrigindo um alvo que já estava abaixo do mínimo AA hoje.
5. **`aria-label` preservados:** os labels dinâmicos ("Ocultar {nome} da vitrine", "Marcar {nome} como esgotado", "Editar {nome}", "Remover {nome}") continuam idênticos — `ProdutosClient.test.tsx` consulta por esses nomes acessíveis.
6. **Não depende só de cor:** badge de status continua cor + texto (+ ícone `EyeOff` em "Oculto"), conforme design-system §8.
7. **Contraste:** tudo aqui é token semântico do painel (`foreground`/`muted-foreground`/`border`), nunca o tema da loja — o risco de contraste do `tema` jsonb (design-system §4) não se aplica a esta tela.
8. **Sem scroll horizontal:** `overflow-hidden` no `CardContent` como rede de segurança; com `flex-wrap` nenhum filho força largura maior que o container.

## Rodada 2 — feedback do usuário

Três pontos levantados sobre a versão "depois" acima. O HTML agora traz **duas** respostas lado a lado (`v1` e `v2`) para comparação.

| # | Feedback | Diagnóstico | v1 | v2 |
|---|---|---|---|---|
| 1 | Botões "Ocultar" / "Marcar esgotado" altos demais | `min-h-11` = `2.75rem` = **52,8px** com a base de 120%, não 44px | `min-h-[44px]`, mantém `variant="outline"` | `min-h-[44px]` em *action row* sem contorno próprio: mesma área de toque, metade do peso visual |
| 2 | Nome do produto pequeno perto do preço e dos botões | `font-medium` (500) no tamanho base não vence o contorno dos dois botões, que dominam o card | `text-[1.05rem] font-semibold leading-snug`; preço recua para `text-[0.85rem]` | Nome em linha própria, `text-[1.12rem]`, peso 650; thumb sobe para `size-12` para equilibrar; preço sobe para `text-[0.95rem] font-semibold` |
| 3 | Kebab discreto demais | `variant="ghost"` sem superfície + glifo `⋮` fino: nenhuma affordance | `variant="outline"` 44×44, ícone `MoreVertical` de 18px | Chip circular `variant="secondary"` 44×44 (`rounded-full`), ícone de 20px — elemento mais evidente do canto direito |

**44px é piso, não meta.** Reduzir abaixo disso quebra design-system.md §6 (alvo de toque ≥ 44×44px). O ganho vem de descer 52,8 → 44 (−17%), não de ir além.

**Custo e risco.** v1 é só troca de props/classes no `ProdutosClient.tsx`, reusando `Button` do shadcn como já está — zero padrão novo. v2 reordena a árvore do item e introduz uma *action row* que hoje não existe no painel; só vale se for adotada também em `TabelaPedidos` e nas outras listas, senão vira uma terceira variante isolada (o que o gate de reuso desaconselha).

**Recomendação:** v1. Entrega os três pontos com o vocabulário que o painel já fala. v2 fica registrada como direção caso o painel adote *action row* como padrão de lista mobile.

## Fora de escopo

Nada de redesenho da tela: header do card, `GerenciarCategorias`, `FormProduto` e o `AlertDialog` de remoção ficam como estão.
