# Modal de produto — 4 layouts para diferenciar categoria de opcional

**Escopo:** vitrine pública (`/loja/[slug]`), `ProdutoModal.tsx` + `SecaoOpcionais.tsx`.
**Problema:** com 2+ grupos abertos ao mesmo tempo, não se percebe onde uma categoria termina e a outra começa. Hoje todos os grupos vivem dentro de UMA caixa `#f9f9f9` e são separados só por um filete `#eeeeee` — o mesmo filete que separa cada linha de opcional dentro do grupo. Separador de grupo e separador de item têm o mesmo peso visual: a hierarquia some.
**Restrição:** sanfona (accordion `multiple`) permanece em todas as variações.
**Estados cobertos em cada variação:** (A) quantidade = 0; (B) quantidade > 0 com opcionais escolhidos.

---

## Gate de reuso

- **shadcn/ui varridos:** `accordion`, `badge`, `button`, `card`, `separator`, `dialog`, `sheet`, `checkbox`, `radio-group`, `label`.
- **Componentes vitrine/painel:** `ProdutoModal.tsx`, `SecaoOpcionais.tsx` (+ `escolhasOpcionais.ts` já expõe `contarEscolhidosDoGrupo` e `rotuloGrupoOpcional`), `ListaOpcionaisItem.tsx`, `PrecoProduto.tsx`, `SeloDesconto.tsx`, `BadgeStatus.tsx`.
- **Tokens:** `--cor-primaria`, `--cor-fundo`, `--cor-destaque`, `--texto`, `--texto-muted`, `--marrom-cafe`, `--borda-nav`, `--cinza-claro/medio`.

**Decisão: ADAPTAR.**
**Justificativa:** o `Accordion` do shadcn e o `SecaoOpcionais` já entregam a mecânica inteira (multiple, 1º aberto, badge de contagem, `aria-label` com contagem); falta só a **camada de superfície** — cada `AccordionItem` deixa de ser irmão num filete e passa a ser um cartão com borda própria. Nenhum componente novo, nenhum token de cor novo.

---

## O kit de diferenciação (igual nas 4 variações)

O que resolve o problema não é o layout do modal — é este conjunto. As 4 variações mudam onde o kit mora, não o kit.

| # | Mecanismo | Por quê |
|---|---|---|
| D1 | **Cada grupo é um cartão**: `bg-white`, `border-[1.5px]`, `rounded-xl`, separados por `gap-2` sobre o `#f9f9f9`. Acaba o filete `#eeeeee` entre grupos. | O limite de grupo passa a ter peso maior que o filete entre itens. Hierarquia por superfície, não por linha — mesma lógica do design-system §10.2 no painel. |
| D2 | **Trilho de acento de 4px** na lateral esquerda do cartão **aberto**, em `--cor-destaque`. Fechado fica sem trilho e com borda neutra. | Aberto ≠ fechado à distância, sem depender de ler o chevron. Não é cor sozinha: o chevron gira e o corpo aparece. |
| D3 | **Cabeçalho de duas linhas**: nome da categoria + linha de regra (`Escolha 1 · obrigatório`, `Até 2 · opcional`). | Duas linhas dão massa ao cabeçalho e o separam das linhas de item, que são de uma linha só. E resolve outra dúvida do cliente ("posso escolher quantos?"). |
| D4 | **Badge com texto, não só número**: `2 escolhidos` em vez de `2`. Reusa `contarEscolhidosDoGrupo`. Hoje a badge é `aria-hidden` com a contagem no `aria-label` do trigger — mantém-se assim. | WCAG 1.4.1: número solto colorido é cor+símbolo; com texto vira informação. |
| D5 | **Cabeçalho do grupo aberto fica `sticky` no topo da área rolável** (`sticky top-0 z-10 bg-white`). | Com 3 grupos abertos e rolagem longa, sempre se sabe em qual categoria o dedo está. É o ganho maior quando vários estão abertos — exatamente o caso que hoje confunde. |
| D6 | **Alvo de toque 44px literal** nos steppers de opcional e de quantidade. | Correção de defeito existente, ver "Achados". |

Regra de cor: o trilho e a badge usam `--cor-destaque` (tema da loja). Texto sobre o destaque é branco fixo, nunca derivado do tema (design-system §4).

---

## Estado A (quantidade = 0) — comum às 4

Hoje `ProdutoModal.tsx:401` e `:487` escondem **Opcionais** e **Observações** enquanto `quantidade === 0`. O cliente abre o produto e não vê que ele é personalizável; só descobre ao tocar no `+`. Nas 4 variações o estado A mostra um **sumário inerte** no lugar do bloco escondido:

```
┌─ PERSONALIZE DEPOIS DE ESCOLHER A QUANTIDADE ─┐
│  Ponto da carne · Adicionais · Molhos · Bebida │
└────────────────────────────────────────────────┘
```

Chips não interativos (`aria-hidden` não; texto normal, sem foco), fundo neutro. Não é CTA concorrente — é promessa. O bloco some assim que `quantidade > 0` e a sanfona real entra no lugar, com o scroll automático que já existe (`ProdutoModal.tsx:137-155`).

---

## Variação 1 — Paisagem (mantém o split atual)

Estrutura inalterada: `md:flex-row`, coluna esquerda 44% (imagem `flex-1` + descrição com scroll próprio), coluna direita rolável com header em `--cor-primaria` e footer fixo.

```
┌──────────────────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░│  ███ BURGER BASE DUPLO ███████████  (✕) │     │
│░░  IMAGEM   ░│  ─────────────────────────────────────────    │
│░░  flex-1   ░│  ┌ QUANTIDADE ──────────────── [−] 2 [+] ┐    │
│░░░░░░░░░░░░░░│  └───────────────────────────────────────┘    │
│──────────────│  OPCIONAIS                     2 de 4 grupos  │
│ descrição    │  ┃┌───────────────────────────────────────┐   │
│ scroll       │  ┃│① Ponto da carne      [1 escolhido] ▲ │◄ sticky
│ próprio      │  ┃│  Escolha 1 · obrigatório             │   │
│              │  ┃├───────────────────────────────────────┤   │
│              │  ┃│  Ao ponto        + R$ 0,00   [−]1[+] │   │
│              │  ┃│  Bem passado     + R$ 0,00   [−]0[+] │   │
│              │  ┃└───────────────────────────────────────┘   │
│              │   ┌───────────────────────────────────────┐   │
│              │   │② Adicionais                        ▼ │   │
│              │   │  Até 5 · opcional                     │   │
│              │   └───────────────────────────────────────┘   │
│              │  ─────────────────────────────────────────    │
│              │  [ Adicionar ao carrinho        R$ 78,80 ]    │
│              │  [            MAIS ITENS              ]       │
└──────────────────────────────────────────────────────────────┘
```

**Componentes:** `Dialog`/`DialogContent` (`md:max-w-3xl`, §9), `Accordion multiple`, `AccordionItem` com `bg-white border-[1.5px] rounded-xl mb-2`, `Badge`, `Button`.
**Notas UX:** a coluna direita é estreita (~56% de 768px). O cartão ganha só `px-3` — o ganho de legibilidade vem do trilho e do cabeçalho de duas linhas, não de padding. Contador `2 de 4 grupos` no título "OPCIONAIS" fecha o loop de progresso sem barra de progresso.

---

## Variação 2 — Retrato (imagem em cima, conteúdo embaixo) no desktop

Troca `md:flex-row` por coluna única centrada, `md:max-w-lg`, `md:h-[min(720px,…)]`. Imagem `aspect-[16/9]` no topo do corpo rolável; o resto empilha.

```
┌──────────────────────────────┐
│ ███ BURGER BASE DUPLO ██ (✕) │
├──────────────────────────────┤
│░░░░░  IMAGEM 16/9  ░░░░░░░░░ │
│ descrição · ver mais         │
│ ┌ QUANTIDADE ── [−] 2 [+] ┐  │
│ OPCIONAIS       2 de 4 ✓     │
│ ┃┌──────────────────────────┐│
│ ┃│① Ponto da carne  1 ✓  ▲ ││ ◄ sticky
│ ┃│  Escolha 1 · obrigatório ││
│ ┃│ Ao ponto   +R$0,00 [−]1[+]│
│ ┃└──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │② Adicionais           ▼ ││
│  │  Até 5 · opcional        ││
│  └──────────────────────────┘│
│ ┌ OBSERVAÇÕES ─────────────┐ │
├──────────────────────────────┤
│ [ Adicionar        R$78,80 ] │
│ [        MAIS ITENS        ] │
└──────────────────────────────┘
```

**Notas UX:** um fluxo de leitura só, igual ao mobile — o cliente que aprendeu no celular reconhece no desktop. Custo: a imagem sai da tela ao rolar (mitigado por uma thumb 40px que aparece no header sticky ao rolar). Cartão com `px-4` folgado, porque a largura é generosa.

---

## Variação 3 — Padrão mobile (full-screen 360px)

Mantém a moldura full-bleed atual (`h-dvh w-screen rounded-none`) e o footer fixo. Só a sanfona muda.

```
┌────────────────────────┐ 360px
│███ BURGER BASE ███ (✕) │
├────────────────────────┤
│░░░ IMAGEM 4/3 ░░░░░░░░ │
│   descrição (2 linhas) │
│   ver mais             │
│ ┌ QUANTIDADE ─────────┐│
│ │ Cada · R$ 34,90     ││
│ │        [−]  2  [+]  ││ 44px
│ └─────────────────────┘│
│ OPCIONAIS      2 de 4  │
│ ┃┌────────────────────┐│
│ ┃│① PONTO DA CARNE   ▲││ ◄ sticky
│ ┃│ Escolha 1 · obrig. ││
│ ┃│ [1 escolhido]      ││
│ ┃├────────────────────┤│
│ ┃│ Ao ponto           ││
│ ┃│ + R$ 0,00 [−] 1 [+]││ 44px
│ ┃└────────────────────┘│
│  ┌────────────────────┐│
│  │② ADICIONAIS      ▼││
│  │ Até 5 · opcional   ││
│  └────────────────────┘│
│ ┌ OBSERVAÇÕES ────────┐│
├────────────────────────┤
│[Adicionar     R$78,80] │ 52px
│[     MAIS ITENS      ] │
└────────────────────────┘
```

**Notas UX:** em 360px o cabeçalho vira 3 linhas (nome / regra / badge) porque badge com texto ao lado do nome truncaria o nome. A linha de opcional empilha nome+preço à esquerda e stepper 44px à direita — cabe com folga. É a variação mais barata de implementar: só troca de classes em `SecaoOpcionais.tsx`.

---

## Variação 4 — "Trilho de categorias" (a ousada)

A sanfona continua, mas ganha um **índice**. A coluna esquerda do paisagem deixa de ser só imagem: abaixo da foto (reduzida) entra um trilho vertical de categorias com estado de preenchimento. No mobile o trilho vira uma **faixa de chips horizontal sticky** logo abaixo do header.

```
DESKTOP
┌───────────────────────────────────────────────────────────┐
│░░░ IMG ░░░░│  ███ BURGER BASE DUPLO ████████████ (✕)      │
│░░░░░░░░░░░░│  ┌ QUANTIDADE ─────────────── [−] 2 [+] ┐    │
│────────────│                                              │
│ ●─① Ponto  │  ┃┌────────────────────────────────────────┐ │
│ │  1 ✓     │  ┃│① PONTO DA CARNE     [1 escolhido]  ▲  │ │
│ ●─② Adicio.│  ┃│  Escolha 1 · obrigatório               │ │
│ │  2 ✓     │  ┃│  Ao ponto      + R$ 0,00    [−] 1 [+]  │ │
│ ○─③ Molhos │  ┃└────────────────────────────────────────┘ │
│ │  —       │   ┌────────────────────────────────────────┐ │
│ ○─④ Bebida │   │② ADICIONAIS         [2 escolhidos] ▼  │ │
│    —       │   │  Até 5 · opcional                      │ │
│            │   └────────────────────────────────────────┘ │
│ 2 de 4     │  ───────────────────────────────────────────  │
│ grupos     │  [ Adicionar ao carrinho          R$ 78,80 ]  │
└───────────────────────────────────────────────────────────┘

MOBILE — trilho vira chips sticky
│███ BURGER BASE ███ (✕)│
│ ①Ponto✓ ②Adic.2 ③Molho ④Bebida │ ◄ sticky, scroll-x
```

Tocar um item do trilho **abre aquele grupo e rola até ele** (`scrollIntoView`, mesmo mecanismo já usado em `ProdutoModal.tsx:137-155`); o item ativo no trilho acompanha o cabeçalho sticky visível. O trilho é `<nav aria-label="Categorias de opcional">` com botões — não substitui a sanfona, indexa. Grupo obrigatório ainda não preenchido fica com marcador vazado `○` + texto `falta escolher`, e o CTA do rodapé mostra `Falta: Ponto da carne` em vez de ficar só desabilitado.

**Notas UX:** é a única variação que responde "o que ainda falta?" — hoje nada responde. Custo: um `nav` novo em `SecaoOpcionais` (ou componente irmão `TrilhoOpcionais`), estado de "grupo visível" e um `IntersectionObserver`. Já existe precedente no projeto: `scrollspyCategorias.ts` faz exatamente esse scrollspy para a nav de categorias do catálogo — **reusar a lógica, não reescrever**.

---

## Achados de acessibilidade (independentes da variação escolhida)

| Impacto | Achado | Arquivo:linha | Fix |
|---|---|---|---|
| **ALTO** | Stepper de opcional tem **33,6px** de alvo (`size-7` × base 120%). Design-system §5 marca 33,6px como **proibido** em alvo de toque. | `SecaoOpcionais.tsx:159`, `:177` | `size-[44px]` literal (ou `min-h-[44px] min-w-[44px]`), com o ícone pequeno dentro. |
| **ALTO** | Stepper de quantidade tem **38,4px** (`size-8`). Mesmo defeito, no controle mais usado do modal. | `ProdutoModal.tsx:459`, `:478` | 44px literal. |
| **MÉDIO** | Opcionais e Observações ficam `hidden` com quantidade 0 — descoberta zero da personalização. | `ProdutoModal.tsx:401`, `:487` | Sumário inerte de categorias (estado A, acima). |
| **MÉDIO** | Badge de contagem é `aria-hidden` com número solto; visualmente é cor+número. | `SecaoOpcionais.tsx:86-92` | Texto junto (`2 escolhidos`) — D4. O `aria-label` do trigger já está correto. |
| **BAIXO** | Descrição no mobile é um `<p>` com `onClick` (não focável, não acionável por teclado); o "ver mais" ao lado está correto. | `ProdutoModal.tsx:375-380` | Remover o `onClick` do `<p>` ou transformar o par num único `<button>`. |
| **BAIXO** | Filete `#eeeeee` sobre `#f9f9f9` mede ~1,07:1 — não é separador perceptível para ninguém, muito menos com baixa visão. | `SecaoOpcionais.tsx:70`, `:135` | É o que D1/D2 substituem. Borda de cartão em `#d9d2c4` ou mais escura. |

---

## Recomendação

Entregar em duas camadas:

1. **Camada obrigatória (resolve o pedido em qualquer layout):** D1+D2+D3+D4+D6 aplicados em `SecaoOpcionais.tsx`. Não toca `ProdutoModal.tsx` além dos 44px. Serve paisagem e retrato sem ramificação.
2. **Camada de layout:** escolher entre V1 (menor risco, mantém tudo) e V4 (maior ganho, custo real). V2 e V3 são a mesma peça em larguras diferentes — V3 já é o comportamento atual do mobile e só herda a camada 1.

Se for uma só: **V1 + kit**. Se houver apetite para uma issue maior: **V4**, reusando `scrollspyCategorias.ts`.
