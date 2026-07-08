# [132] `SeletorImprimirPedido` (Client Component) + `npx shadcn add dropdown-menu`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [130]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Componente cliente que dispara a impressão. Recebe a lista de variantes **já decidida no
servidor**, escreve a variante ativa em `data-print-variant` e chama `window.print()`
(RN-P3). Nenhuma decisão de entitlement acontece aqui.

## ⚠️ Correção (revisão de design) — primitivo é `@base-ui/react`, NÃO Radix
O projeto usa **`@base-ui/react` (^1.5.0, estilo `base-nova`)** — `dialog.tsx`/`sheet.tsx`
importam `@base-ui/react/dialog`. **NÃO rodar `npx shadcn add dropdown-menu`** (puxaria
Radix = 2ª lib de primitivos, dois motores de foco/portal/ESC, a11y inconsistente +
bundle). Gerar `src/components/ui/menu.tsx` importando `Menu as MenuPrimitive from
"@base-ui/react/menu"`, espelhando o padrão de `dialog.tsx`.

## Escopo
- [ ] Novo `src/components/ui/menu.tsx` — wrapper de `@base-ui/react/menu` (Root/Trigger/
  Portal/Positioner/Popup/Item), espelhando `dialog.tsx`/`sheet.tsx`. **NÃO** Radix.
- [ ] Novo `src/components/painel/SeletorImprimirPedido.tsx` (`'use client'`):
  - Prop `variantes: VarianteImpressao[]` (de 130) — a lista habilitada, decidida no servidor.
  - `Menu` (base-ui) com trigger `Button variant="outline"` + ícone `Printer`
    (lucide-react) + label textual "Imprimir"; um item por variante, com rótulo fixo
    ("Comum (A4)", "Via da cozinha", "Recibo do cliente") + ícone lucide por item
    (`FileText`/`ChefHat`/`Receipt`, `aria-hidden`). Alvo de toque: itens `min-h-11` (44px).
  - Ao selecionar: `document.documentElement.dataset.printVariant = variante` → `window.print()`;
    limpar o atributo no evento `afterprint` (RN-P3, item 4).
  - Se `variantes.length === 1`: degrada para um `Button` simples (sem menu).
  - Marcar `no-print`. Sem I/O, sem estado persistente.
- [ ] **RN-P5:** proibido `window.print()` em `useEffect`/no mount — só no gesto do lojista.

## Fora de escopo
- Regras `@media print` (issue 138 — reagem ao `data-print-variant`).
- Integração no `DetalhePedido` e gate por entitlement (issue 135).

## Reuso esperado
- `Button` (shadcn) + `DropdownMenu` (a gerar) + `Printer` (lucide-react).
- Tipo `VarianteImpressao` de `variantesHabilitadas.ts` (130) — não redefinir o union.

## Segurança
- Não decide permissão: só renderiza os itens que o servidor mandou (135 gera a prop).
  Mesmo que ignorasse a prop, o bloco DOM da variante não-habilitada não existe (135) →
  sem vazamento. Por isso NÃO-crítica.
- `data-print-variant` vem de union fixo (`"a4"|"cozinha"|"recibo"`), nunca de dado do
  usuário — sem superfície XSS.

## Critério de aceite
- [ ] Menu lista exatamente as `variantes` recebidas; 1 variante → botão simples.
- [ ] Selecionar seta `document.documentElement.dataset.printVariant` e chama `window.print()`.
- [ ] `afterprint` limpa o atributo.
- [ ] (RN-P5) Nenhuma chamada a `window.print()` fora do handler de clique (teste/inspeção).
- [ ] Componente marcado `no-print`; `next build` passa.
