# Sidebar do painel — contrato de interação (UX/a11y)

Tela: shell de `/painel/*` (e, por paridade, `/admin/assinantes/[lojaId]/*`)
Fonte real: `src/components/painel/NavPainel.tsx`
Consumidores: `src/app/(painel)/painel/layout.tsx:83-89`, `src/app/admin/assinantes/[lojaId]/layout.tsx:45-47`
Preview: `mockups/sidebar-painel.html`

Documento de **contrato de interação**, não plano de implementação. Pedido
exploratório: não há issue aberta em `tasks/` motivando isto.

---

## Gate de reuso

- **shadcn/ui varridos:** `ui/accordion.tsx` (existe — gerado na issue 175),
  `ui/badge.tsx` (variants `default`/`secondary`/`outline`/`ghost`/`destructive`),
  `ui/button.tsx`, `ui/menu.tsx`, `ui/separator.tsx`, `ui/sheet.tsx`,
  `ui/card.tsx`, `ui/dialog.tsx`.
- **Componentes vitrine/painel:** `painel/NavPainel.tsx` (alvo),
  `vitrine/BadgeStatus.tsx` (**único componente que cruza os dois mundos**,
  design-system §7 — já resolve Aberto/Fechado com cor **+** texto),
  `painel/StatusAssinatura.tsx` (`CardStatusAssinatura`),
  `painel/AvisoEstadoBloqueado.tsx`, `painel/rotulosAssinatura.ts`.
- **Tokens (`@theme` de `globals.css`):** `--color-sidebar`,
  `--color-sidebar-foreground`, `--color-sidebar-primary`,
  `--color-sidebar-primary-foreground`, `--color-sidebar-accent`,
  `--color-sidebar-accent-foreground`, `--color-sidebar-border`,
  `--color-sidebar-ring`, `--color-muted-foreground`, `--color-destructive`,
  `--radius`. `html { font-size: 120% }` (`globals.css:212`) → base rem = 19.2px.
- **Telas varridas:** os dois únicos consumidores do shell (acima). Não há
  segunda variante de sidebar no repo — não há o que consolidar.

**Decisão: REUSAR + ADAPTAR.**
**Justificativa:** a família `--sidebar-*` já existe no `@theme` e hoje está
**inteiramente ociosa** — `NavPainel.tsx` pinta com `bg-card`/`bg-accent`/`muted`.
Zero token novo, zero cor nova, zero primitivo novo; a proposta reestrutura um
arquivo e passa a consumir tokens que já foram declarados para esta finalidade.

---

## 0. Guard de tema — o painel não é da loja

A sidebar **não** consome `lojas.tema`. `primaria` é escolhida pelo lojista e
pode ser amarela; sobre `--sidebar` (`oklch(0.985 0 0)`) o item ativo cairia
bem abaixo de 4.5:1. O único lugar onde a marca da loja entra no shell é o
**logo** (imagem) e o **nome** (texto), nunca a cor de um estado de navegação.
Estado de navegação usa `--sidebar-primary` (token de sistema), pela mesma
razão que `BadgeStatus` tem cor fixa (design-system §8).

---

## 1. Atritos encontrados no código atual

Ordenados por impacto. `arquivo:linha` aponta o código de hoje.

| # | Impacto | Atrito | Fix proposto |
|---|---|---|---|
| F1 | **ALTO** | `NavPainel.tsx:219` — o topo é o literal `"iRango"`. Produto multitenant sem identidade do tenant no shell: nada na tela diz **qual loja** está sendo gerenciada. No hub admin isso é pior: o operador gerencia lojas de terceiros e só tem `contexto.titulo`. | Cabeçalho com logo + nome da loja + link "Ver vitrine". `titulo` vira fallback. |
| F2 | **ALTO** | Aberto/Fechado — a informação operacional mais cara do lojista — não existe no shell; só aparece dentro do dashboard. Quem está em `/painel/produtos` não sabe se a loja está vendendo. | `BadgeStatus` no cabeçalho da sidebar, presente em toda rota. Reuso direto, sem componente novo. |
| F3 | **ALTO** | `NavPainel.tsx:158-170` — subitens sempre renderizados. São **12 links simultâneos** (5 pais + 6 de Configurações + 1 de Produtos). A navegação diária (Pedidos) divide peso visual com `Tema` e `Assinatura`, visitadas uma vez por mês. Agrava: "Configurações" é hoje um `<Link href="/painel/configuracoes">`, e não existe `page.tsx` nessa rota (só nas sub-rotas) — clicar no pai dá **404**. | `ui/accordion.tsx` com `openMultiple={false}`; o grupo abre sozinho quando a rota ativa está dentro dele (`defaultValue` calculado do `pathname`, server-safe). O pai de grupo com subitens vira `AccordionTrigger` (`<button>`), não mais `<Link>` — resolve o 404 de graça, porque deixa de navegar. |
| F4 | **ALTO** (a11y) | `NavPainel.tsx:115` — `px-3 py-2 text-sm` dá **43.2px** de altura (24px de `line-height` + 2 × 9.6px). Abaixo do mínimo de 44px, e é o alvo principal do Sheet mobile. | `py-2.5` → 12 + 24 + 12 = **48px**. Subitem idem — ganha ícone próprio de 14px (antes só tinha texto), sem mudar a altura do alvo. |
| F5 | **MÉDIO** (a11y) | `NavPainel.tsx:114-118` — nenhum `focus-visible`. O item de menu só tem o outline default do browser, que praticamente some sobre `bg-card` branco. Navegação por teclado fica cega. | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2`. |
| F6 | **MÉDIO** | `NavPainel.tsx:117` — ativo é `bg-accent` (`oklch(0.97 0 0)`) e hover é `hover:bg-muted` (`oklch(0.97 0 0)`). **São o mesmo valor.** Com o mouse parado sobre qualquer item, ativo e hover ficam indistinguíveis; só `aria-current` separa, e isso é invisível. | Ativo: `bg-sidebar-accent text-sidebar-accent-foreground font-semibold` + barra. Hover: `hover:bg-sidebar-accent/50`. Dois degraus distintos. |
| F7 | **MÉDIO** | `NavPainel.tsx:117` — `border-l-2` entra só no estado ativo, sem compensação de padding: o rótulo **pula 2px** a cada navegação. | Barra como `::before` posicionada (`absolute inset-y-1 left-0 w-0.5`), fora do fluxo. Zero deslocamento. |
| F8 | **MÉDIO** (a11y) | `NavPainel.tsx:139` — `<nav>` sem `aria-label`, e existem **dois** (desktop + Sheet). Leitor de tela anuncia "navigation" duas vezes, sem diferenciar. | `aria-label="Menu do painel"` no desktop e no Sheet; o Sheet só monta quando aberto, então não há duplicidade real de landmark. |
| F9 | **MÉDIO** | Pedido novo não tem sinal no shell. O lojista precisa **abrir** `/painel/pedidos` para descobrir que existe pedido pendente. | Contador em `Badge` ao lado de "Pedidos", com o número **também** no nome acessível (`aria-label="Pedidos, 3 pendentes"`) — nunca só cor/ponto (design-system §5). `aria-live="polite"` quando o valor muda. |
| F10 | **BAIXO** | `NavPainel.tsx:196-206` — "Sair" encerra a sessão em um clique, com o mesmo peso visual dos links de navegação, e não diz **qual conta** está logada. | Rodapé com e-mail da conta (truncado) + "Sair" como `variant="ghost"` com `text-muted-foreground`; confirmação **não** é necessária (ação reversível: basta logar de novo), mas o e-mail resolve o "de quem é esta sessão". |
| F11 | **BAIXO** | `NavPainel.tsx:235` — `w-60` fixa. Entre 1024px e 1280px ela come 240px de uma tela que precisa de largura para tabela densa (`TabelaPedidos`, `TabelaProdutos`). | Modo recolhido `w-16` (ícone + `aria-label`), alternado por botão e persistido em `localStorage`. **Opcional / fase 2** — não bloqueia o resto. |
| F12 | **BAIXO** | `NavPainel.tsx:275` — a topbar mobile repete o título e nunca diz a página atual. Ao voltar de `/painel/pedidos/[id]`, o contexto some. | Topbar mobile: `hamburger · nome da loja · BadgeStatus`. O título da página fica no `<h1>` da própria página, onde já deve estar. |

---

## 2. Anatomia proposta

```
┌──────────────────────────────┐  w-60 (desktop, lg:) / w-72 (Sheet mobile)
│  ┌──┐                        │
│  │LG│  Lanches do Bairro   ↗ │  ← F1  logo 32px + nome (truncate) + "Ver vitrine"
│  └──┘  ● Aberto agora        │  ← F2  BadgeStatus (cor + texto)
├──────────────────────────────┤  Separator
│                              │
│  ▌ ▣  Dashboard              │  ← F6/F7 ativo: barra ::before + bg-sidebar-accent
│    ☰  Pedidos            (3) │  ← F9  Badge com contagem, também no aria-label
│    ▢  Produtos            ˅  │  ← F3  accordion fechado
│    ◻  Cupons                 │
│    ⚙  Configurações       ˄  │  ← F3  botão (não link) — aberto porque a rota ativa está dentro
│         ◔ Perfil             │
│         ◷ Horários           │      48px de alvo cada (F4), ícone 14px em todos (F3)
│         ▤ Entregas           │
│         ▭ Pagamentos         │
│         ◐ Tema               │
│         ✓ Assinatura         │
│                              │
├──────────────────────────────┤  Separator
│  Plano Pro · renova em 12d   │  ← reuso de rotulosAssinatura.ts
│  maria@lanchesdobairro.com   │  ← F10
│  ⏻  Sair                     │
└──────────────────────────────┘
```

Ordem dos itens **não muda** (`construirItens`, `NavPainel.tsx:56-85`). Ordem de
menu é memória muscular; mexer nela sem motivo custa mais do que rende.

---

## 3. Contrato de estado

| Estado | Regra |
|---|---|
| Ativo | `estaAtivo` como já está (`NavPainel.tsx:91-94`): raiz por igualdade exata, resto por prefixo. Pai com subitem ativo continua sem destaque próprio. |
| Grupo aberto | Abre quando a rota ativa está dentro. Fechar manualmente é permitido; **não persiste** entre navegações — a rota sempre reabre o grupo dela. |
| Recolhido (F11) | `localStorage`, só desktop. No recolhido, grupo com subitens vira `ui/menu.tsx` em flyout; o Sheet mobile **nunca** recolhe. |
| Contador (F9) | Número do servidor. Zero pedidos → **sem** badge (não renderiza "0"). `>99` → "99+", com o número real no `aria-label`. |
| Fechada | `BadgeStatus` fechado exibe o horário de reabertura, como na vitrine. Não bloqueia navegação. |

## 4. Acessibilidade — checagem

- Alvo ≥44px: item 48px, subitem 48px, hamburger já 44px (`size-11`, `NavPainel.tsx:255`). ✔ (F4)
- `focus-visible:ring-2` em todo interativo, incluindo o trigger do accordion. ✔ (F5)
- `aria-current="page"` no item ativo — já existe (`NavPainel.tsx:112`), manter. ✔
- Trigger do accordion: `aria-expanded` + `aria-controls` vêm do Base UI. ✔
- Sheet: `role="dialog"`, foco preso, ESC fecha — vêm do `ui/sheet.tsx`. ✔
- Estado nunca só por cor: Aberto/Fechado tem texto; contador tem número no
  nome acessível; item ativo tem `aria-current` **e** peso de fonte **e** barra. ✔
- Ícone sem texto (só no modo recolhido, F11): `aria-label` obrigatório. ✔
- Contraste: tudo em `--sidebar-*`, que é a escala neutra do sistema — não
  depende de `lojas.tema` (§0). ✔

## 5. Fora de escopo

Renomear rotas, mexer na ordem do menu, tema escuro do painel, busca global
(`⌘K`) e notificações. Nada disso foi pedido e nada disso é atrito medido.
