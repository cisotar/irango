# Spec: Botão "+ Novo produto" no título de cada categoria

**Versão:** 0.1.0 | **Atualizado:** 2026-07-10

## Visão Geral

Adiciona um botão **"+ Novo produto"** na barra de título de cada card de categoria
na página de Produtos do painel, à direita do controle **"Opcionais"** já existente
no header do card. Ao clicar, abre o **mesmo modal de novo produto** que o botão
global "Novo produto" do topo já usa (`FormProduto`, em `Dialog` no desktop /
`Sheet` no mobile), porém com o **campo Categoria já pré-selecionado** com a
categoria do card.

A pré-seleção é **apenas valor inicial** do select — o lojista pode trocar a
categoria normalmente antes de salvar. O botão global do topo **continua existindo**
e abre o modal **sem** categoria pré-selecionada.

Objetivo de UX: reduzir atrito. Hoje o lojista sempre abre um modal "cru" e precisa
escolher a categoria toda vez; com o botão no card, o contexto ("estou preenchendo a
categoria X") vira a pré-seleção, sem tirar a liberdade de mudar.

**Em qual mundo vive:** **painel do lojista (auth obrigatório)**, rota
`/painel/produtos`. É **UI pura** — não há dado autoritativo novo, valor monetário,
migration nem RLS nova. A criação em si continua na Server Action `criarProduto`
existente, que já valida `categoria_id` no servidor.

---

## Atores Envolvidos

- **iRango (SaaS):** nenhuma mudança de contrato. A Server Action `criarProduto`
  (`lib/actions/produto.ts`) continua sendo a autoridade: deriva `loja_id` do dono,
  revalida o payload com `schemaProduto` e **confere a posse da `categoria_id`**
  (`categoriaPertenceALoja`) — a pré-seleção vinda do cliente é só sugestão de UI.
- **Lojista:** clica em "+ Novo produto" no header de uma categoria e vê o modal
  abrir já com aquela categoria selecionada; pode trocar a categoria e salvar. Também
  continua podendo usar o botão global do topo (sem pré-seleção).
- **Cliente (vitrine):** **não participa** — feature só do painel.

---

## Páginas e Rotas

### Produtos (painel do lojista) — `/painel/produtos`

**Mundo:** painel (auth obrigatório) — escopo `auth.uid() = lojas.dono_id`
(RLS `produtos_escrita_propria` / `categorias_*`).

**Descrição:** a página já lista os produtos agrupados por categoria em cards
(`agruparPorCategoria`, `ProdutosClient.tsx`), com o header de cada card contendo o
título da categoria e, quando `grupo.id != null`, o botão **"Opcionais"**
(`SlidersHorizontal`). Esta feature acrescenta, **à direita do "Opcionais"**, um botão
**"+ Novo produto"**. Clicá-lo abre o modal único de produto em **modo criar** com o
select "Categoria" pré-preenchido com a categoria daquele card.

O botão **não** aparece no grupo sintético **"Sem categoria"** (`id === null`) — a
mesma condição `grupo.id != null` que já esconde "Opcionais" esconde este botão.
Motivo: criar produto sem categoria já é exatamente o que o botão global faz; um botão
no card "Sem categoria" seria redundante (pré-seleção vazia = comportamento global).

**Componentes:** (todos reuso — nenhum componente ou action novo)
- `ProdutosClient.tsx` (`app/(painel)/painel/(bloqueavel)/produtos/`) — **estender**.
  Único arquivo com mudança de comportamento. Ganha:
  - um estado novo `categoriaNovoProduto: string | null` (id da categoria pré-selecionada
    ao abrir o modal; `null` = criar global sem pré-seleção);
  - um handler `abrirCriarNaCategoria(categoriaId: string)` que faz
    `setCategoriaNovoProduto(categoriaId)`, `setEmEdicao(null)`, `setFormAberto(true)`;
  - ajuste em `abrirCriar()` (botão global) para **zerar** `categoriaNovoProduto`
    (`setCategoriaNovoProduto(null)`) antes de abrir — garante que o global nasce vazio
    mesmo após um uso prévio do botão de card;
  - reset de `categoriaNovoProduto` para `null` no fechamento/sucesso (`aoSalvar`,
    `onOpenChange` do Dialog/Sheet) para não vazar seleção obsoleta.
- `Button` (`components/ui/button.tsx`) — **reuso** do primitivo `@base-ui/react` já
  usado na página (não gerar via `npx shadcn add`, que puxa Radix — memória do
  projeto). Mesmas `variant="ghost" size="sm"` do botão "Opcionais" ao lado, para
  paridade visual no header.
- `Plus` (`lucide-react`) — **reuso**; já importado em `ProdutosClient.tsx` (usado no
  botão global). Mesmo ícone do botão global, coerência visual.
- `FormProduto.tsx` (`components/painel/`) — **sem mudança de contrato.** Já aceita
  `inicial?: ProdutoInicial` e usa `inicial?.categoria_id ?? ""` como estado inicial
  do select; `ehEdicao = inicial?.id != null`. Passar `inicial={{ categoria_id }}`
  **sem `id`** mantém o modo criar com a categoria pré-selecionada. Nenhuma prop nova.

**Detalhe de implementação — `inicial` e a `key` de remount:**
Hoje o `inicial` do `FormProduto` é `emEdicao ? {…} : undefined`. Passa a ser: em
edição, inalterado; em criar, `categoriaNovoProduto != null ? { categoria_id:
categoriaNovoProduto } : undefined`. Como `categoria_id` é o único campo e não há `id`,
o form permanece em **modo criar** com o select pré-selecionado.

A `key` atual `key={emEdicao?.id ?? "novo"}` **precisa incluir a categoria
pré-selecionada** — ex.: `key={emEdicao?.id ?? \`novo-${categoriaNovoProduto ?? ""}\`}`.
Sem isso, abrir o global (key `"novo"`), fechar e abrir o botão do card (ainda key
`"novo"`) **não remonta** o `FormProduto`; como o `useState(inicial?.categoria_id ??
"")` só lê o valor inicial na montagem, o select **não** refletiria a nova pré-seleção.
Incluir `categoriaNovoProduto` na key força o remount entre aberturas com categorias
diferentes (e entre global ↔ card), reinicializando o select corretamente. (RN-3.)

**Layout mobile:** o header do card (`CardHeader` com `flex-row items-center
justify-between`) já pode apertar em telas estreitas com "Opcionais" + novo botão à
direita. O desenho deve garantir que título e o par de botões não estourem: o título
já trunca; considerar rótulo curto/ícone-only do botão em `sm` (ver RN-5) e o alvo de
toque ≥44px. Consultar `desenhar` / `design-claude/` (fonte única do visual) antes de
fechar o layout final.

**Behaviors:**
- [x] Ver o botão "+ Novo produto" no header de **cada** card de categoria real,
  à direita de "Opcionais". Garantido em: **cliente (UI)** — renderização condicionada
  a `grupo.id != null`, sem dado novo.
- [x] **Não** ver o botão no card "Sem categoria" (`grupo.id === null`). Garantido em:
  **cliente (UI)** — mesma guarda `grupo.id != null` do botão "Opcionais".
- [x] Clicar em "+ Novo produto" de uma categoria abre o modal único em **modo criar**
  (título "Novo produto") com o select "Categoria" pré-preenchido com aquela categoria.
  Garantido em: **cliente (UI)** — estado `categoriaNovoProduto` alimenta `inicial=
  { categoria_id }` (sem `id`) do `FormProduto`; `key` inclui a categoria para remontar.
- [x] Trocar a categoria no select depois de aberto e salvar em outra categoria.
  Garantido em: **cliente (UI)** para a troca; **Server Action + RLS** para a criação —
  a categoria final é reavaliada por `criarProduto` (posse cross-loja + RLS).
- [x] Clicar no botão **global** "Novo produto" do topo abre o modal com o select
  **vazio** ("Sem categoria" selecionado), sem pré-seleção. Garantido em: **cliente
  (UI)** — `abrirCriar()` zera `categoriaNovoProduto` → `inicial` fica `undefined`.
- [x] Salvar o produto criado a partir do card. Garantido em: **Server Action + RLS** —
  `criarProduto` deriva `loja_id` do dono (nunca do payload), revalida `schemaProduto`
  e confere a posse da `categoria_id` via `categoriaPertenceALoja` (defesa cross-loja);
  RLS `produtos_escrita_propria` é a última linha. A pré-seleção do cliente **não** é
  autoritativa.
- [x] Ao fechar o modal (cancelar ou após sucesso), a próxima abertura pelo botão
  global volta a nascer sem pré-seleção. Garantido em: **cliente (UI)** — reset de
  `categoriaNovoProduto` no fechamento/sucesso.

---

## Modelos de Dados

**Nenhuma mudança de schema.** Sem migration, sem coluna nova, sem tabela nova, sem
política RLS nova.

- Tabelas envolvidas apenas em **leitura/escrita já existentes**: `produtos`
  (INSERT via `criarProduto`, sob RLS `produtos_escrita_propria`) e `categorias`
  (leitura da posse via `categoriaPertenceALoja`, sob `categorias_*`) — ver
  `schema.md` e `seguranca.md` §2.
- O campo relevante é `produtos.categoria_id` (`uuid` NULLABLE, FK
  `ON DELETE SET NULL`), inalterado. A pré-seleção só muda o **valor inicial** desse
  campo no formulário do cliente; a persistência já existe.

---

## Regras de Negócio

**RN-1 — Pré-seleção é valor inicial, não trava.** O botão do card apenas
**inicializa** o select "Categoria" com a categoria do card. O lojista pode trocar
para qualquer categoria (ou "Sem categoria") antes de salvar. Camada: **cliente (UI)**
— estado inicial do `useState` do `FormProduto`, editável pelo usuário.

**RN-2 — Botão só em categoria real.** O botão "+ Novo produto" aparece só quando
`grupo.id != null`. O grupo sintético "Sem categoria" (`id === null`) não o recebe
(seria redundante com o botão global). Camada: **cliente (UI)** — mesma guarda do
"Opcionais".

**RN-3 — Remontar o form entre aberturas com contexto diferente.** A `key` do
`FormProduto` deve compor `emEdicao?.id` **e** `categoriaNovoProduto`, para que
alternar entre criar-global e criar-em-categoria (ou entre categorias distintas)
reinicialize o select. Camada: **cliente (UI)** — sem essa key, `useState` inicial não
reflete a nova pré-seleção.

**RN-4 — Autoridade continua no servidor.** Toda criação passa por `criarProduto`,
que deriva `loja_id` do dono, revalida com `schemaProduto` e confere a posse da
`categoria_id` (`categoriaPertenceALoja`) sob RLS. A categoria pré-selecionada no
cliente é sugestão de UI; o servidor rejeita categoria de outra loja
("Categoria inválida."). Camada: **Server Action + RLS**.

**RN-5 — Header não pode estourar no mobile.** Título + "Opcionais" + "+ Novo produto"
convivem no `CardHeader` sem quebrar o layout em telas estreitas (título trunca; alvo
de toque ≥44px; rótulo pode encurtar/virar ícone-only em `sm`). Camada: **cliente
(UI/CSS)** — validar com `design-claude/` (fonte única do visual) e `desenhar`.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não. Nenhuma PII, chave Pix ou cupom. O único dado
  novo trafegado é uma `categoria_id` (UUID) como **valor inicial de UI** — já pública
  no contexto do painel do próprio dono.
- **Valor monetário?** **Não há.** Nada de preço/frete/desconto nesta feature. O
  `preco` do produto continua sendo digitado no `FormProduto` e revalidado por
  `schemaProduto` na Server Action, exatamente como hoje — **inalterado**.
- **Recálculo/validação no servidor.** A pré-seleção de categoria **não é
  autoritativa**: `criarProduto` já (a) deriva `loja_id` do dono e nunca do payload,
  (b) revalida `schemaProduto`, (c) confere a posse da `categoria_id` via
  `categoriaPertenceALoja` (defesa cross-loja explícita, porque a RLS de `produtos` só
  checa `produtos.loja_id`, não a posse da categoria). Enviar a `categoria_id` de outra
  loja pelo cliente é rejeitado ("Categoria inválida."). Nenhuma mudança de action é
  necessária — apenas confirmar que o caminho existente cobre o novo ponto de entrada.
- **Tabela nova?** Não. **Nenhuma política RLS nova.** As policies de `produtos` e
  `categorias` já cobrem os dois acessos usados (`seguranca.md` §2).
- **API externa com key?** Não. Zero rede externa, zero chave, zero custo variável.
- **Superfície cross-tenant.** O botão do card só pré-seleciona categorias do próprio
  card (que são da própria loja, carregadas sob RLS). Ainda que o cliente forjasse
  outra `categoria_id`, o servidor barra (RN-4). Não há caminho de escrita em loja de
  terceiro por esta feature.

---

## Testes (pedido do spec)

Feature **não-crítica** (UI pura, sem dinheiro/RLS/token) → **sem TDD red-first
obrigatório**. Ainda assim, adicionar **teste de componente** cobrindo a derivação
central, dentro da infra de teste que o projeto já usa (vitest `environment=node` +
`renderToStaticMarkup`; o projeto **não** tem jsdom/@testing-library/react — ver o
cabeçalho de `ProdutosClient.test.tsx`). Cobrir:

1. **`FormProduto` em modo criar com categoria pré-preenchida** (novo caso em
   `src/components/painel/FormProduto.test.tsx`): renderizar com
   `inicial={{ categoria_id: "cat-x" }}` (sem `id`) e provar que o `<select
   id="produto-categoria">` marca a `<option value="cat-x">` como selecionada e que o
   título/modo é **criar** (não edição). É o coração da feature e é 100% testável por
   markup estático (o `<select value={categoriaId}>` é DOM nativo).
2. **Botão global → select vazio**: renderizar `FormProduto` sem `inicial` (ou
   `inicial` sem `categoria_id`) e provar que a `<option value="">` ("Sem categoria")
   é a selecionada.
3. **Presença/ausência do botão por card** (em `ProdutosClient.test.tsx`): com
   `categorias` reais + um produto sem categoria, provar que o botão "+ Novo produto"
   aparece no header das categorias reais e **não** no grupo "Sem categoria"
   (`grupo.id === null`).

**Interação real (clique no botão do card → modal abre com select pré-preenchido):**
depende de eventos DOM (jsdom/@testing-library/react), **infra que o projeto ainda não
tem** — mesma lacuna já registrada em `ProdutosClient.test.tsx` para os cliques de
"Ocultar/Disponibilizar". Cobrir por **`verificar` manual** (rodar o painel e clicar)
até essa infra existir; a derivação equivalente fica provada pelos testes 1–3.

---

## Fora do Escopo (v1)

- **Nova prop/contrato no `FormProduto`** — a pré-seleção usa o `inicial.categoria_id`
  já existente; nada de campo novo no form ou no schema.
- **Botão "+ Novo produto" no grupo "Sem categoria"** — omitido por decisão de produto
  (redundante com o botão global). Incluir seria sem pré-seleção, idêntico ao global.
- **Pré-preencher outros campos** (nome, preço, opcionais herdados da categoria) — a
  única pré-seleção é a categoria. Herança de opcionais/valores fica para fase futura,
  se houver demanda.
- **Travar/forçar a categoria** — o select permanece 100% editável (RN-1); não há modo
  "categoria fixa".
- **Paridade no hub admin** (`/admin/assinantes/[lojaId]/produtos`,
  `CardapioAdminClient`) — se desejada, é incremento posterior espelhando este padrão;
  não faz parte desta v1.
- **Reordenar/gerir categorias a partir do header** — continua em "Categorias"
  (`GerenciarCategorias`), inalterado.
</content>
</invoke>
