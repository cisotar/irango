# [216] Sanfona de itens no cartão de opcionais: ver, criar, editar, remover e reordenar

**crítica:** NÃO — reusa Server Actions já validadas. Mas leva `auditar`: a superfície é nova e escreve **preço**.
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md`.
**depende de:** 214 (cartão extraído) e 215 (RPC de ordem dos itens).

## Problema

O cartão de associação mostra quais grupos de opcional entram em cada categoria de produto e
em que ordem, mas não mostra **o que tem dentro de cada grupo**. Para editar um item, o
lojista precisa sair para a aba "Biblioteca", achar o grupo, achar o item e voltar — e a
ordem do item só se define digitando um número.

## Escopo

Entregar os itens 3 e 4 do pedido do usuário **dentro de `/painel/produtos/opcionais`**, que
já renderiza o cartão hoje. A troca de container é da 217, de propósito: feature nova e
container novo não falham no mesmo diff.

Cada grupo marcado, ao abrir a sanfona, lista seus opcionais com:

- nome e preço **editáveis inline**;
- botão de adicionar opcional ao grupo;
- remoção com **aviso de alcance** e confirmação **inline na própria linha** — a linha vira
  "Remover 'Catupiry'? Ele sai de 3 categorias de produto. [Cancelar] [Remover]". Nada de
  `AlertDialog`: na 217 esse cartão passa a viver dentro de um modal, e confirmação em modal
  aninhado é armadilha de foco e de `Escape`;
- reordenação por **setas ↑↓ e teclado, sem alça de arrasto**.

**Por que sem arrasto:** os grupos já são arrastáveis, então uma lista arrastável dentro deles
seria `DndContext` dentro de `DndContext`, com o `pointerdown` da alça interna borbulhando
para o sensor externo. E há um buraco de verificação real: sem Playwright e sem MCP de browser
nesta máquina (issue 176), **nenhum agente consegue testar gesto de toque**. Setas e teclado
são testáveis em Vitest; arrasto aninhado não seria.

Isso exige a prop nova **`semArrasto`** no `ModoReordenar` (~10 linhas): a prop existente
`arrastoBloqueado` deixa alça **e** setas inertes, que não é o que se quer aqui. E a casca
`ReordenarItensDoGrupo.tsx`, espelhando `ReordenarOpcionaisDaCategoria.tsx` (115 linhas).

**Alcance da edição (decisão do usuário):** editar nome/preço ou remover vale para **todo
lugar que usa o grupo** — a biblioteca é da loja, e não existe "Coca só de Pães". A UI diz
isso no momento da ação, não em texto de ajuda.

### Desempate na leitura — pré-requisito, não enfeite

Achado pelo `arquitetar` na 215 e conferido no código: `buscarOpcionaisDoLojista`
(`src/lib/supabase/queries/opcionais.ts:52`) ordena **só por `ordem`, sem desempate**, e
`opcionais.ordem` é `int not null default 0` (`supabase/migrations/20260614007500_opcionais.sql:49`)
— ou seja, todas as linhas existentes hoje têm `ordem = 0`. O `sort` de itens em
`src/lib/supabase/queries/produtos.ts:260` tem o mesmo buraco, enquanto o dos grupos não.

Sem um segundo critério estável o Postgres pode devolver ordens diferentes entre requisições:
o SSR e o cliente divergem, e **o primeiro arrasto grava uma permutação que o lojista não
pediu** — exatamente o risco que `buscarAssociacoesOpcional` (`:62-67`, logo abaixo) já
documenta e resolve para os grupos, com desempate por `categoria_opcional_id`.

Acrescentar o mesmo desempate nas duas leituras **antes** de ligar a reordenação de itens.
É pré-requisito da RPC da 215 funcionar como o lojista espera, não polimento.

## Fora de escopo

O modal e a troca de container (217). Preço ou ordem por produto — o usuário rejeitou.
Criar ou remover **grupos** de dentro da sanfona: isso segue na aba Biblioteca.

## Critério de aceite

- [ ] abrir um grupo marcado lista seus opcionais na ordem gravada, inativos incluídos;
- [ ] criar, editar (nome e preço) e remover item funcionam sem recarregar a página;
- [ ] remoção pede confirmação **inline** e mostra em quantas categorias de produto o item
      deixa de aparecer;
- [ ] reordenar item por setas e por teclado grava via a RPC da 215;
- [ ] prop `semArrasto` no `ModoReordenar` sem regressão nos usos existentes
      (`ReordenarCategorias`, `ReordenarOpcionaisDaCategoria`);
- [ ] acessibilidade: alvos de 44px, foco visível, anúncio em região viva em pt-BR, WCAG AA;
- [ ] testes cobrindo criar/editar/remover/reordenar e o aviso de alcance;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.

---

## Desenho

> Produzido pelo agente `desenhar` em 2026-09-18, antes do `planejar`.
> Preview standalone: `mockups/sanfona-itens-opcionais.html`.

### Gate de reuso

- **shadcn/ui varridos:** `accordion`, `badge`, `button`, `card`, `checkbox`, `dialog`,
  `input`, `label`, `menu`, `separator`, `sheet`, `switch`, `textarea`.
- **Componentes painel/vitrine:** `CartaoAssociacaoOpcionais`, `ModoReordenar`,
  `LinhaCategoriaReordenavel`, `ReordenarOpcionaisDaCategoria`, `GerenciarCategorias`
  (edição inline `editandoId` + Salvar/Cancelar, `:185-216`), `OpcionaisClient`
  (linha de item da Biblioteca com `Badge` "Inativo", `:596-660`), `FormProduto`
  (campo de preço em reais com vírgula, `:191-196`), `SeletorImprimirPedido`.
- **Tokens:** `bg-card`, `bg-muted/60`, `bg-background`, `text-foreground`,
  `text-muted-foreground`, `text-destructive`, `border-border`,
  `divide-foreground/10`, `focus-visible:ring-3 focus-visible:ring-ring/50`,
  `min-h-[44px] min-w-[44px]` (literal — base 120%), `hidden sm:inline-flex`.
- **Decisão: ADAPTAR** (+ 1 CRIAR contido).
- **Justificativa:** a linha, o miolo de reordenação, a edição inline, o badge "Inativo"
  e o campo de preço já existem no painel; o único desenho sem precedente é a
  **confirmação inline na própria linha**, e ela nasce como estado da linha que já existe,
  não como componente novo.

### 1. Anatomia e hierarquia

Quatro níveis, e a régua é: **cada nível ganha no máximo 1 grau de recuo visual**.
No modal tela cheia da 217 são 4 aninhamentos; recuar 16px em cada um comeria 64px
dos 360px.

```
Modal (217) / página (216)
└─ Cartão = categoria de PRODUTO ............. Accordion (já existe)
   └─ Linha de GRUPO ......................... ModoReordenar + alça (já existe)
      └─ Painel do grupo ..................... NOVO — disclosure, 1 grau de recuo
         └─ Linha de ITEM .................... ModoReordenar com `semArrasto`
```

O painel do grupo **não recua por margem**: usa `border-l-2 border-border` + `pl-3`
+ `bg-muted/40`. Custo total de recuo: ~20px, contra ~64px do aninhamento ingênuo.

**O gatilho do disclosure é o bloco do nome do grupo**, não um botão novo:
`<button aria-expanded aria-controls>` com chevron rotativo em volta de "Bordas · 4 itens".
Motivo: a linha do grupo em 360px já está no teto de largura (checkbox + alça + nº +
↑ + ↓ + kebab). Um 5º alvo de 44px estouraria; o nome é o elemento mais largo da
linha e vira o maior alvo de toque da tela de graça.

**Só um grupo aberto por cartão.** Cinco grupos abertos × 6 itens tornam o modal da
217 um rolo infinito, e o pedido original já dizia "fechadas por padrão".

#### 1.1 Desktop (≥ `sm`) — grupo "Bordas" aberto

```
┌─ Pizzas ───────────────────────────────────── [ 3 incluídos ] ─┐
│                                                                 │
│  ☑  ⠿  1.  › Massas            3 itens          [↑] [↓] [⋮]    │
│  ☑  ⠿  2.  ⌄ Bordas            4 itens          [↑] [↓] [⋮]    │
│  │                                                              │
│  │ ┌───────────────────────────────────────────────────────┐   │
│  │ │ Itens da biblioteca da loja. Editar ou remover vale    │   │  ← só se alcance ≥ 2
│  │ │ para as 3 categorias de produto que usam Bordas.       │   │
│  │ ├───────────────────────────────────────────────────────┤   │
│  │ │ 1.  [ Catupiry              +R$ 4,00 ]  [↑][↓][⋮]     │   │  ← nome+preço = 1 botão
│  │ │ 2.  [ Cheddar               +R$ 4,00 ]  [↑][↓][⋮]     │   │     ("Editar Cheddar")
│  │ │ 3.  [ Requeijão  Inativo    +R$ 3,50 ]  [↑][↓][⋮]     │   │
│  │ │ 4.  [ Chocolate             +R$ 6,00 ]  [↑][↓][⋮]     │   │
│  │ ├───────────────────────────────────────────────────────┤   │
│  │ │ [ + Adicionar opcional ]                               │   │
│  │ └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  ☑  ⠿  3.  › Extras            6 itens          [↑] [↓] [⋮]    │
│  ─────────────────────────────────────────────────────────────  │
│  › Disponíveis (4)     o cliente não vê estes                   │
│                                                    Salvo ✓      │
└─────────────────────────────────────────────────────────────────┘
```

#### 1.2 360px — mobile e modal tela cheia da 217

`compacta` já vale na linha do grupo (tem `prefixo`); vale também na linha do item,
porque a régua é a mesma: abaixo de `sm` as setas ↑↓ somem e viram itens do kebab.

```
┌──────────────────────────────────┐ 360px
│ ✕   Opcionais de Pizzas          │  ← header do modal (217), sticky
├──────────────────────────────────┤
│ ☑ ⠿ 2. ⌄ Bordas            [⋮]   │
│        4 itens                   │
│ │┌───────────────────────────────┤
│ ││ Editar ou remover vale para   │
│ ││ as 3 categorias que usam      │
│ ││ Bordas.                       │
│ │├───────────────────────────────┤
│ ││ 1. [ Catupiry ]         [⋮]   │
│ ││    +R$ 4,00                   │
│ ││ 2. [ Requeijão ]        [⋮]   │
│ ││    Inativo · +R$ 3,50         │
│ │├───────────────────────────────┤
│ ││ [ + Adicionar opcional ]      │
│ │└───────────────────────────────┤
└──────────────────────────────────┘
```

**Orçamento de largura em 360px, linha de item, `compacta`:** padding do painel (16)
+ borda-l (2) + `pl-3` (12) + nº (24) + gap (8) + kebab (44) + padding da linha (16)
= **~122px de chrome → ~238px para o nome**. Com as setas visíveis seriam ~134px, que
é onde "Requeijão light" vira "Requeij…". Por isso as setas só aparecem a partir de `sm`.

### 2. Estados da linha de item

Máquina de 3 estados + 2 sub-estados. **No máximo UMA linha fora de `leitura` por
cartão** — duas confirmações abertas dão duas perguntas e um só `Escape`, que é ambíguo.

| Estado | Como entra | Como sai | Conteúdo da linha |
|---|---|---|---|
| `leitura` | default | — | `nº` · botão `[nome · badge · +preço]` · `↑` `↓` · `⋮` |
| `editando` | toque no botão nome/preço, ou `⋮ → Editar` | `Escape`, `Cancelar`, salvar OK | `nº` · `[input nome]` `[input preço]` · `[Salvar]` `[✕ Cancelar]` + linha de alcance |
| `editando/salvando` | submit | resposta do servidor | idem, com `Loader2` no Salvar e `aria-disabled` nos dois botões |
| `confirmando` | `⋮ → Remover` | `Escape`, `Cancelar`, remoção OK | `⚠` · pergunta com alcance · `[Cancelar]` `[Remover]` |
| `confirmando/removendo` | toque em Remover | resposta do servidor | idem, `Loader2` no Remover, `aria-disabled` nos dois |

**`aria-disabled`, NUNCA `disabled`.** Em `salvando`/`removendo` o foco está em cima
de um desses dois botões; `disabled` o tiraria da ordem de foco e o jogaria no `<body>`
— é a armadilha nº 1 já documentada em `LinhaCategoriaReordenavel.tsx:38-48`. O handler
guarda com `if (emVoo) return;`.

### 3. Os quatro julgamentos pedidos

#### 3.1 Como a linha diz que o item está inativo

**Decisão:** `<Badge variant="outline">Inativo</Badge>` ao lado do nome — exatamente o
que a aba Biblioteca já faz (`OpcionaisClient.tsx:604`) — **mais** o preço em
`text-muted-foreground`. Nada além disso.

- **Não** `opacity-60` na linha: derruba o contraste de `text-foreground` abaixo de
  4.5:1 e falha a 1.4.3.
- **Não** tachado: em comércio, preço tachado significa "de/por", não "desativado".
- **Não** cor sozinha: o badge é texto ("Inativo"), então satisfaz a 1.4.1 e o leitor
  de tela lê o estado sem `aria-*` nenhum, porque é conteúdo real da linha.
- **Não** deixar a linha parecendo desabilitada: o item inativo **ocupa posição real**
  na ordem (D1 — a permutação inclui os inativos), então ele é arrastável, editável e
  removível como qualquer outro. Uma linha acinzentada mentiria sobre isso.
- **Mesmo peso visual, nenhum destaque:** em 360px a lista já é densa; o badge
  `outline` (borda fina, sem preenchimento) é o marcador mais barato em pixels que
  ainda é texto. Em 360px ele desce para a 2ª linha, junto ao preço:
  `Inativo · +R$ 3,50`.

**Consequência que o desenho tem que resolver:** mostrar "Inativo" sem permitir ativar
reproduz o problema que a issue existe para matar ("sair para a aba Biblioteca").
Por isso o kebab da linha ganha **`Ativar na vitrine` / `Desativar na vitrine`**,
que chama `acoes.alternarOpcionalAtivo` — action que já existe e **já está injetada**
em `OpcionaisClientAcoes`. Custo: um `MenuItem`. Não é um `Switch` na linha: seria um
5º alvo de 44px no orçamento de largura, e o rótulo do menu carrega o estado em texto
("Ativar"/"Desativar"), o que é mais acessível que um switch sem rótulo visível.

#### 3.2 Onde cabe o aviso de alcance na EDIÇÃO

**Decisão: em dois lugares, com severidades diferentes, e só quando o alcance é ≥ 2.**

O erro a evitar é o aviso que dispara sempre: vira papel de parede e deixa de ser lido
justamente quando importa. E o alcance é propriedade do **grupo**, não do item — todo
item de "Bordas" tem o mesmo alcance. Então:

1. **Cabeçalho do painel do grupo**, uma vez, ao abrir — o contexto antes de agir:
   > *Itens da biblioteca da loja. Editar ou remover vale para as 3 categorias de
   > produto que usam Bordas.*
   `text-xs text-muted-foreground`, uma linha. Some quando o alcance é 0 ou 1.

2. **Dentro da linha em edição**, ligado aos campos por `aria-describedby`:
   > *Vale para 3 categorias de produto.*
   Este é o ponto que atende literalmente "no momento da ação": quem foca o campo de
   preço **ouve** a frase, não só quem enxerga o cinza.

3. **No toast de sucesso**, como confirmação de efeito (não como aviso):
   > *Catupiry atualizado nas 3 categorias que usam Bordas.*

**Por que a edição não ganha confirmação e a remoção ganha:** reversibilidade.
Digitar o preço antigo de volta desfaz uma edição em 3 segundos; remoção não tem volta.
Gate bloqueante para o irreversível, aviso não-bloqueante para o reversível — é a
assimetria inteira da resposta. Um `[Confirmar edição]` a cada preço treinaria o
lojista a confirmar sem ler, e aí a confirmação da **remoção** também vira reflexo.

**Alcance 0 ou 1: nenhum texto, em lugar nenhum.** É o caso comum, e é o que impede
o aviso de virar poluição.

#### 3.3 A linha de confirmação inline — foco, `Escape` e leitor de tela

É o ponto mais provável de quebrar AA, e o desenho trava cinco coisas:

**a) Semântica: `role="group"` + `aria-labelledby`, NÃO `role="alertdialog"`.**
`alertdialog` promete modalidade e foco preso. Aqui não há trapa de foco — a tabulação
continua saindo da linha para o resto do cartão. Declarar `alertdialog` sem
`aria-modal` e sem trapa é mentir para a tecnologia assistiva, e é exatamente a
armadilha que a issue rejeitou ao descartar o `AlertDialog`. O `<li>` **não é
desmontado**: seu conteúdo é trocado, mantendo o `<ol>` e a numeração estáveis.

**b) Foco ao entrar: `Cancelar`, nunca `Remover`.** Quem tecla `Enter` por reflexo
cancela em vez de destruir. `autoFocus` no `Cancelar`.

**c) `Escape` cancela — com `stopPropagation()` obrigatório.**
Esta é a linha mais importante do desenho inteiro para a 217:

```
onKeyDown: if (e.key === "Escape") { e.stopPropagation(); cancelar(); }
```

Sem o `stopPropagation`, dentro do modal tela cheia da 217 o `Escape` sobe e **fecha o
modal inteiro** em vez de cancelar a confirmação — que é precisamente a "armadilha de
`Escape`" que motivou a recusa ao `AlertDialog` aninhado. O handler mora **no container
da confirmação**, não em `window`, para não roubar `Escape` quando a linha está em
`leitura`. Hierarquia resultante, e ela é critério de aceite:

| `Escape` nº | Com confirmação aberta | Com edição aberta | Nada aberto |
|---|---|---|---|
| 1 | cancela a confirmação | cancela a edição | fecha o modal (217) |
| 2 | fecha o modal (217) | fecha o modal (217) | — |

**d) Foco ao sair — os três caminhos, todos determinísticos:**

| Saída | Para onde o foco vai |
|---|---|
| `Cancelar` / `Escape` | volta ao **kebab da própria linha** (o invocador), por `ref` |
| `Remover` com sucesso | a linha some → foco no botão **"Adicionar opcional"** do painel do grupo |
| `Remover` com erro | permanece no botão **`Remover`**, e a confirmação **NÃO fecha** |

O alvo do sucesso é o "Adicionar opcional" e não o kebab da linha seguinte porque o
fluxo termina em `router.refresh()`: qualquer `ref` para uma linha irmã fica obsoleta
na remontagem, e o foco cairia no `<body>`. O botão "Adicionar opcional" é irmão da
lista, sobrevive à remontagem e é sempre o mesmo nó. Fechar a confirmação no erro
pareceria sucesso — por isso ela fica aberta e o retry custa um `Enter`.

**e) Anúncio: pela região viva que já existe, nunca por uma nova.**
O `ModoReordenar` da lista de itens já expõe `ManipuladorModoReordenar.anunciar()`
sobre um único `role="status" aria-live="polite"`. Todo evento do painel de itens
(confirmação aberta, item removido, item adicionado, edição salva, erro de validação
vindo do servidor) passa por esse handle.

**Regra das duas regiões vivas, que a 216 precisa não violar:** com o painel aberto há
duas `aria-live` na tela (a dos grupos e a dos itens). Isso é aceitável **porque cada
evento é escrito em exatamente uma delas** — o que silencia ou duplica anúncio é o
mesmo evento em duas regiões, não duas regiões com classes de evento disjuntas.
A divisão é rígida: eventos de **grupo** (checkbox, mover grupo, abrir/fechar painel)
vão na região dos grupos; eventos de **item** vão na região dos itens.

`polite`, não `assertive`: o foco está prestes a se mover para o `Cancelar`, e
`assertive` interromperia o anúncio do próprio foco.

#### 3.4 Como a sanfona se comporta no mobile (e já pensando na 217)

1. **Um grupo aberto por vez** (ver §1). Abrir "Extras" fecha "Bordas" e anuncia
   *"Bordas fechado. Extras aberto, 6 opcionais."*
2. **Setas ↑↓ dos itens somem abaixo de `sm`** e viram `MenuItem` no kebab — a mesma
   régua e o mesmo código de `compacta` que a linha de grupo já usa. Nenhum caminho de
   teclado se perde: em desktop as setas são botões; em mobile são itens de menu.
3. **Recuo por régua vertical, não por margem** — ~20px em vez de ~64px (§1).
4. **"Adicionar opcional" no rodapé do painel**, dentro do scroll, não em barra fixa:
   barra fixa dentro de modal tela cheia briga com o teclado virtual, que é justamente
   o que sobe quando esse botão é usado.
5. **Nada de `Sheet` nem de `AlertDialog` a partir daqui.** Adicionar item é inline
   (mesma forma da edição), remover é inline. O painel de itens não abre nenhum
   segundo overlay — é o que mantém a 217 sendo só uma troca de container.
6. **Cabeçalho do cartão (nome da categoria de produto) `sticky top-0`** dentro do
   corpo rolável do modal: com um grupo aberto o scroll fica longo e é fácil esquecer
   em qual categoria de produto se está.
7. **Arrastar um grupo fecha o painel dele antes** (`onDragStart` → colapsa). Um
   fantasma de 400px de altura sob o dedo é injogável, e `isDragging` já aplica
   `[&>*]:opacity-0` na linha.

### 4. Teclado — mapa completo

| Contexto | Tecla | Efeito |
|---|---|---|
| Gatilho do grupo | `Enter` / `Espaço` | abre/fecha o painel; `aria-expanded` acompanha |
| Linha em `leitura` | `Tab` | nº → botão nome/preço → `↑` → `↓` → `⋮` |
| Botão nome/preço | `Enter` / `Espaço` | entra em `editando`, foco no input **nome** |
| Input nome | `Tab` | vai para o input preço |
| Input nome/preço | `Enter` | salva (`preventDefault`) |
| Input nome/preço | `Escape` | cancela, foco volta ao botão nome/preço |
| Confirmação | `Tab` | `Cancelar` → `Remover`, e sai da linha (sem trapa) |
| Confirmação | `Escape` | cancela + `stopPropagation()` |
| `↑` / `↓` no limite | `Enter` | no-op por `moverPorDeslocamento`; anuncia "já está na primeira posição" |

A tabulação **não é presa** em nenhum estado. Trapa de foco é para modal; aqui o
usuário tem que poder sair da linha sem responder — o `Escape` é o atalho, não a
única saída.

### 5. Anúncios em região viva (pt-BR literal)

| Evento | Região | Frase |
|---|---|---|
| painel do grupo abre | grupos | `Bordas aberto. 4 opcionais, na ordem da vitrine.` |
| painel do grupo fecha | grupos | `Bordas fechado.` |
| mensagem inicial da lista de itens | itens | `4 opcionais no grupo Bordas, na ordem da vitrine. Use os botões mover para cima e mover para baixo.` |
| item movido | itens | `Catupiry movido para a posição 2 de 4.` (já é `mensagemPosicao`) |
| confirmação aberta | itens | `Confirmar remoção de Catupiry. Ele sai de 3 categorias de produto. Escolha Cancelar ou Remover.` |
| confirmação cancelada | itens | `Remoção cancelada. Catupiry continua no grupo Bordas.` |
| item removido | itens | `Catupiry removido. O grupo Bordas ficou com 3 opcionais.` |
| item adicionado | itens | `Cheddar adicionado. 5 opcionais no grupo Bordas.` |
| edição salva | itens | `Catupiry atualizado.` |
| erro do servidor | itens | a mensagem genérica da action, **mais** `toast.error` |

**A `mensagemInicial` dos itens NÃO menciona arrastar**, e com `semArrasto` o
`screenReaderInstructions` do dnd-kit ("Pressione espaço para começar a arrastar…")
**não pode ser emitido**: descreveria uma alça que não existe. É um bug de
acessibilidade real, não detalhe — entra no critério de aceite.

### 6. Copy (tom do painel: direto, 2ª pessoa implícita, sem jargão)

| Onde | Texto |
|---|---|
| Alcance no cabeçalho do painel (≥2) | `Itens da biblioteca da loja. Editar ou remover vale para as {n} categorias de produto que usam {grupo}.` |
| Alcance na linha em edição (≥2) | `Vale para {n} categorias de produto.` |
| Confirmação, alcance ≥3 | `Remover "{item}"? Ele sai de {n} categorias de produto.` |
| Confirmação, alcance 2 | `Remover "{item}"? Ele sai de {A} e {B}.` |
| Confirmação, alcance 1 | `Remover "{item}"? Ele sai de {A}.` |
| Confirmação, último item do grupo | acrescenta `É o último opcional de {grupo}.` |
| Botões da confirmação | `Cancelar` · `Remover` (`variant="destructive"`) |
| Botões da edição | `Salvar` · `Cancelar` |
| Adicionar | `+ Adicionar opcional` (`aria-label="Adicionar opcional em {grupo}"`) |
| Empty state do grupo | `Nenhum opcional neste grupo ainda.` + o botão adicionar |
| Aviso "só inativos" | `Nenhum opcional ativo — o cliente não vê nenhuma opção aqui.` |
| Toast de sucesso na edição (≥2) | `{item} atualizado nas {n} categorias que usam {grupo}.` |
| Toast de sucesso na edição (≤1) | `{item} atualizado.` |
| Toast de remoção | `{item} removido.` |

A frase de alcance sai de uma função pura `rotuloAlcance(nomes: string[])` — nomear
até 2 categorias e cair na contagem a partir de 3. Pura e testável em Vitest, sem jsdom.

**O que a copy NÃO diz:** que pedidos antigos não mudam. É verdade (snapshot em
`itens_pedido_opcionais`, RN-O6), mas dilui a frase de alcance, que é o risco real.
Duas linhas de aviso numa confirmação em 360px fazem as duas serem ignoradas.

### 7. Acessibilidade — checagem item a item

- **44px:** kebab, `↑`, `↓`, `Cancelar`, `Remover`, `Salvar`, `+ Adicionar opcional` e
  o botão nome/preço, todos `min-h-[44px]`. Literal, nunca `min-h-11` (52,8px na base
  de 120%) e **nunca** `size="icon-sm"` (33,6px).
- **Contraste:** `text-foreground` sobre `bg-muted/40` do painel — o painel usa
  `bg-muted/40` e não `bg-muted/60` justamente para não comer o contraste do texto
  secundário. A linha de alcance é `text-muted-foreground` sobre `bg-muted/40`:
  **conferir ≥4.5:1 nos dois temas antes de fechar**, é o único par novo desta issue.
  Pares de painel são tokens de sistema (não dependem do `tema` da loja).
- **Foco visível:** `focus-visible:ring-3 focus-visible:ring-ring/50` (padrão já usado
  na alça) em todo interativo novo, inclusive no botão nome/preço, que é o alvo mais
  fácil de esquecer por parecer texto.
- **Inputs:** sem `<label>` visível na linha densa — `aria-label="Nome do opcional"` e
  `aria-label="Preço de {item} em reais"`. É desvio deliberado da §5 do
  `design-system.md`, justificado pela densidade, e **o placeholder nunca é o único
  rótulo**. Erro de validação: `aria-invalid` + `aria-describedby` apontando para o
  `<p>` de erro sob o campo; erro vindo do servidor também vai à região viva, porque
  nesse momento o foco está no `Salvar`, não no campo.
- **Preço:** `inputMode="decimal"`, aceita vírgula, convertido com
  `Number(v.replace(",", "."))` como o `FormProduto` já faz. Prefixo "R$" é adorno
  visual `aria-hidden` — o rótulo já diz "em reais".
- **Não depender de cor:** "Inativo" é texto; o botão destrutivo é
  `variant="destructive"` **e** tem o texto "Remover".

### 8. Seams de implementação (para o `planejar`, não é código)

Props e dados novos que este desenho exige:

- `ModoReordenar`: **`semArrasto?: boolean`** — esconde a alça, **e** suprime o
  `screenReaderInstructions` de arrasto. Não reusar `arrastoBloqueado`, que também
  deixa as setas inertes.
- Linha do item: precisa de `semArrasto`, de um **slot de conteúdo** (o miolo vira
  botão em `leitura` e dois inputs em `editando`), de um slot de **badge** e de
  **itens extras no kebab** (Editar / Ativar-Desativar / Remover). Se estender
  `LinhaCategoriaReordenavel` obrigar `useSortable` a rodar fora de um `DndContext`,
  **prefira uma irmã `LinhaItemOpcional`** — o contrato de UI acima não muda com a
  escolha.
- `CartaoAssociacaoOpcionais`: `opcionaisPorGrupo: Map<string, Opcional[]>` e
  `alcancePorGrupo: Map<string, string[]>` (nomes das categorias de produto que usam
  o grupo, derivado de `associacoes` + `categoriasProduto`, que o `OpcionaisClient`
  já tem em mãos).
- **O estado "qual grupo está aberto" mora no CARTÃO, acima da remontagem.** O cartão
  remonta a lista de grupos por `key={chaveDaLista}` a cada toggle de checkbox
  (`CartaoAssociacaoOpcionais.tsx`, `chaveDaLista`); se o estado do disclosure morasse
  na linha, desmarcar **outro** grupo fecharia o painel aberto e perderia o foco.
  Guardar por `categoria_opcional_id` e devolver o foco ao gatilho após a remontagem.
- Payload do item novo: `ativo: true`, `ordem: <total atual>` — `schemaOpcional` exige
  os dois; `ordem` definitiva continua sendo derivada no servidor pela RPC da 215.

### 9. Critérios de aceite de UI (testáveis sem jsdom)

1. Linha de item inativo contém o texto `Inativo`; **não** contém `opacity-` nem
   `line-through`.
2. O painel do grupo só imprime a frase de alcance quando `alcance ≥ 2`.
3. A linha em edição tem `aria-describedby` apontando para o id da frase de alcance.
4. A confirmação inline imprime a contagem/nomes corretos por `rotuloAlcance` (função
   pura, teste de unidade direto).
5. Os botões da confirmação usam `aria-disabled` e **nunca** `disabled`.
6. Com `semArrasto`, o markup **não** contém `Reordenar {nome}` (a alça) nem o texto
   `Pressione espaço para começar a arrastar`.
7. `mensagemInicial` dos itens cita "mover para cima"/"mover para baixo" e não cita
   arrastar.
8. As setas ↑↓ da linha de item levam `hidden sm:inline-flex` (compacta) e os mesmos
   comandos existem como `MenuItem`.
9. Todo alvo novo tem `min-h-[44px]`; nenhum usa `size="icon-sm"`.
