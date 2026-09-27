# Mockup — frequência de exibição (painel + vitrine) · issue 323

**Spec:** `specs/frequencia-exibicao.md` (RN-1..RN-8) · **Plano:** `plan/tecnico-frequencia-exibicao.md`
(C7, C8, D13) · **Loop:** `plan/loop-frequencia-exibicao.md` passo P3b.

**Preview no navegador:**
- `mockups/frequencia-exibicao-painel.html`: painel `/painel/produtos` (e o hub admin, que
  monta o mesmo `ProdutosClient` pelo `CardapioAdminClient`). Frames de 360px e um de desktop.
  CSS puro, sem CDN, abre offline.
- `mockups/frequencia-exibicao-vitrine.html`: vitrine `/loja/[slug]`, mobile-first. Tailwind CDN,
  cores da loja no `tailwind.config` inline (`primaria`/`fundo`/`destaque` = defaults de
  `globals.css`; troque para simular outra loja).

> Os dois HTMLs usam `html { font-size: 120% }`, a base de `globals.css`, para os 44px
> aparecerem na proporção real. Todo alvo de toque é **44px literal** (`min-h-[44px]
> min-w-[44px]`). `min-h-11` daria 52,8px e `size="icon-sm"` daria 33,6px (design-system §5,
> issue 291).

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`): `accordion`, `alert-dialog`, `badge`, `button`,
  `card`, `checkbox`, `dialog`, `input`, `label`, `menu`, `radio-group`, `separator`, `sheet`,
  `switch`, `textarea`, `toggle`, `toggle-group`
- **Componentes painel:** `PilulasDeDias` (7 dias, roving tabindex, modo `compacto`),
  `FormVigencia` (padrão Switch "Só em um horário do dia" + `<input type="time">` e rótulo de
  fuso), `BarraSelecaoLote` (barra fixed-bottom/sticky-top, régua `ALVO`),
  `GerenciarCategorias` (Sheet com Switch `exibir_imagens`), `ProdutosClient` (modo seleção
  260, modo reordenar 175/293 com "troca de BARRA", kebab 290, aviso âmbar RN-12, chip de
  vínculo 278), `DialogoLoteCardapio`, `CabecalhoPagina`
- **Componentes vitrine:** `CardProduto`, `ItemProdutoLista`, `rotuloEsgotado.ts`
  (`rotuloNaoCompravel`, `rotuloAcessivelNaoCompravel`, `rotuloCtaNaoCompravel`),
  `ProdutoModal`, `SecaoCatalogo`
- **Tokens** (`globals.css`): `--indisponivel-fundo`/`--indisponivel-texto` (pílula de
  indisponível), `--texto-muted`, `--borda-nav`, `.superficie-painel` (`--border` `#8a8a8a`),
  `--primary`/`--muted-foreground` do shadcn; âmbar `text-amber-700` já usado no aviso RN-12
- **Telas comparadas:** `FormVigencia.tsx` (editor de dia/hora/período do cardápio, o mais
  próximo do que se pede), `ProdutosClient.tsx` (modos), `GerenciarCategorias.tsx`

**Decisão: ADAPTAR** (nenhum primitivo novo, nenhum token novo, nada gerado via CLI).
**Justificativa:** os quatro componentes novos do C8 (`EditorFrequencia`, `DialogoFrequencia`,
`GradeFrequencia`, `BarraSelecaoFrequencia`) são composição de `Dialog` + `Switch` + `Input` +
`PilulasDeDias` + `Button` + `Badge`, seguindo padrões que já existem (FormVigencia, modo
reordenar, BarraSelecaoLote). A vitrine não ganha componente: `fora_da_janela` já existe e só o
texto muda.

---

## 1. Painel: linha de produto e cabeçalho de categoria (estado em repouso)

### 1.1 Linha de produto (360px)

```
┌─ Almoço executivo ──────────────────────── [⇅] [⚙ Opcionais] [+] ─┐
│ (◷ seg a sex · 11:00–15:00)   ← chip da CATEGORIA, sob o nome      │
├────────────────────────────────────────────────────────────────────┤
│ [img] Feijoada completa                                            │
│       R$ 42,90 (Disponível)                                        │
│       (◷ só sáb)                        ← chip do PRODUTO          │
│       ⚠ Este item nunca vai ficar disponível: os dias e horários  │
│         dele não batem com os da categoria. Ajuste a frequência    │
│         do item ou da categoria.                                   │
│ [   Ocultar   ][ Marcar esgotado ][⋮]                              │
├────────────────────────────────────────────────────────────────────┤
│ [img] Panetone trufado                                             │
│       R$ 59,00 (Disponível)                                        │
│       (◷ 01/12 a 24/12)                                            │
│       ⚠ Período encerrado em 24/12: não aparece mais na vitrine.  │
│         Mude o período para voltar a vender.                       │
├────────────────────────────────────────────────────────────────────┤
│ [img] Suco do dia                                                  │
│       R$ 9,00 (Disponível) (⊘ Nunca disponível)                    │
└────────────────────────────────────────────────────────────────────┘
```

- **Chip de frequência** = `Badge variant="outline" className="font-normal whitespace-normal"`,
  a mesma classe do chip de vínculo de cardápio (278, `ProdutosClient.tsx:1272`), com ícone
  `Clock`/`CalendarClock` do lucide (`aria-hidden`). O texto vem pronto do servidor
  (`frequencias.produtos[id].rotulo`, `rotuloFrequencia`). **Produto permanente não ganha chip**
  (`rotulo === null`): é o default e não merece ruído em toda linha, mesmo critério de
  `badgeExclusivo`.
- **"Nunca disponível"** (`dias_semana = []`, RN-8) é chip próprio, com ícone `Ban`, sem aviso:
  foi escolha explícita (C7 `avisoFrequenciaQueNuncaAbre` caso 1 ⇒ `null`).
- **Aviso** (RN-1 ou RN-7) = o mesmo `<p>` âmbar do aviso RN-12
  (`text-xs text-amber-700` + `AlertTriangle`), com o texto de `frequencias.produtos[id].aviso`.
  Âmbar, nunca vermelho: pede ação, não é falha. `text-amber-700` (`#b45309`) sobre branco mede
  5,0:1.
  - **Recomendação de a11y:** **não** usar `role="alert"` aqui. O aviso RN-12 atual usa, mas o
    texto está no HTML desde o primeiro paint: `role="alert"` em conteúdo estático faz o leitor
    de tela anunciar todos os avisos da lista ao carregar. Um `<p>` comum, ligado ao item por
    `aria-describedby` no botão do kebab, basta. Se `executar` preferir manter paridade com
    RN-12, que mantenha. É o único ponto em que consistência e a11y divergem.
- **Precedência do aviso:** período encerrado vence RN-1 (C8). O item encerrado já sumiu da
  vitrine, então essa é a informação que importa.
- **Status "Disponível" + "Período encerrado":** as duas coisas convivem, porque o
  `badgeStatus` fala de estoque (`disponivel`), não de janela. O aviso explica a diferença. Não
  proponho mexer no `badgeStatus` nesta issue.

### 1.2 Cabeçalho de categoria na lista

O `AccordionTrigger` continua sendo o `<h3>` com o nome. Sob o cabeçalho (ainda dentro do
`Card`, antes do `CardContent`), entra **uma faixa de estado da categoria**, só quando há estado
para mostrar:

```
│ Sobremesas                                         [⇅] [⚙] [+] │
│ (◉̸ Oculta da vitrine)                                          │
│ Os 6 produtos desta categoria não aparecem para o cliente.     │
│ Mostre a categoria em "Categorias" para voltar a vender.       │
```

- `Badge variant="outline"` com `EyeOff` + "Oculta da vitrine", o **mesmo** desenho do
  `badgeStatus` "Oculto" do produto (`ProdutosClient.tsx:296-302`). Cor + ícone + texto.
- Chip de frequência da categoria: mesmo `Badge` outline do produto.
- Aviso da categoria (`avisoCategoriaQueNuncaAbre` / `avisoPeriodoEncerrado`): mesmo `<p>`
  âmbar.
- **Por que no cabeçalho e não só no Sheet de categorias:** sem isso, o lojista vê "Disponível"
  em todos os produtos de uma categoria oculta e não entende por que a vitrine está vazia. A
  ação continua no Sheet (1 lugar para escrever); aqui é só leitura.

### 1.3 Kebab do produto

Ganha **um** item, depois de "Editar nome e preço":

```
✎  Editar
✎  Editar nome e preço
◷  Frequência de exibição      ← novo, abre DialogoFrequencia com 1 id
🗑 Remover
```

`MenuItem className="min-h-[44px]"`, `aria-label="Frequência de exibição de {nome}"`. O chip da
linha **não** vira botão: seria um segundo alvo para a mesma ação, e o kebab já é o lugar das
ações por produto (decisão da 290).

### 1.4 Barra do topo

```
[Categorias] [+ Novo produto] [⇅ Reordenar categorias] [☑ Selecionar] [▦ Dias da semana]
```

- **"Dias da semana"** (`Button variant="outline"`, ícone `CalendarDays`) entra no modo grade
  (§3). Só aparece com `produtos.length > 0`.
- **"Selecionar"** hoje só aparece com `lote != null` (`ProdutosClient.tsx:866`). Como a D11
  passa `lote` vazio, o gate precisa mudar para "existe ação em lote", senão o botão some junto
  com o cardápio. É ponto de atenção para `executar`, não decisão visual.

---

## 2. Editor de frequência (`DialogoFrequencia` + `EditorFrequencia`)

Um `Dialog` só para os três casos: produto (1 id), seleção (N ids) e categoria. **Não é
`AlertDialog`**, porque a ação é reversível e não destrói nada.

### 2.1 Layout (360px, dialog com 328px de largura útil)

```
┌──────────────────────────────────────────────┐
│ Frequência de exibição                    ✕  │
│ Feijoada completa                            │
├──────────────────────────────────────────────┤  ← corpo com overflow-y-auto
│ ┌ Resumo ──────────────────────────────────┐ │
│ │ só sáb · 11:00–15:00                     │ │  aria-live="polite"
│ └──────────────────────────────────────────┘ │
│                                              │
│ Dias da semana                               │
│ [●━] Só em alguns dias                       │  Switch (44px, Label envolvendo)
│ [Dom][Seg][Ter][Qua]                         │  PilulasDeDias NÃO compacto
│ [Qui][Sex][Sáb]                              │  (4+3 no mobile, 7 em sm+)
│                                              │
│ Horário                                      │
│ [●━] Só em um horário do dia                 │
│ Das [11:00] às [15:00]                       │
│ O horário de fim não entra: das 11:00 às     │
│ 15:00 vende até 14:59.                       │
│                                              │
│ Período                                      │
│ [━○] Só em um período de datas               │
│   (off = "Sempre")                           │
│                                              │
│ Horários e datas no fuso da loja             │
│ (Horário de Brasília).                       │
│                                              │
│ ⚠ Este item nunca vai ficar disponível: os  │
│   dias e horários dele não batem com os da   │
│   categoria. Ajuste a frequência do item ou  │
│   da categoria.                              │
├──────────────────────────────────────────────┤
│ [    Cancelar    ] [       Salvar        ]   │  footer fixo
└──────────────────────────────────────────────┘
```

### 2.2 Decisões de interação

1. **Um padrão só para os três eixos: `Switch` "Só em…".** Desligado = sem restrição naquele
   eixo (NULL). É o padrão que `FormVigencia` já usa para o horário ("Só em um horário do dia",
   `FormVigencia.tsx:403-411`), estendido para dias e período. O lojista aprende uma regra e a
   aplica três vezes. Rótulo do estado desligado, em texto `text-muted-foreground` ao lado:
   "Todos os dias" / "O dia todo" / "Sempre".
2. **Dias, D13 literal:**
   - Switch desligado ⇒ `dias_semana: null` ("Todos os dias").
   - Switch ligado ⇒ `PilulasDeDias` controlado; o array vai como está.
   - **Ligado e nenhuma pílula marcada ⇒ `[]`**, com a legenda neutra (não erro, não vermelho):
     > **Nunca disponível.** O item fica visível na vitrine, sem vender. Marque os dias em que
     > ele aparece.

     Na categoria: "…Todos os itens da categoria ficam visíveis, sem vender. Marque os dias em
     que ela aparece."
   - **Ao ligar o switch, as pílulas começam vazias** (o estado mostra "Nunca disponível" até a
     primeira marcação). Motivo: o caso comum é "só sábado", e desmarcar 6 de 7 custa mais que
     marcar 1. Começar com as 7 marcadas também faria a chave recém-ligada voltar a ser NULL
     ao salvar sem mudança. A legenda aparece na hora e diz o que fazer, então a transição não
     assusta.
   - 7 marcadas: a normalização vira NULL no servidor (D2). Na reabertura, o switch aparece
     desligado. Isso é esperado e não pede aviso.
   - `PilulasDeDias` **não compacto** dentro do dialog: 4+3 no mobile, 7 em linha a partir de
     `sm`. O compacto (7×40px + 6×4,8px = 308,8px) **não cabe** nos 296px úteis do dialog em
     360px (`w-[calc(100vw-2rem)]` menos `px-4`). O componente continua "burro": quem traduz
     vazio = nunca é o `EditorFrequencia`, e o comentário `vazio = sem restrição` de
     `PilulasDeDias.tsx:25` continua verdadeiro para os outros consumidores.
3. **Horário:** `Input type="time"` ×2, cada um com `<Label>` ("Das" / "às") e 44px literal,
   copiado de `FormVigencia.tsx:413-435`. A dica sobre a ponta exclusiva (S2) evita o "por que
   às 15:00 já sumiu?". Erro `MSG_HORA_PAR` / `MSG_HORA_ORDEM` embaixo, com `aria-invalid` +
   `aria-describedby`.
4. **Período:** `Input type="date"` ×2 ("De" / "Até"), **cada ponta opcional** (D3). Dica:
   "Preencha só uma das datas para valer a partir de um dia, ou até um dia. As duas datas
   entram." Erro novo `MSG_PERIODO_ORDEM`. Proposta de texto: "A data de fim não pode ser antes
   da de início." (fim = início é válido, então "precisa ser depois", de `MSG_PRAZO_ORDEM`, não
   serve).
5. **Resumo ao vivo** no topo (`aria-live="polite"`), com a mesma `rotuloFrequencia` pura que
   gera o chip da linha. Assim o lojista lê, antes de salvar, exatamente o que a lista vai
   mostrar. Todos os eixos desligados ⇒ "Sempre disponível".
6. **Aviso RN-1 ao vivo** (desvio consciente do C8). O C8 diz "aviso RN-1 vindo pronto do
   servidor". Esse aviso descreve o **estado salvo**, e no dialog o que importa é o
   **rascunho**: o lojista marca "só sáb" e deve ver na hora que isso não bate com a categoria
   seg–sex. `avisoFrequenciaQueNuncaAbre(produto, categoria)` é pura e não usa `agora`, e a
   frequência da categoria já chega ao cliente em `FrequenciasDoPainel.categorias[id].frequencia`.
   Logo, o editor chama a mesma função sobre o rascunho. Não há risco: é aviso de UX, não
   decide compra. A lista continua mostrando o aviso do servidor. **Se o `arquitetar` preferir
   manter o C8 literal**, o dialog mostra o aviso salvo ao abrir e o esconde assim que o
   rascunho muda. Nunca mostrar o aviso salvo sobre um rascunho diferente.
7. **Período encerrado no dialog:** quando `periodo_fim` < hoje da loja, aparece o texto de
   `avisoPeriodoEncerrado`. O "hoje da loja" vem da página (servidor), como o `agora` de
   `projetarPromocaoDoPainel`. O browser não calcula fuso.
8. **Fuso nomeado** ("Horários e datas no fuso da loja (Horário de Brasília).") reusa o
   `fusoRotulo` que `FormVigencia` já recebe.
9. **Footer:** `DialogFooter` com `Cancelar` (outline) + `Salvar` (default), ambos
   `min-h-[44px]`, `flex-1` no mobile. No submit: botão com `Loader2` + "Salvando…", campos
   `disabled`. Sucesso: `toast.success("Frequência salva.")`, fecha, `router.refresh()`. Erro:
   `toast.error(erro)`, **o dialog fica aberto com o rascunho intacto** (retry = clicar de
   novo).
10. **Dialog de 360px com conteúdo alto:** o `DialogContent` já tem
    `max-h-[calc(100dvh-2rem)] overflow-hidden flex-col`. O corpo recebe
    `overflow-y-auto min-h-0 flex-1` e o footer fica fora dele, sempre visível.

### 2.3 Variante seleção (N produtos)

```
│ Frequência de exibição                    ✕  │
│ 5 produtos selecionados                      │
│ ┌─────────────────────────────────────────┐  │
│ │ ⓘ Os produtos selecionados têm          │  │  só quando divergem
│ │   frequências diferentes. A que você    │  │
│ │   salvar aqui substitui a de todos.     │  │
│ └─────────────────────────────────────────┘  │
│ …mesmo editor…                               │
│ [ Cancelar ] [ Aplicar a 5 produtos ]        │
```

- Todos com a mesma frequência ⇒ o editor abre preenchido com ela e sem a nota.
- Divergem ⇒ o editor abre com tudo desligado (permanente), e a nota diz que salvar
  **substitui**. É o comportamento da RPC (grava as 5 chaves).
- O rótulo do botão tem o número ("Aplicar a 5 produtos"): o lojista confirma lendo o alcance,
  como no `DialogoLoteCardapio`.
- Aviso RN-1 ao vivo **não** aparece na seleção (N categorias, N avisos). Depois de aplicar, os
  avisos aparecem nas linhas (servidor). Toast de sucesso: "Frequência aplicada a 5 produtos."
  Ao sair, o modo seleção termina e limpa a seleção (mesmo `sairDoModoSelecao`).

### 2.4 Variante categoria

Mesmo dialog, com descrição "Categoria Almoço executivo" e a nota fixa:
"Vale para todos os produtos desta categoria, junto com a frequência de cada um."
(RN-1 em linguagem de lojista). O aviso é o de `avisoCategoriaQueNuncaAbre`.

---

## 3. Grade produto × dia (`GradeFrequencia`), com "Salvar tudo"

### 3.1 Entrada e saída: modo de tela, igual a "Reordenar"

- "Dias da semana" na barra do topo liga `modoGrade`. É a **troca de BARRA** do
  `modoReordenar`: "Novo produto", "Selecionar" etc. **somem** (não ficam `disabled`), e a
  listagem dá lugar à grade.
- Barra do modo = mesma casca de `BarraSelecaoLote` (`fixed inset-x-0 bottom-0 min-h-[64px]` no
  mobile, `sm:sticky sm:top-0` no desktop):

```
┌──────────────────────────────────────────────────────────┐
│ 3 alterações não salvas         [Cancelar] [Salvar tudo] │
└──────────────────────────────────────────────────────────┘
```

  - Contagem `aria-live="polite"`. "Nenhuma alteração" com 0, e aí `Salvar tudo` fica
    `disabled` (a contagem visível ao lado explica o motivo; não é botão inerte sem contexto).
  - **Cancelar / Escape** sem alteração ⇒ sai direto. **Com alteração** ⇒ `AlertDialog`
    "Descartar 3 alterações?" / "Os dias marcados nesta grade ainda não foram salvos." /
    `[Continuar editando]` `[Descartar]` (destrutivo em `variant="destructive"`). Não está
    aninhado em outro dialog, então `AlertDialog` é o certo (design-system §6).
  - **Salvar tudo:** `Loader2` + "Salvando…", pílulas `disabled`. Sucesso ⇒
    `toast.success("Dias salvos em 3 produtos.")`, sai do modo, `router.refresh()`. **Erro ⇒
    toast com `description` "Nenhum produto foi alterado. Tente de novo."** (RN-6: é tudo ou
    nada, e o lojista precisa saber que não ficou meio salvo). A grade **continua no modo, com o
    rascunho intacto**, e `Salvar tudo (3)` serve de retry.

### 3.2 Linha da grade

```
Almoço executivo  (◷ seg a sex · 11:00–15:00)       ← cabeçalho de grupo (leitura)
────────────────────────────────────────────────────
Feijoada completa                    [Alterado]
(◷ 11:00–15:00, horário não muda aqui)
[Dom][Seg][Ter][Qua]                                ← mobile 4+3
[Qui][Sex][Sáb]
⚠ Este item nunca vai ficar disponível: …           ← RN-1 ao vivo
────────────────────────────────────────────────────
Suco do dia                          Nunca disponível
[Dom][Seg][Ter][Qua]    (nenhuma marcada)
[Qui][Sex][Sáb]
```

Desktop (`sm+`), a mesma árvore: nome à esquerda (`flex-1 min-w-0`), 7 pílulas à direita em
uma linha. Como todas as linhas têm a mesma largura de pílulas, as colunas se alinham e a
grade lê como matriz, sem `<table>` e sem cabeçalho de coluna (cada pílula já diz o dia).

- **Uma instância de `PilulasDeDias` não compacto por produto.** Sem componente novo de célula.
  No mobile, 4+3 com 44×44 nos dois eixos; em `sm+`, 7 em linha.
  - **Por que não o compacto (7 em linha no mobile):** a linha útil do card na lista mede
    321,6px (360 − `px-4` do `<main>` a 19,2px) − 38,4px (`px-4` da linha) = **283,2px**, e o
    compacto precisa de 308,8px. Não cabe sem tirar padding da linha, o que desalinha a grade.
    O custo do 4+3 é altura (~140px por produto no mobile). Para mudanças em muitos produtos
    de uma vez, o caminho mobile é a seleção múltipla (§4).
- **Tradução do estado na grade** (é o `EditorFrequencia` da grade, em `gradeFrequencia.ts`):
  - `null` (todo dia) ⇒ exibe as 7 marcadas; legenda à direita "Todo dia".
  - `[]` ⇒ nenhuma marcada; legenda "Nunca disponível" (texto, não só cor).
  - 7 marcadas ⇒ `null` no payload; 0 marcadas ⇒ `[]` (RN-8, sem erro).
  - "Alterada" compara **normalizado** (`null` ≠ `[]`, `[1,2]` = `[2,1]`). Uma linha `null`
    intocada exibe 7 marcadas e **não** entra no payload.
- **Marca de alterado:** `Badge variant="secondary"` "Alterado" + borda esquerda de 3px
  (`border-l-amber-500`). Texto e forma, não só cor. Voltar a linha ao valor salvo remove a
  marca e desconta o contador.
- **A grade só escreve dias** (D6: a RPC da grade grava só `dias_semana`, para não atropelar a
  edição de outra aba). Por isso o horário e o período do produto aparecem como chip **de
  leitura** sob o nome, com a nota "(horário não muda aqui)". Quem quiser mudar usa o kebab →
  "Frequência de exibição", fora do modo.
- **Cabeçalho do grupo** mostra a frequência da categoria (leitura) e, se oculta, o badge
  "Oculta da vitrine". É o contexto para o RN-1: o lojista vê "seg a sex" em cima enquanto
  marca "Sáb" embaixo.
- **Aviso RN-1 por linha, ao vivo**, sobre o rascunho, com a mesma função pura
  (`avisoFrequenciaQueNuncaAbre` com os dias do rascunho + hora/período salvos + frequência da
  categoria). Não bloqueia o salvar: RN-1 **avisa**, não proíbe.
- Grupo "Sem categoria" entra na grade (sem cabeçalho de frequência). Categoria oculta também
  entra: o lojista pode preparar os dias antes de mostrar a categoria.

---

## 4. Seleção múltipla + aplicar a mesma frequência (`BarraSelecaoFrequencia`)

Mesmo modo seleção de hoje (260): checkbox de 44px por linha, "Selecionar os 12" / "Limpar" no
cabeçalho do grupo e a linha comprimida (kebab, botões e chips somem no modo). Muda só a barra:

```
mobile (fixed bottom, min-h 64px)
┌─────────────────────────────────────────────┐
│ 5 produtos selecionados                     │
│ [Definir frequência…] [Limpar] [Cancelar]   │
└─────────────────────────────────────────────┘
```

- **"Definir frequência…"** (`variant="default"`, é a única ação do modo) abre o
  `DialogoFrequencia` variante N (§2.3). As reticências indicam que abre um dialog.
- Contagem com `aria-live="polite"`, "Nenhum produto selecionado" com 0 e ação `disabled`.
  Mesma régua `ALVO` de `BarraSelecaoLote.tsx:18`.
- `Limpar` (ghost) e `Cancelar` (ghost), mesmas semânticas da barra de hoje.
- Casca fina e separada, como o C8 decidiu. Não generaliza `BarraSelecaoLote`, que fica como
  código morto de cardápio (S5).

---

## 5. Categorias: ocultar/mostrar + frequência (`GerenciarCategorias`, ADAPTAR)

O Sheet de categorias ganha dois controles por linha. A linha atual (nome + texto + Switch de
imagens + 2 ícones `size="icon-sm"`) já não cabe no Sheet de 360px (`w-3/4` = 270px) e tem os
alvos de 33,6px da **issue 291**. A proposta reorganiza a linha **e fecha a 291 junto**:

```
┌ Categorias de produto ──────────────────── ✕ ┐
│ Nova categoria [______________] [Adicionar]  │
│──────────────────────────────────────────────│
│ Almoço executivo                        [⋮]  │  ⋮ = Renomear / Remover (44px)
│ (◷ seg a sex · 11:00–15:00)                  │
│ [◷ Frequência…                           ]   │  Button outline, w-full, 44px
│ [●━] Mostrar na vitrine                      │  Switch + Label visível, 44px
│ [●━] Mostrar imagens                         │  Switch existente, agora com Label
│──────────────────────────────────────────────│
│ Sobremesas                              [⋮]  │
│ (◉̸ Oculta da vitrine)                        │
│ [◷ Frequência…                           ]   │
│ [━○] Mostrar na vitrine                      │
│ [●━] Mostrar imagens                         │
│──────────────────────────────────────────────│
│ Especiais de Natal                      [⋮]  │
│ (◷ 01/12 a 24/12)                            │
│ ⚠ Período encerrado em 24/12: não aparece   │
│   mais na vitrine. Mude o período para       │
│   voltar a vender.                           │
│ …                                            │
└──────────────────────────────────────────────┘
```

- **"Mostrar na vitrine"**: o Switch fica **ligado quando a categoria está visível**
  (`checked = !oculta`), para que ligado sempre signifique "aparece", o mesmo sentido de
  "Mostrar imagens". Um switch "Ocultar" ligado para esconder inverteria o modelo mental dentro
  do mesmo card. Otimista com rollback, no mesmo molde do `alternarExibirImagens`
  (`GerenciarCategorias.tsx`).
- **Sem confirmação ao ocultar:** a ação é reversível e imediata. Em troca, o feedback tem
  desfazer: `toast("Sobremesas oculta da vitrine.", { action: { label: "Desfazer", … } })`
  (sonner). Mostrar dá `toast.success("Sobremesas visível na vitrine.")`.
- **"Frequência…"** abre o `DialogoFrequencia` variante categoria (§2.4). Sheet e Dialog não
  ficam aninhados: o Sheet fecha antes, ou o Dialog abre por cima. Os dois são Base UI com foco
  preso, e **Escape fecha só o de cima**. Se `executar` notar vazamento de Escape (a armadilha
  descrita em design-system §6), fecha o Sheet antes de abrir o Dialog.
- **Labels visíveis** nos dois switches (`<Label className="flex min-h-[44px] items-center
  gap-3">`, padrão `FormVigencia.tsx:403`). O texto "Imagens visíveis/ocultas" `aria-hidden` de
  hoje sai: o `Label` passa a ser o nome acessível.
- **Renomear/Remover no kebab** (`Menu`, trigger 44×44). Remover continua com a confirmação que
  já tem. Salvar/Cancelar da edição inline de nome passam de `size="icon-sm"` para
  `min-h-[44px] min-w-[44px]`, exatamente a correção proposta pela 291.
- **Escopo:** isto é mudança de layout do `GerenciarCategorias`, exigida pelos dois controles
  novos. Não proponho mais nada no Sheet.

---

## 6. Vitrine: estado indisponível (mobile-first)

**Não nasce componente nem motivo novo.** O produto fora da frequência chega com
`compravel=false` e `motivoNaoCompravel="fora_da_janela"` (D8), e as quatro superfícies que já
tratam isso (`CardProduto`, `ItemProdutoLista`, `ProdutoModal`, revisão do carrinho) usam
`rotuloEsgotado.ts`. Só o texto muda, e ele vem de `rotulosVigencia[id]`
(`rotuloForaDaFrequencia`, teto de 32 caracteres):

| Situação (visita num sábado às 12:00) | Texto na pílula |
|---|---|
| Categoria seg a sex, produto sem restrição | "Só seg a sex" |
| Produto das 18:00 às 23:00 | "Das 18:00 às 23:00" |
| Produto com período começando em 01/12 | "A partir de 01/12" |
| Produto (ou categoria) com `dias_semana = []` | "Indisponível no momento" |
| Produto com período encerrado (RN-7) | **ausente** da vitrine |
| Categoria oculta ou encerrada | **ausente**, com todos os produtos |

- A categoria fora da frequência continua com o título de seção (`SecaoCatalogo`) e todos os
  cards com overlay cinza + pílula (RN-2). Não recebe cabeçalho próprio: a pílula de cada item
  já diz quando volta.
- Grade (`CardProduto`): overlay `bg-black/35` + grayscale, pílula `--indisponivel-*` (18,9:1),
  "+" `disabled` com `pointer-events-none`, e **o card continua abrindo o modal** (262). No modal,
  CTA "Produto indisponível" `disabled` (`rotuloCtaNaoCompravel`).
- Lista (`ItemProdutoLista`, categoria com `exibir_imagens=false`): linha com `opacity-60`, a
  pílula quebra para a linha de baixo inteira (`flex-wrap`), e a linha não abre (D13).
- Leitor de tela: "Feijoada completa — Só seg a sex" (`rotuloAcessivelNaoCompravel`), sem
  mudança.

### 6.1 Achado (MÉDIO): a pílula do card trunca justamente a informação nova

Em 360px o card mede ~151px (`grid-cols-2`, gap e `px-4` a 19,2px). A pílula tem
`max-w-[calc(100%-16px)]` ≈ 135px e `truncate whitespace-nowrap`, com `text-sm` (16,8px)
`font-extrabold uppercase tracking-wide` e `px-[18px]`. Sobram ~99px para o texto, e as frases
novas passam disso:

- "SÓ SEG A SEX" ≈ 140px ⇒ "SÓ SEG…"
- "DAS 18:00 ÀS 23:00" ≈ 210px ⇒ "DAS 18:…"

Com o cardápio sazonal isso já acontecia ("o corte é visual; a frase inteira está no
`aria-label` e no modal", `CardProduto.tsx:122-127`). Mas a frase de cardápio era um
complemento. Aqui **ela é a resposta** à pergunta que o cliente tem na hora ("quando posso
pedir?"), e o corte come o horário final. O mockup mostra lado a lado:

- **Hoje:** uma linha, `truncate`.
- **Proposta (mínima):** só na pílula do motivo `fora_da_janela`, trocar `truncate
  whitespace-nowrap` por `whitespace-normal text-center leading-tight line-clamp-2` e baixar a
  fonte de `text-sm` para `text-xs` (14,4px, ainda ≥ texto grande de contraste por ser 18,9:1).
  Cabe em duas linhas sem cobrir o prato, e o "ESGOTADO" (curto) fica idêntico. É mudança de
  classe em `CardProduto.tsx:128`, dentro do escopo da 323 (vitrine), candidata a `/polir`
  dentro do P5.

Se o `executar` achar que isso é redesenho, o fallback aceitável é deixar como está: a frase
inteira segue no modal e no leitor de tela. Registro como MÉDIO, não bloqueante.

### 6.2 Achado pré-existente (BAIXO, fora do escopo)

O "+" do `CardProduto` é `h-8 w-8` = 38,4px na base de 120% (o comentário do arquivo diz 44×44).
O card inteiro também é alvo (abre o modal), então o toque não se perde, mas o botão em si fica
abaixo da régua. Não mexer nesta issue. Vale uma linha em `tasks/` se ninguém tiver registrado.

---

## 7. Copy (todas no imperativo quando pedem ação)

| Onde | Texto |
|---|---|
| Legenda de dias vazios (produto) | **Nunca disponível.** O item fica visível na vitrine, sem vender. Marque os dias em que ele aparece. |
| Legenda de dias vazios (categoria) | **Nunca disponível.** Todos os itens da categoria ficam visíveis, sem vender. Marque os dias em que ela aparece. |
| Dica de horário | O horário de fim não entra: das 11:00 às 15:00 vende até 14:59. |
| Dica de período | Preencha só uma das datas para valer a partir de um dia, ou até um dia. As duas datas entram. |
| Fuso | Horários e datas no fuso da loja ({fusoRotulo}). |
| Aviso RN-1 / RN-7 | textos do C7 (`avisoFrequenciaQueNuncaAbre`, `avisoCategoriaQueNuncaAbre`, `avisoPeriodoEncerrado`) |
| `MSG_PERIODO_ORDEM` (proposta) | A data de fim não pode ser antes da de início. |
| Seleção divergente | Os produtos selecionados têm frequências diferentes. A que você salvar aqui substitui a de todos. |
| Categoria (nota) | Vale para todos os produtos desta categoria, junto com a frequência de cada um. |
| Categoria oculta (lista) | Os 6 produtos desta categoria não aparecem para o cliente. Mostre a categoria em "Categorias" para voltar a vender. |
| Grade, erro | Não foi possível salvar a frequência. · Nenhum produto foi alterado. Tente de novo. |
| Grade, descartar | Descartar 3 alterações? · Os dias marcados nesta grade ainda não foram salvos. |
| Toasts | Frequência salva. · Frequência aplicada a 5 produtos. · Dias salvos em 3 produtos. · Sobremesas oculta da vitrine. [Desfazer] |

Nenhuma frase começa com "Sem…" ou "Caso não…".

---

## 8. Componentes: reusar × criar

| Peça | De onde | Observação |
|---|---|---|
| `Dialog`, `DialogContent/Header/Title/Description/Footer` | `ui/dialog` | editor; corpo com `overflow-y-auto` |
| `AlertDialog` | `ui/alert-dialog` | só "Descartar alterações?" da grade |
| `Switch` + `Label` | `ui/switch`, `ui/label` | os 3 eixos; "Mostrar na vitrine"; "Mostrar imagens" |
| `Input type="time"/"date"` | `ui/input` | 44px literal, `w-auto` |
| `Badge` (`outline`/`secondary`) | `ui/badge` | chip de frequência, "Oculta da vitrine", "Nunca disponível", "Alterado" |
| `Button` | `ui/button` | 44px literal; nunca `size="icon-sm"` |
| `Menu*` | `ui/menu` | kebab do produto (+1 item) e da categoria (novo) |
| `Checkbox` | `ui/checkbox` | modo seleção, sem mudança |
| `Sheet` | `ui/sheet` | `GerenciarCategorias`, sem mudança de primitivo |
| `PilulasDeDias` | `painel/` | não compacto no dialog e na grade; **sem prop nova** |
| casca da barra | `BarraSelecaoLote` | copiar classes e `ALVO`, não generalizar (C8) |
| `rotuloEsgotado.ts`, `CardProduto`, `ItemProdutoLista`, `ProdutoModal` | `vitrine/` | sem mudança de lógica; só a classe da pílula (6.1, opcional) |
| `sonner` | lib | toasts, incluindo `action` "Desfazer" |

**Não gerar nada via CLI.** `toggle-group` foi considerado para os dias e descartado:
`PilulasDeDias` já resolve com roving tabindex e régua de 44px, e um segundo componente de dia
seria a terceira variante.

**Novos (todos composição, em `components/painel/`, nomes do C8):** `EditorFrequencia`,
`DialogoFrequencia`, `GradeFrequencia` + `gradeFrequencia.ts` (puro), `BarraSelecaoFrequencia`.

---

## 9. Acessibilidade (checklist WCAG 2.1 AA desta tela)

- Alvos 44px literais: pílulas não compactas, switches com `Label` de 44px de altura, inputs
  de hora/data, botões de barra/footer, itens de menu, checkbox do modo seleção.
- Cada eixo é um `<fieldset>` com `<legend>` ("Dias da semana", "Horário", "Período"). O
  `PilulasDeDias` recebe `rotulo="Dias em que {nome} aparece"`, e o grupo nunca é anônimo.
- Na grade, `rotulo` por linha = "Dias de {nome}". Roving tabindex mantém **uma** parada de Tab
  por produto (7N paradas seriam armadilha).
- Legenda "Nunca disponível" ligada às pílulas por `descritoPor`.
- Resumo e contadores com `aria-live="polite"`. Avisos estáticos da lista **sem**
  `role="alert"` (ver 1.1).
- Estado nunca só por cor: "Oculta da vitrine" (ícone + texto), "Alterado" (texto + borda),
  "Nunca disponível" (texto), pílula da vitrine (texto sobre preto 18,9:1).
- Foco: fechar o dialog devolve o foco ao gatilho (Base UI). Sair do modo grade devolve o foco
  ao botão "Dias da semana", como `sairDoModoSelecao` faz com "Selecionar".
- Contraste: `text-amber-700` 5,0:1; `muted-foreground` `#737373` 4,7:1 sobre branco; borda do
  card `#8a8a8a` 3,45:1 (§10).

---

## 10. Fora do escopo (registrado, não proposto)

- Atalhos "Seg a sex" / "Fim de semana" no editor.
- Marcar uma coluna inteira da grade ("Sáb para toda a categoria").
- Grade por dia no mobile (abas Dom..Sáb, uma coluna por vez).
- Subtítulo "Disponível só seg a sex" no título de seção da vitrine (pede projeção nova).
- `badgeStatus` refletir janela/período.
