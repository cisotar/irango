# Reordenar categorias de produtos — contrato de interação (UX/a11y)

Tela: `/painel/produtos`
Fonte real: `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx`
Issue: `tasks/175-reordenar-categorias-de-produtos.md`
Preview: `mockups/reordenar-categorias-painel.html`

Este documento é **contrato de interação**, não plano de implementação. Ele existe
para que o `planejar` consiga escolher (ou dispensar) a biblioteca de arrasto com
base em requisitos, e não em preferência.

---

## Gate de reuso

- **shadcn/ui varridos:** `ui/button.tsx` (variants `outline`/`ghost`/`default`;
  sizes `sm`/`icon`/`icon-sm`), `ui/card.tsx`, `ui/badge.tsx`, `ui/menu.tsx`,
  `ui/separator.tsx`, `ui/sheet.tsx`, `ui/dialog.tsx`, `ui/switch.tsx`,
  `ui/checkbox.tsx`. **Não existe `ui/accordion.tsx`** → é o único primitivo a
  gerar (`npx shadcn@latest add accordion`, Base UI já instalado).
- **Componentes painel/vitrine:** `painel/GerenciarCategorias.tsx` (única lista
  que hoje enxerga **todas** as categorias, inclusive as vazias),
  `painel/ThumbProduto.tsx`, `painel/SeletorImprimirPedido.tsx` (kebab),
  `painel/TabelaPedidos.tsx`, `vitrine/confirmacao/StatusPedidoLive.tsx:314` e
  `vitrine/confirmacao/LinhaTempoStatus.tsx:37-39` (**precedente autoritativo de
  `aria-live`** no projeto: região viva única, `sr-only`, nunca aninhada).
- **Tokens (`@theme` de `globals.css`):** `--color-foreground`,
  `--color-muted-foreground`, `--color-muted`, `--color-border`,
  `--color-primary`, `--color-destructive`, `--color-ring`, `--radius`.
  `html { font-size: 120% }` (`globals.css:212`) — base rem = 19.2px.
- **Decisão: REUSAR + CRIAR (1 primitivo shadcn)**
- **Justificativa:** zero token novo, zero cor nova, zero componente de domínio
  novo; o único acréscimo é o `accordion` gerado pelo CLI, que o `@base-ui/react`
  já suporta sem dependência de runtime.

---

## 0. Achado bloqueante encontrado na leitura do código

**`ProdutosClient.tsx:130` esconde categorias vazias.**

```ts
const naoVazios = grupos.filter((g) => g.produtos.length > 0);
```

A tela **não renderiza** categoria sem produto. Consequências diretas para esta
feature, todas fora do que a issue já previu:

| Consequência | Efeito se ignorada |
|---|---|
| A lista arrastável não conteria todas as categorias | O lojista não consegue promover a categoria que acabou de criar (ela nasce vazia — é justamente quando ele quer posicioná-la) |
| O payload seria parcial | A normalização `0..n−1` sobre um subconjunto **reintroduz o empate** que a issue queria corrigir de graça: as vazias mantêm a `ordem` antiga e colidem com as novas |
| `categorias.length` ≠ `grupos.length` | O gate do botão (§5) e o "posição X de N" do `aria-live` mentiriam |

**Contrato:** o modo reordenar renderiza a partir da prop `categorias`
(**todas**, já ordenadas por `buscarCategorias`), **não** de `grupos`. Fora do
modo reordenar, a tela mantém exatamente o comportamento de hoje.

A categoria vazia aparece **só no modo reordenar**, com contagem `0 produtos` em
`text-muted-foreground`, e a barra de modo carrega uma linha de ajuda:

> Categorias sem produtos aparecem só aqui.

**Consequência de contrato para a action:** o cliente envia **apenas a sequência
de ids**, nunca valores de `ordem`. O tipo `Categoria` consumido pelo
`ProdutosClient` (de `FormProduto.tsx:22-27`) nem sequer tem o campo `ordem` — e
não deve ganhar. Ordem é derivada do índice, no servidor.

---

## 1. Alça dedicada ou card inteiro arrastável?

### Posição: **alça dedicada, sempre. O card inteiro é inviável nesta tela.**

Três razões, em ordem de força:

1. **O conflito com o scroll não tem solução boa.** Arrastar o card inteiro
   exige `touch-action: none` no card. Isso mata o scroll vertical iniciado em
   cima de qualquer categoria — ou seja, na área útil inteira da página. A
   mitigação clássica (`delay: 250ms` antes de ativar o arrasto) troca um bug por
   outro: 250ms de long-press em que a tela parece travada, e um toque um pouco
   demorado no header vira arrasto acidental. Com alça dedicada, o
   `touch-action: none` fica confinado a 44×44px e **o resto da página rola
   normalmente**.
2. **O gatilho já é um controle.** O header da categoria vira o
   `Accordion.Trigger` (um `<button>`). Card-inteiro-arrastável significa que o
   mesmo pixel é "expandir" no toque curto e "arrastar" no toque longo —
   ambiguidade que nenhuma affordance resolve.
3. **A altura do alvo é imprevisível.** Uma categoria expandida com 40 produtos
   vira um alvo de arrasto de vários milhares de pixels. A alça é sempre 44×44.

**Especificação da alça:** ícone `GripVertical` (lucide), 44×44px literal,
primeiro elemento da linha, `cursor-grab` / `cursor-grabbing`,
`touch-action: none` **só nela**, `aria-label="Reordenar {nome}"`.

**Impacto na escolha de biblioteca:** com alça dedicada não é preciso `delay` no
sensor de toque. Um `PointerSensor` com `activationConstraint: { distance: 8 }`
basta, e o `TouchSensor` separado (com sua janela de delay) deixa de ser
necessário. Isso reduz a superfície de configuração — e, junto com §2, chega
perto de zerar a necessidade da biblioteca.

---

## 2. Qual a alternativa ao arrasto? Ela dispensa a biblioteca?

### Posição: **sim. Botões ↑/↓ resolvem, e tornam a biblioteca de arrasto dispensável na v1.**

Isto não é uma nota de rodapé nem uma concessão de acessibilidade: é a
recomendação de escopo desta feature.

### O argumento

**(a) Os botões são obrigatórios de qualquer forma.** WCAG 2.2 SC 2.5.7 exige um
caminho sem arrasto. No celular não há teclado, então `KeyboardSensor` não conta
como alternativa para o público real desta tela. Só os botões contam. Logo:
adotar `@dnd-kit` **não substitui** os botões — **soma** a eles. A pergunta
verdadeira nunca foi "arrasto ou botões", e sim "botões, ou botões + uma segunda
maneira de fazer a mesma coisa".

**(b) O custo de toques é baixo e limitado.** O cardápio típico tem 4–12
categorias. Colapsadas, cabem todas numa tela de 360px sem scroll (§4). Mover uma
categoria da última para a primeira posição em 8 categorias = 7 toques no **mesmo
pixel**, com feedback imediato a cada um. É repetitivo, não é difícil, e é uma
operação rara. Para o caso ruim, o kebab da linha oferece **"Mover para o topo"**
e **"Mover para o fim"**, que resolvem o pior cenário em 1 toque — e cobrem o
exemplo literal do lojista ("card 1 vira 3") tão bem quanto o arrasto.

**(c) A biblioteca adiciona exatamente a superfície que este projeto não
consegue testar.** A própria issue registra o limite: vitest em
`environment: "node"`, sem jsdom, sem `@testing-library`. O caminho ↑/↓ é
**100% coberto** pelo gate do CI — função pura (cenários 1–3) + markup do modo
via `renderToStaticMarkup`. O gesto de arrasto é **0% coberto** e depende de
verificação manual em dispositivo a cada regressão. Adotar a lib é adicionar
~13–15 KB gz de código crítico de interação que nenhum check do CI protege.

**(d) O custo da lib não é o `npm install`.** É: dois pacotes (`@dnd-kit/core` +
`@dnd-kit/sortable`), configuração de sensores/colisão, `DragOverlay` em portal
(sem ele o card arrastado é clipado pelo `overflow` do `Card`/accordion),
**tradução obrigatória dos `announcements` e do `screenReaderInstructions` do
dnd-kit para pt-BR** (o default é em inglês e vazaria para o leitor de tela do
lojista), e um `useMemo`/`useId` de `SortableContext` acoplado à árvore do
accordion.

**(e) Não existe atalho nativo.** O `draggable` do HTML5 funciona no desktop e
**não funciona em toque no iOS/Android**. Descartado — não atende "vale para
desktop E mobile".

### O que se perde, dito sem maquiagem

O lojista pediu arrasto com essas palavras. Os botões entregam o **resultado**
(semântica de deslocamento, desktop e mobile, ≥44px) mas não o **gesto**. Em
listas longas o arrasto é mais rápido e mais satisfatório.

### Recomendação operacional para o `planejar`

1. **v1 = botões ↑/↓ + "Mover para o topo/fim", sem dependência nova.** Fecha a
   issue inteira, com CI verde de ponta a ponta e sem gate de aprovação de
   dependência.
2. **O contrato desta feature já é agnóstico a arrasto.** A função pura, a
   assinatura `reordenarCategorias(ids: string[])`, o estado otimista e a região
   `aria-live` são idênticos nos dois caminhos. Adotar `@dnd-kit` depois é
   **troca de camada de apresentação, com zero mudança de backend e zero
   migration**.
3. **Gatilho objetivo para reabrir a decisão** (vira issue nova, não escopo
   desta): o lojista rejeitar o caminho de botões na verificação manual, **ou**
   surgir loja com > 12 categorias.

Se o gate humano decidir pelo arrasto mesmo assim, §3 especifica o feedback
completo — o contrato cobre os dois.

---

## 3. Feedback: o que o usuário vê e o que o leitor de tela ouve

### 3.1 Região viva — uma só, fora da lista

Precedente do projeto (`LinhaTempoStatus.tsx:37-39`): **não aninhar regiões
vivas**. A região fica **fora** do `<ol>`, imóvel, e é a única do modo:

```tsx
<p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {mensagemViva}
</p>
```

Ela nunca deve viver dentro do `<li>` que se move: um live region que muda de
posição no DOM ou é remontado silencia ou duplica o anúncio.

### 3.2 Mensagens anunciadas — caminho ↑/↓ (v1)

| Evento | Anúncio (pt-BR) |
|---|---|
| Entra no modo | `Modo reordenar ativado. 6 categorias. Use os botões mover para cima e mover para baixo.` |
| Move com sucesso | `Pizzas movida para a posição 2 de 6.` |
| Topo/fim em 1 toque | `Pizzas movida para a posição 1 de 6.` (mesma frase — o resultado é o que importa) |
| Tenta passar do limite | `Pizzas já está na primeira posição.` / `...na última posição.` |
| Salvando | *(silêncio — é otimista; ver §3.4)* |
| Falha ao salvar | `Não foi possível salvar a ordem. A lista voltou à ordem anterior.` |
| Sai do modo | `Modo reordenar encerrado.` |

Regra: a mensagem sempre nomeia **a categoria** e **a posição resultante sobre o
total**. "Movido para cima" sozinho obriga o usuário a explorar a lista para
descobrir onde caiu.

### 3.3 Mensagens anunciadas — caminho arrasto (se adotado)

Os `announcements` do dnd-kit são **substituídos** por estes (o default em inglês
não pode ir para produção):

| Evento dnd-kit | Anúncio |
|---|---|
| `onDragStart` | `Arrastando Pizzas. Posição 3 de 6.` |
| `onDragOver` | `Pizzas será colocada na posição 1 de 6.` |
| `onDragEnd` | `Pizzas movida para a posição 1 de 6.` |
| `onDragCancel` | `Arrasto cancelado. Pizzas continua na posição 3 de 6.` |

E `screenReaderInstructions`: `Pressione espaço para começar a arrastar. Use as
setas para mover, espaço para soltar e Escape para cancelar.`

### 3.4 Feedback visual — caminho ↑/↓ (v1)

- **A linha movida translada**, não pisca: `transition: transform 180ms
  ease-out`. A linha que sai do lugar e a que entra deslizam em direções
  opostas. **É a animação que explica a semântica de deslocamento** — em uma
  troca de pares o vizinho saltaria a distância inteira; no deslocamento cada
  item entre a origem e o destino anda exatamente uma posição.
- **Realce de pouso:** a linha movida recebe `ring-1 ring-primary/40` por ~600ms
  e some. Serve para o olho reencontrar a linha depois do movimento.
- **Sem spinner na linha.** O update é otimista (§6). Um spinner por linha faria
  a lista tremer a cada toque.
- **Status agregado na barra de modo:** `Salvando ordem…` →
  `Ordem salva` (~2s) → vazio. `text-xs text-muted-foreground`,
  `aria-hidden="true"` (a região viva de §3.1 já cobre o leitor de tela; duplicar
  causaria anúncio duplo).
- **`prefers-reduced-motion: reduce`** → todas as transições viram `0ms` e o
  realce de pouso vira mudança de cor sem animação. Obrigação nova: o projeto
  ainda não tem esse guard.

### 3.5 Feedback visual — caminho arrasto (se adotado)

| Elemento | Estado durante o arrasto |
|---|---|
| **Item arrastado** | Renderizado em `DragOverlay` (portal — sem ele o `overflow` do `Card` clipa o card em movimento). `shadow-lg`, `scale-[1.02]`, `rotate-[0.5deg]`, `z-50`, segue o dedo/cursor. |
| **Slot de origem** | Vira **placeholder de mesma altura**: `border-2 border-dashed border-border bg-muted/40`, conteúdo em `opacity-0`. Nunca colapsar para altura zero — a lista pularia sob o dedo. |
| **Vizinhos** | Transladam `transform: translateY(±altura)` em `180ms ease-out` para abrir a vaga. **Só os itens entre a origem e o destino se movem, um passo cada** — de novo, é a animação que prova "deslocamento, não troca". |
| **Ao soltar** | O overlay anima até o slot final (`150ms`), o placeholder dissolve, e a linha recebe o mesmo realce de pouso de §3.4. |
| **Cancelar (ESC)** | O overlay volta à origem em `150ms`; nenhuma escrita. |
| **Durante o arrasto** | Todos os accordions ficam colapsados e o `Accordion.Trigger` fica inerte (`pointer-events: none` na área de texto), para a altura do alvo não mudar no meio do gesto. |

---

## 4. Layout

### 4.1 Modo normal (padrão de hoje + accordion)

Cada `<section><Card>` vira um `Accordion.Item`. O `CardHeader` atual vira o
`Accordion.Trigger`; o `CardContent` com os produtos vira o `Accordion.Panel`.
**Todos abertos por padrão** — a tela não pode mudar de comportamento para quem
nunca vai reordenar nada. `type="multiple"`.

```
 /painel/produtos                                    360px
┌──────────────────────────────────────────────────┐
│ Produtos              [Categorias] [+ Novo prod.]│
│                       [⇅ Reordenar categorias]   │  ← 2ª linha no mobile
├──────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ │
│ │ ⌄ Pizzas doces        [Opcionais]  [+]       │ │  ← Accordion.Trigger
│ ├──────────────────────────────────────────────┤ │
│ │ [img] Brigadeirão                     [ ⋮ ]  │ │
│ │       R$ 30,00  [Disponível]                 │ │  ← intocado
│ │       [ Ocultar ] [ Marcar esgotado ]        │ │
│ └──────────────────────────────────────────────┘ │
```

### 4.2 Modo reordenar — o layout que a feature entrega

```
┌──────────────────────────────────────────────────┐
│ Produtos                              [Concluir] │  ← barra de modo trocada
│ Ordene as categorias. Categorias sem produtos    │
│ aparecem só aqui.                                │
├──────────────────────────────────────────────────┤
│  ⌄ = accordion colapsado    ⠿ = alça (só se drag)│
│ ┌──────────────────────────────────────────────┐ │
│ │ ⠿  1. Pizzas doces          [ ↑ ] [ ↓ ]  ⌄  │ │  ← ↑ inerte (topo)
│ │       4 produtos                             │ │
│ ├──────────────────────────────────────────────┤ │
│ │ ⠿  2. Pizzas salgadas       [ ↑ ] [ ↓ ]  ⌄  │ │
│ │       11 produtos                            │ │
│ ├──────────────────────────────────────────────┤ │
│ │ ⠿  3. Bebidas               [ ↑ ] [ ↓ ]  ⌄  │ │
│ │       0 produtos                             │ │  ← só visível neste modo
│ ├──────────────────────────────────────────────┤ │
│ │ 🔒  Sem categoria                             │ │  ← sem alça, sem setas
│ │       Sempre por último                      │ │
│ └──────────────────────────────────────────────┘ │
│ Ordem salva                                      │
└──────────────────────────────────────────────────┘
```

- **O número da posição (`1.`, `2.`…) é visível.** Sem ele, "deslocamento" e
  "troca" ficam indistinguíveis para quem só olha o resultado.
- **`<ol>` semântico**, um `<li>` por categoria, `key` = `categoria.id`
  (obrigatório: `key` por índice quebraria a animação e o foco).
- **Alvos:** `min-h-[44px] min-w-[44px]` **literais**, com o mesmo comentário do
  fix de `chore/higiene-pos-159` — `min-h-11` daria 52,8px na base de 120%.
  `size="icon-sm"` do shadcn é `size-7` = **33,6px** nesta base e **não pode ser
  usado aqui**.
- **`gap-2` entre ↑ e ↓** (8px). Dois alvos de 44px encostados convidam ao
  toque errado.
- Largura em 360px: `px-4`(38) + alça(44) + `↑`(44) + `↓`(44) + `⌄`(44) +
  3×`gap-2`(24) = 238px fixos → sobram ~122px para nome + contagem, com
  `line-clamp-1` no nome. Sem a alça (v1 sem arrasto): ~166px. Cabe.

### 4.3 "Sem categoria"

Grupo sintético (`ProdutosClient.tsx:107-125`). **Aparece no modo reordenar,
fixo no fim, sem alça e sem setas**, com `Lock` (lucide) e o texto
`Sempre por último`.

Por que não simplesmente escondê-lo: um bloco sumir ao entrar no modo desorienta,
e a regra "não é uma categoria de verdade" precisa ser **ensinada**, não
escondida. E vale a regra de a11y: **nunca renderizar um controle que não faz
nada** — por isso ele não recebe setas desabilitadas, recebe **nenhuma seta**.
Nunca entra no payload.

---

## 5. Entrada, saída e estado vazio

### Como o modo entra e sai

**Posição: não é um toggle no mesmo botão. É uma troca de barra de ações.**

| | Modo normal | Modo reordenar |
|---|---|---|
| Barra de ações | `[Categorias]` `[+ Novo produto]` `[⇅ Reordenar categorias]` | `[Concluir]` (único, `variant="default"`) |
| Accordions | todos abertos | todos colapsados **ao entrar** |
| Ações de produto | normais | **não renderizadas** (o painel do accordion está fechado) |

- **Entrar:** `[⇅ Reordenar categorias]`, `variant="outline"`, ícone
  `ArrowUpDown`. Ao ativar: colapsa todos, troca a barra, foca o primeiro
  controle de mover, dispara o anúncio de §3.2.
- **Sair:** `[Concluir]`, `variant="default"`. **Sem diálogo de confirmação e
  sem risco de perda** — cada movimento já foi persistido (§6). "Concluir" só
  restaura a tela; não é "salvar".
- **ESC também sai** do modo (mesma expectativa de qualquer modo em overlay).
- **Botão "+ Novo produto": desaparece, não fica desabilitado.** Botão
  desabilitado sai da ordem de tabulação e não explica por que está inerte —
  regressão de a11y. Trocar a barra inteira é o padrão de "modo contextual" (o
  mesmo de seleção múltipla em apps móveis) e comunica o modo por si só.
- **Expandir durante o modo é permitido.** O usuário pediu que o botão colapse
  tudo — e ele colapsa. Reabrir uma categoria para conferir o conteúdo não deve
  ser proibido: com ↑/↓ a operação é por índice e é imune à altura da linha. *(Se
  o arrasto for adotado depois, o gesto força o colapso apenas enquanto dura —
  §3.5.)*

### Estado vazio — o botão deve aparecer?

O gate é sobre **`categorias.length`** (todas), nunca sobre `grupos.length`
(§0).

| Situação | Botão "Reordenar categorias" | Razão |
|---|---|---|
| 0 categorias | **não renderiza** | Nada a ordenar. O empty state de produtos já cobre a tela. |
| 1 categoria | **não renderiza** | Uma lista de 1 item não tem ordem. Um botão desabilitado aqui só produziria a pergunta "por que não funciona?" sem resposta na tela. |
| ≥ 2 categorias | **renderiza** | — |
| ≥ 2 categorias, 0 produtos | **renderiza** | Ordenar antes de cadastrar é legítimo, e é exatamente o momento em que o lojista está montando o cardápio. |
| Só "Sem categoria" (produtos soltos, 0 categorias) | **não renderiza** | O grupo sintético não é ordenável. |

Quando o botão não aparece, **nada** é dito na tela. Ausência de controle para
uma operação impossível não precisa de explicação; um aviso ali seria ruído.

---

## 6. Persistência, otimismo e coalescência

- **Otimista.** O estado local reordena **antes** da action. A `ordem` de
  referência para reverter é a **última confirmada pelo servidor**, não a do
  passo anterior — senão uma sequência de 4 toques com falha no 4º voltaria só um
  passo e deixaria a lista num estado que nunca existiu no banco.
- **Coalescência obrigatória.** Toques rápidos em ↑/↓ **não** podem virar N
  chamadas. Debounce de ~500ms; a chamada envia sempre a **sequência completa e
  atual de ids**, nunca um delta. Cinco toques = uma escrita. Isso é o que
  cumpre, no caminho de botões, o "uma única ida ao banco" que a issue exige do
  caminho de arrasto.
- **No-op não escreve.** Soltar/mover para a própria posição não dispara action
  (cenário 3 da issue).
- **Falha:** `toast.error` (sonner, precedente da tela) + reversão visual + o
  anúncio de §3.2. Mensagem genérica ao lojista, detalhe no log do servidor.
- **Sucesso:** **sem toast por movimento.** Um toast a cada seta seria uma
  chuva de notificações. O feedback é o status agregado de §3.4 (`Ordem salva`)
  + a região viva.
- **Vitrine:** `buscarCategorias` já ordena por `ordem`; a mudança propaga sem
  query nova. O critério de aceite "a vitrine mostra a mesma ordem" é
  verificação, não código.

---

## 7. Checklist de a11y (critério de aceite desta tela)

- [ ] `<ol>`/`<li>`, `key` = `categoria.id`. Posição numérica visível.
- [ ] Toque **44px literal** em alça, ↑, ↓ e trigger do accordion.
      `size="icon-sm"` = 33,6px nesta base → **proibido** aqui.
- [ ] `aria-label` estável e único: `Mover {nome} para cima` /
      `Mover {nome} para baixo` / `Reordenar {nome}`. **A posição não entra no
      label** — mudaria a cada render e provocaria re-anúncio.
- [ ] **Limites usam `aria-disabled="true"` + `onClick` no-op, não `disabled`.**
      O `disabled` real remove o botão do foco: ao mover um item para o topo, o
      foco estaria no `↑` que acaba de desabilitar e **se perderia para o
      `<body>`**. Este é o bug de teclado/leitor de tela nº 1 deste padrão.
- [ ] **Foco preservado entre movimentos:** depois de mover, o foco volta ao
      **mesmo botão da mesma categoria**, na nova posição. Exige `ref` por id +
      refoco no efeito pós-reordenação.
- [ ] Região viva única, `role="status" aria-live="polite" aria-atomic="true"`,
      `sr-only`, **fora** da lista.
- [ ] `focus-visible:ring-2` em todo controle novo (default do shadcn — não
      sobrescrever).
- [ ] Não depender só de cor: o placeholder de arrasto usa **borda tracejada**
      além do tom; o estado do modo é dito por **texto** na barra.
- [ ] `prefers-reduced-motion: reduce` zera transições e o realce de pouso.
- [ ] Se `@dnd-kit` for adotado: `announcements` e `screenReaderInstructions`
      **em pt-BR**, obrigatoriamente.

---

## 8. Fora de escopo (não fazer nesta issue)

- **Reordenar produtos dentro da categoria.** Não foi pedido. O contrato aqui é
  reusável para isso depois, e é o que justifica extrair a função pura.
- **Mexer em `GerenciarCategorias`.** Ele continua criando/renomeando/removendo.
  *Risco conhecido a registrar:* passam a existir duas telas que listam
  categorias, e o lojista que renomeia no Sheet pode esperar reordenar ali. Vale
  uma linha no Sheet apontando para `/painel/produtos` — **em issue própria**.
- **Terceira variante de ordem.** `OpcionaisClient.tsx:469` e `:590` expõem
  `ordem` como **campo numérico digitado à mão** — um terceiro padrão de
  reordenação no mesmo painel. Não expandir; **consolidar depois** neste
  contrato, em issue própria.
- **Corrigir `atualizarCategoria`/`removerCategoria`.** Já registrado na issue
  como pré-existente e fora do PR.
