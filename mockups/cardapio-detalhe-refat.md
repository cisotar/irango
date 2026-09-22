# Refatoração de `/painel/cardapios/[cardapioId]` — detalhe de um cardápio

Mockup: `mockups/cardapio-detalhe-refat.html`
Rota real: `src/app/(painel)/painel/(bloqueavel)/cardapios/[cardapioId]/page.tsx`
Componentes de hoje: `painel/FormVigencia.tsx`, `painel/SeletorProdutosDoCardapio.tsx`, `painel/PilulasDeDias.tsx`, `painel/DialogoLoteCardapio.tsx`, `painel/useLoteDeProdutos.tsx`

> **Só desenho.** Nada em `src/` foi tocado.

## Gate de reuso

- **shadcn/ui varridos:** `accordion`, `sheet`, `dialog`, `alert-dialog`, `card`, `badge`, `checkbox`, `button`, `input`, `label`, `menu`, `radio-group`, `separator`, `switch`, `textarea`
- **Componentes vitrine/painel:** `SeletorProdutosDoCardapio`, `FormVigencia`, `PilulasDeDias`, `DialogoLoteCardapio`, `BarraSelecaoLote`, `useLoteDeProdutos`, `agendaDoVinculo`, `contrato-lote`, `frasesCardapio`, **`CartaoAssociacaoOpcionais`** (sanfona por categoria + checkbox na linha + autosave — o precedente mais próximo), `PainelItensDoGrupo`, `ThumbProduto`
- **Tokens:** `@theme` de `globals.css` — `--color-card`, `--color-background`, `--color-muted`, `--color-border`, `--color-texto-muted`, `--color-secondary`, `--color-destructive`, `--radius`. Nenhum token novo. O painel não consome `lojas.tema`.
- **Decisão: CONSOLIDAR + ADAPTAR.** Nada novo em `components/ui/`. `SeletorProdutosDoCardapio` se parte em duas superfícies (`ItensDoCardapio` na página, `SheetAdicionarItens` no overlay); `PilulasDeDias`, `useLoteDeProdutos`, `frasesCardapio` e `copiaLotePromocao` entram inteiros, sem reescrita.
- **Justificativa:** a queixa é de arquitetura de tela (uma tela faz duas coisas), não de falta de componente — o conserto é separar as superfícies reusando o vocabulário que o painel já fala.

---

## 1. O problema, traduzido

A queixa do dono do produto ("está horrível, campos opacos, elementos soltos, muito longa") tem três causas distintas no código de hoje:

| Sintoma | Causa real |
|---|---|
| "Muito longa" | A página empilha o `FormVigencia` inteiro (7 controles + prévia) **e** o checklist da **loja inteira** agrupado por categoria. Com 60 produtos são ~60 linhas sempre abertas, cada uma com até 7 pílulas. |
| "Mistura configuração com lista de todos os produtos" | Duas tarefas de frequência muito diferente no mesmo scroll: vigência muda raramente; a composição do cardápio muda toda semana. E o **objeto da tela** (os itens deste cardápio) é minoria visual dentro da lista de tudo. |
| "Campos opacos sem distinção com o fundo" | Página, `Card` e `CardContent` são todos `--background`/`--card` = branco puro, e os separadores são `divide-foreground/10`. Não há contraste de superfície: tudo flutua no mesmo plano. |
| "Elementos soltos" | A barra de lote é `fixed` no rodapé mobile / `sticky` no topo desktop, **fora** do card a que se refere; o resumo em cards de 160px quebra em fileiras irregulares; o "Voltar para cardápios" é um link cru sem chrome. |

---

## 2. Estrutura proposta

```
┌──────────────────────────────────────────────┐  shell: bg-muted/40 (cinza-quente)
│ ‹ Cardápios                                  │
│ Almoço Executivo      [● Aparecendo agora]   │
│                                              │
│ ┌─ card ────────────────────────────────┐    │  ← Accordion, FECHADO por padrão
│ │ › Quando este cardápio aparece        │    │
│ │   Seg a sex, das 11:00 às 15:00       │    │  ← resumo 1 linha, do SERVIDOR
│ └───────────────────────────────────────┘    │
│                                              │
│ Itens do cardápio (4)     [+ Adicionar item] │
│ ┌─ card ────────────────────────────────┐    │
│ │ Filé à parmegiana                 [⋮] │    │
│ │ R$ 48,90 · Pratos principais          │    │
│ │ [Exclusivo de cardápio]               │    │
│ │ Só às segundas, quartas e sextas.     │    │  ← frase do SERVIDOR
│ │ [D][S][T][Q][Q][S][S]                 │    │  ← PilulasDeDias compacto
│ │ ⚠ este item nunca aparece: …          │    │  ← aviso âmbar quando cabe
│ └───────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

O sheet cobre a página: `side="bottom" h-[90dvh]` no mobile, `side="right"` (`sm:max-w-sm`, já é o default do `sheet.tsx`) a partir de `sm`.

---

## 3. Decisões — origem

### Fechadas pelo dono do produto (não reabertas)

1. Vigência vira seção recolhida no topo, fechada por padrão, com resumo de uma linha.
2. "Adicionar item" abre um `Sheet`; a página fica curta.
3. Dias da semana são obrigatórios no ato de adicionar.
4. Um por vez **e** em lote, os dois caminhos.
5. Lote e "categoria inteira" vivem dentro do sheet; "categoria inteira" é botão no cabeçalho da categoria.
6. Tirar do cardápio é gesto no card do item, com confirmação curta.
7. Escopo é só o detalhe; `/painel/cardapios` não entra.
8. O passe visual entra junto.

### Decisões de UX minhas (abertas a veto)

| # | Decisão | Por quê |
|---|---|---|
| D1 | **Shell da página em `bg-muted/40`, cards em `bg-card` branco com `border` e sombra de 1px.** | É o conserto literal de "campos opacos sem distinção com o fundo": hoje branco sobre branco. Contraste de superfície, não cor nova. |
| D2 | **Um item = um `Card`, não uma linha de `<li>` com `divide-y`.** | Cada item carrega 5 informações (nome, preço, categoria, badges, agenda de 7 pílulas + aviso). Em 360px isso não é linha de tabela; é card. Também é o que faz sumir a sensação de "elementos soltos". |
| D3 | **A escolha de dias no sheet é um par de rádios — "Todos os dias do cardápio" (default) / "Escolher dias" — e as 7 pílulas só aparecem no segundo.** | Ver §4: é a resposta ao atrito da decisão 3. |
| D4 | **Produto já vinculado aparece no sheet, mas sem checkbox** — linha esmaecida com "Já está neste cardápio". | Esconder confunde ("cadê a picanha?"); manter clicável produziria seleção que não escreve nada (`ON CONFLICT DO NOTHING`) e uma prévia do servidor menor que a seleção. |
| D5 | **As pílulas ficam inline no card do item, não atrás de um "Editar dias".** | Ajustar dia é a edição mais frequente depois de adicionar, e o componente já é acessível e com autosave. Esconder atrás de um clique trocaria uma tela longa por uma tela lenta. |
| D6 | **Busca no topo do sheet.** | Sanfona fechada + loja com 12 categorias = caça ao tesouro. A busca é filtro puro sobre o dado já no cliente; não é leitura nova. |
| D7 | **Confirmação do lote é um PASSO do sheet, não um `AlertDialog` por cima.** | `design-system.md` §6 registra a armadilha: o ESC do overlay interno borbulha e fecha o externo (issue 216/217). A prévia do servidor e toda a copy de `copiaLotePromocao.ts` continuam iguais — muda só o container. |
| D8 | **"Tirar do cardápio" na página continua em `AlertDialog`.** | Na página não há modal aberto embaixo, então a exceção de §6 não se aplica e vale a regra geral. Confirmação curta, com a frase de D14 quando o produto é exclusivo (`fraseExclusivos(1)` já existe). |
| D9 | **Kebab no card do item com três itens:** Editar produto · Voltar a todos os dias do cardápio · Tirar do cardápio (destrutivo). | Mesmo padrão de `ProdutosClient`/`LinhaCategoriaReordenavel`. "Voltar a todos os dias" é hoje impossível pela UI: desmarcar as 7 pílulas grava `[]`→`NULL`, mas o lojista não tem como saber disso. |

---

## 4. Atrito real no pedido do dono — decisão 3 ("dias obrigatórios")

**O atrito:** no modelo de dados, `cardapio_produtos.dias_semana = NULL` significa **"todos os dias do cardápio"** — é o default e o caso majoritário. Exigir literalmente que o lojista marque dias no ato de adicionar significa: (a) 7 toques para expressar o caso mais comum, e (b) marcar as 7 pílulas grava `[0..6]`, que **não é** a mesma coisa que `NULL` — é uma agenda fixa que deixa de seguir a vigência do cardápio se ela mudar depois. O pedido, tomado ao pé da letra, gera dado pior e mais cliques.

**Alternativa (D3, é o que o mockup desenha):** a escolha continua **obrigatória e na mesma interação**, mas é entre duas opções, não entre 128 combinações:

- `( • ) Todos os dias do cardápio` — pré-selecionada, payload `dias_semana: []` → `NULL`. Zero cliques extras.
- `( ) Escolher dias` — revela as 7 pílulas; o CTA fica `aria-disabled` até haver ≥1 dia, com o motivo em texto.

Isso entrega o que ele quis ("menos cliques, mais intuitivo", nada de voltar depois para configurar) sem forçar 7 toques no caso comum e sem produzir `[0..6]` acidental. **Preciso que ele confirme este recorte.**

### "Categoria inteira" deveria ser exceção?

**Minha opinião: não.** Deve seguir a mesma escolha de dias do rodapé do sheet, pelos mesmos motivos — se fosse exceção, a categoria inteira entraria sempre como `NULL` e o lojista teria que corrigir item por item depois, que é exatamente a fricção que a decisão 3 quer eliminar. E teríamos duas semânticas de "adicionar" na mesma tela.

**Consequência técnica, e é o ponto caro deste desenho:** hoje nenhum dos dois caminhos de escrita carrega dias.

- `aplicarCardapioEmProdutos` (`src/lib/actions/cardapio.ts:118`) monta `{ loja_id, cardapio_id, produto_id }` e faz upsert — sem `dias_semana`.
- `aplicarCardapioEmCategoria` (`:170`) chama a RPC `aplicar_cardapio_em_categoria(p_loja_id, p_cardapio_id, p_categoria_id)` — sem parâmetro de dias.

Para a decisão 3 valer, é preciso **um campo opcional `dias_semana` no `schemaLoteDeProdutos`** (reusando `normalizarDiasDoVinculo`) e **um `p_dias_semana` na RPC** (migration). O caminho alternativo — adicionar e depois fazer fan-out de `definirDiasDoVinculo` no cliente — **deve ser rejeitado**: quebra a atomicidade que a RPC da issue 250 existe para garantir (RN-10) e deixa estado parcial se a segunda rodada falhar. Isso é escopo de `/fluxo` com migration, não de `/polir`.

---

## 5. Anatomia — componentes e classes

### Página

| Região | Componente | Classe / prop |
|---|---|---|
| Shell | `div` | `min-h-full bg-muted/40 p-3 sm:p-4 flex flex-col gap-3` |
| Voltar | `Link` | `inline-flex min-h-[44px] items-center gap-1 text-sm underline`, `href={voltarHref}` **injetado** |
| Título + status | `h1` + `BadgeStatus` | cor + texto ("Aparecendo agora" / "Fora da janela") |
| Vigência | `Accordion type="single" collapsible` + `Card` | `AccordionTrigger` com `min-h-[44px]`; conteúdo = `FormVigencia` **sem alteração** |
| Resumo fechado | `span` | `truncate text-xs text-texto-muted` — texto de `descreverVigencia` (servidor) |
| Cabeçalho da lista | `div` | `flex flex-wrap items-center justify-between gap-2` |
| CTA | `Button` | `min-h-[44px]`, abre o `Sheet`; **sem** `size="icon-sm"` em lugar nenhum |
| Item | `Card` | `p-3 space-y-2`, `aria-busy` durante a escrita otimista |
| Nome | `p` | `text-[1.02rem] font-semibold leading-snug` |
| Preço + categoria | `p` | `text-sm text-texto-muted tabular-nums` |
| Badges | `Badge secondary` | "Exclusivo de cardápio" (só quando `visibilidade = 'cardapio'`) |
| Frase de agenda | `p` | `text-xs text-texto-muted`, `id` referenciado pelo `aria-describedby` do grupo |
| Agenda | `PilulasDeDias compacto` | inalterado |
| Aviso | `p role="status"` | `border-amber-300 bg-amber-100 text-amber-900` — texto do servidor |
| Ações | `Menu` + `MenuTrigger` | `min-h-[44px] min-w-[44px]`, `aria-label="Mais ações de {nome}"` |
| Desktop | `ul` | `grid gap-2 md:grid-cols-2` |

### Sheet

| Região | Componente | Classe / prop |
|---|---|---|
| Container | `SheetContent` | `side="bottom" className="h-[90dvh] sm:h-full" side="right"` a partir de `sm`; **`showCloseButton={false}`** |
| Header | `SheetHeader` + `SheetTitle` + `SheetDescription` | título "Adicionar itens", descrição = nome + vigência do servidor |
| Fechar | `SheetClose render={<Button variant="ghost" />}` | `min-h-[44px] min-w-[44px]`, `aria-label="Fechar"` |
| Busca | `Input type="search"` + `Label sr-only` | `min-h-[44px]` |
| Categorias | `Accordion type="single" collapsible` | **fechado por padrão**; `AccordionTrigger` mostra "9 produtos · 3 já no cardápio" |
| Categoria inteira | `Button outline` no cabeçalho | rótulo curto `+ os 6` + `aria-label` completo ("Adicionar os 6 produtos de Pratos principais que faltam") |
| Linha de produto | `label` + `Checkbox` | `flex min-h-[44px] items-center gap-2`; o `label` inteiro é o alvo |
| Já vinculado | `div` sem checkbox | `opacity-70`, texto "Já está neste cardápio" |
| Rodapé | `SheetFooter` | `RadioGroup` de dias + `aria-live` de contagem + CTA `w-full` |

Corpo do sheet rola (`overflow-y-auto`); header e footer ficam fixos. **A barra `fixed` de hoje some** — o CTA vive dentro do container a que pertence.

---

## 6. Estados

| Estado | O que a tela mostra |
|---|---|
| Cardápio sem item | Card centrado: "Nenhum item neste cardápio ainda" + "Um cardápio sem item não muda nada na vitrine." + CTA "+ Adicionar item" |
| Loja sem produto nenhum | Sheet abre com "Você ainda não tem produtos" + link para `/painel/produtos` (href **injetado**) |
| Busca sem resultado | "Nenhum produto com esse nome." |
| Escrita de dias em voo | `aria-busy` no card, pílulas `disabled`, frase vira "Salvando…", `aria-live` anuncia "Dias salvos." (é o comportamento de hoje, preservado) |
| Prévia do lote em voo | `Loader2` no CTA do sheet; **o passo de confirmação não existe antes da prévia chegar** (a prop `previa` continua obrigatória) |
| Lote recusado | `toast.error` com a frase da action; o sheet volta ao passo de seleção **com a seleção intacta** |
| Prévia com total 0 | Passo de confirmação com "Nada a adicionar" e CTA desabilitado (comportamento atual) |
| Agenda que nunca abre | Aviso âmbar no card. Avisa, não bloqueia, não rouba foco |

---

## 7. Acessibilidade

- **44px literal** em todo alvo. Exceção já registrada em `design-system.md` §5: pílula compacta cede só no eixo X (`min-w-[40px] sm:min-w-[44px]`), nunca em altura.
- **Achado no `sheet.tsx`:** o botão de fechar default usa `size="icon-sm"` → 33,6px na base de 120%. Não dá para editar `components/ui/`; a saída é `showCloseButton={false}` + `SheetClose` próprio de 44px. **Vale registrar em `design-system.md` §5 como regra para todo consumidor de `Sheet`.**
- **Achado no código atual:** `SeletorProdutosDoCardapio` explica o "Definir dias" desabilitado por `title` ("Só vale para quem já está neste cardápio."). `title` não é exposto de forma confiável a leitor de tela nem a toque. Vira parágrafo visível + `aria-describedby`, e `aria-disabled` em vez de `disabled` quando o foco pode estar no botão.
- **Sem overlay aninhado** (D7). O `Sheet` do Base UI já entrega `role="dialog"`, foco preso e ESC.
- **Teclado:** sanfona é `Accordion` do shadcn (trigger é `<button>`, `aria-expanded`/`aria-controls`); pílulas mantêm roving tabindex — o grupo é **uma** parada de Tab, o que importa porque a página agora tem N grupos de 7.
- **Rótulos:** `role="group"` das pílulas com `aria-label` nominal ("Dias em que Filé à parmegiana aparece neste cardápio"); `aria-describedby` apontando para a frase de agenda; `aria-label` em todo botão de ícone.
- **Não depende só de cor:** badge de status e "Exclusivo de cardápio" são cor + texto; o aviso âmbar é texto completo, não um ponto colorido.
- **Contraste:** tudo é token de sistema do painel (`--texto-muted` #6b5d4f é AA em fundo claro). O painel não consome `lojas.tema`, então o risco de §4 não se aplica.
- **360px:** nenhuma linha soma mais de 360px — o card do item empilha; no sheet a linha é checkbox 44 + texto flexível, e o botão de categoria usa rótulo curto com `aria-label` longo.

---

## 8. O que muda, em relação a hoje

| Hoje | Depois |
|---|---|
| `FormVigencia` sempre aberto no topo | Dentro de `Accordion` fechado, com resumo do servidor. Componente **inalterado** |
| Checklist da loja inteira na página | Sai da página; vira o sheet |
| Resumo de quem está no cardápio em cards de 160px | Vira **o corpo da página**, um card por item, com agenda inline |
| Barra de lote `fixed`/`sticky` fora de contexto | `SheetFooter` dentro do sheet |
| "Selecionar os N" / "Limpar" / "Adicionar a categoria inteira" no cabeçalho de cada categoria da página | Só dentro do sheet; "categoria inteira" com rótulo curto |
| Tirar do cardápio = selecionar + barra + diálogo | Kebab do card → `AlertDialog` curto |
| Adicionar sem dias; dias depois, item a item | Dias escolhidos no ato (D3) — **exige o campo novo na action e na RPC** |
| `AlertDialog` de lote sobre a página | Passo de confirmação dentro do sheet (mesma copy, mesma prévia do servidor) |

**Preservado integralmente:** agenda por vínculo, `PilulasDeDias` e sua exceção de §5, aviso âmbar redigido no servidor, selo "Exclusivo de cardápio", prévia do lote vinda de `preverLoteAction`, `frasesCardapio`/`copiaLotePromocao` sem uma frase nova, e a paridade com o hub admin (ações e `voltarHref` injetados, nenhuma rota `/painel/...` literal dentro do componente).

---

## 9. Testabilidade sem jsdom

O desenho foi puxado para markup afirmável por `renderToStaticMarkup`:

- a seção de vigência renderiza `aria-expanded="false"` e o resumo do servidor no SSR — afirmável sem clique;
- o card do item renderiza badge, frase, `aria-label` do grupo e o aviso âmbar como texto — afirmável sem clique;
- a escolha de dias do sheet vira um módulo puro novo (ao lado de `agendaDoVinculo.ts`) que mapeia `{modo: "cardapio"} → []` e `{modo: "dias", dias} → dias.sort()`, e recusa `{modo: "dias", dias: []}`. É aí que a regra de D3 fica travada, não no clique;
- o rótulo de "categoria inteira" ("Adicionar os 6 produtos de Pratos principais que faltam") vira função pura com teste de singular/plural.

---

## 10. Confirmar com o dono do produto antes de virar plano

1. **D3 (o principal):** aceita "Todos os dias do cardápio" como opção pré-selecionada, em vez de exigir marcar pílulas sempre? Se ele insistir na leitura literal, o desenho muda e vale a pena decidir se 7 pílulas marcadas devem gravar `NULL` ou `[0..6]` — não é a mesma coisa para a vitrine.
2. **Custo da decisão 3:** ele aceita que isto arrasta uma migration (parâmetro de dias na RPC) + mudança em duas Server Actions? É o que tira a feature de "refatoração de UI" e coloca em `/fluxo` com TDD.
3. **"Categoria inteira" sem exceção** — concorda? (minha recomendação: sem exceção)
4. **D5:** pílulas inline no card de cada item, ou atrás de "Editar dias"? Inline deixa a página mais alta; escondido deixa mais lenta. Desenhei inline.
5. **D4:** produto já vinculado aparece esmaecido no sheet — ou sumir de vez da lista?
6. **Busca no sheet (D6)** entra nesta rodada ou fica para depois?
7. **Escopo do passe visual:** o shell `bg-muted/40` é só desta rota ou vira o fundo padrão de `(painel)`? Se for só aqui, esta tela fica diferente das vizinhas — o que contraria consistência. Minha preferência: decidir junto com `/painel/produtos`, mas fora deste PR.
