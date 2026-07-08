# Spec: Toggle de exibir/ocultar imagens de produto por categoria

**Versão:** 0.2.0 | **Atualizado:** 2026-07-08

## Visão Geral

Dá ao lojista um controle **por categoria de produto** para **exibir ou ocultar as
imagens dos produtos daquela categoria na vitrine pública**. Quando ocultada, a
categoria **muda de layout**: em vez do grid de cards com imagem, os produtos
aparecem como **lista textual estilo cardápio** — nome à esquerda, preço à direita,
ligados por linha pontilhada (`item .......... R$ 18,90`). Categorias em que o
lojista não tem foto (ou não quer foto — ex.: cardápio de bebidas, adicionais,
combos textuais) ficam visualmente limpas e mais compactas, sem depender de o
produto ter ou não imagem cadastrada.

O controle é **por categoria**, nunca por produto individual. Cada categoria — já
existente ou recém-criada — tem seu próprio toggle no painel do lojista. Um produto
novo **herda** a preferência da categoria a que pertence; não há toggle por produto.

A preferência é um **dado de servidor**, escopado por loja (RLS de `categorias`).
A vitrine é renderizada por SSR, então o ocultamento é **autoritativo no servidor**:
quando a categoria está em "ocultar", o `foto_url` dos produtos daquela categoria
**não é sequer enviado** ao HTML do cliente — não há CSS-hide nem confiança no
toggle client-side.

**Em qual mundo vive:** dois mundos.
- **Painel (auth obrigatório):** o toggle, na gestão de categorias
  (`/painel/produtos`), e sua paridade admin (`/admin/assinantes/[lojaId]`).
- **Vitrine pública (sem auth):** o efeito — imagens presentes ou substituídas por
  placeholder — em `/loja/[slug]`.

Não há valor monetário nesta feature. O ponto sensível é **escrita escopada por
tenant** (preferência de outra loja) e **enforcement server-side** do ocultamento.

---

## Atores Envolvidos

- **iRango (SaaS):** persiste a preferência (`categorias.exibir_imagens`); **no
  servidor (SSR)** decide se cada `foto_url` é emitido para a vitrine. O dono do SaaS
  pode editar a preferência de qualquer loja pelo hub admin (paridade).
- **Lojista:** liga/desliga o toggle "Exibir imagens dos produtos" em cada categoria,
  na gestão de categorias do painel. Vê o efeito na própria vitrine.
- **Cliente:** vê a vitrine com ou sem imagens conforme a preferência da loja. Não
  opera nada; nunca recebe as URLs de imagem de categorias marcadas como "ocultar".

---

## Páginas e Rotas

### Gestão de categorias (painel do lojista) — `/painel/produtos`

**Mundo:** painel (auth obrigatório) — escopo `auth.uid() = lojas.dono_id`.

**Descrição:** o painel de produtos já abre o `Sheet` de gestão de categorias
(`GerenciarCategorias.tsx`), onde o lojista cria, renomeia e remove categorias. Cada
linha de categoria existente ganha um **Switch "Exibir imagens dos produtos"** ao
lado das ações de renomear/remover. Ligado = imagens aparecem na vitrine; desligado =
imagens da categoria ficam ocultas na vitrine (todos os produtos daquela categoria,
mesmo os que têm foto cadastrada). O bloco "Nova categoria" **não** precisa de campo
de toggle — a categoria nasce com o default (exibir) e o lojista ajusta depois na
própria linha, se quiser.

**Componentes:**
- `GerenciarCategorias.tsx` (`components/painel/`) — **estender** o componente
  existente: renderizar um `Switch` por linha de categoria e um handler
  `alternarExibirImagens(cat)` que chama a action de atualização.
- `Switch` (`components/ui/switch.tsx`) — **reuso**, primitivo base-ui já existente
  (o mesmo usado em `AcoesAssinante`/`ModulosImpressaoAdmin`). **Não** gerar via
  `npx shadcn add` (puxaria Radix errado — memória do projeto).
- `Label`/`Separator` (`components/ui/`) — reuso.
- `alternarExibirImagens(id, exibirImagens)` (`lib/actions/produto.ts`) — **action de
  toggle dedicada, espelhando `alternarOculto`/`alternarDisponibilidade` já existentes**
  (mesmo arquivo). **Não** estende `schemaCategoria`: um toggle dedicado evita clobbar
  a preferência no rename (o patch de rename manda só `nome`/`ordem`) e não quebra os
  call sites de criar/renomear em cascata. `UPDATE categorias SET exibir_imagens`
  escopado por `id`, isolado por RLS `categorias_escrita_propria` (dono).

**Behaviors:**
- [ ] Ver o estado atual do toggle de cada categoria (ligado por default). Garantido
  em: **SSR** — `exibir_imagens` vem em `buscarCategorias` (`.select("*")`) na carga
  do painel; o cliente só renderiza.
- [ ] Ligar/desligar "Exibir imagens dos produtos" de uma categoria e persistir.
  Garantido em: **Server Action + RLS** — `alternarExibirImagens(id, exibirImagens)`
  grava só `exibir_imagens` em `categorias` escopado por `id`, isolado por
  `categorias_escrita_propria` (`auth.uid() = lojas.dono_id`). O valor do toggle no
  cliente é só UX (optimistic); o servidor é a autoridade — não confia no cliente pra
  decidir qual loja/categoria é gravada.
- [ ] Ao criar uma categoria nova, ela já aparece com o toggle disponível e ligado
  (default). Garantido em: **banco (DEFAULT true) + Server Action** — `criarCategoria`
  não precisa enviar o campo; a coluna nasce no default seguro.
- [ ] Ver feedback (`toast`) de sucesso/erro e o switch refletir o novo estado; em
  falha, o switch volta ao estado anterior. Garantido em: cliente (UX) sobre o
  `{ ok }` retornado pela Server Action (autoridade no servidor).

---

### Gestão de categorias (hub admin SaaS) — `/admin/assinantes/[lojaId]`

**Mundo:** painel admin (auth obrigatório) — dono do SaaS editando loja de terceiro;
escopo por tenant via `escopo.atualizar`/action admin, **não** RLS de dono.

**Descrição:** paridade com o painel do lojista
(`specs/paridade-hub-admin-painel.md`). O `GerenciarCategorias` já é parametrizado por
props de action (`onCriar`/`onAtualizar`/`onRemover`, default = action do lojista); a
via admin injeta as variantes `(lojaId, ...)`. O mesmo Switch aparece, gravando na
loja-alvo (`lojaId`), nunca na loja do admin.

**Componentes:**
- `GerenciarCategorias.tsx` — **o mesmo componente**, sem fork; recebe as actions
  admin por prop (paridade já existente).
- `alternarExibirImagensAdmin(lojaId, id, exibirImagens)` (action admin em
  `admin/assinantes/actions/admin-categorias.ts`) — **nova, espelhando
  `atualizarCategoriaAdmin`** do mesmo arquivo, mas sem `schemaCategoria` (payload é um
  único boolean, validado direto). `validarLojaIdAdmin` → `prepararContextoAdmin` →
  `escopo.atualizar("categorias", id, { exibir_imagens })` escopado por tenant; grava
  `exibir_imagens` na loja-alvo (`lojaId` da rota), nunca do payload.

**Behaviors:**
- [ ] Ver e alternar o toggle de imagens da categoria da **loja-alvo**. Garantido em:
  **Server Action + binding por tenant** — `alternarExibirImagensAdmin` usa
  `prepararContextoAdmin(lojaId)` + `escopo.atualizar`, que injeta o filtro por
  `loja_id`/`id` por construção; o `lojaId` vem da rota validada (`validarLojaIdAdmin`),
  nunca do payload.

---

### Vitrine pública — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth) — leitura anon (view/RLS), renderização SSR.

**Descrição:** onde o efeito acontece. Ao montar o catálogo, o servidor consulta a
preferência de cada categoria e decide **qual componente de listagem** renderiza cada
grupo — não é mais só uma questão de imagem presente/ausente:

- `exibir_imagens = true` → grupo renderiza como **hoje**: grid de `CardProduto`
  (foto se tiver, placeholder de gradiente se não tiver — inalterado).
- `exibir_imagens = false` → grupo renderiza como **lista textual estilo cardápio**:
  uma linha por produto, nome à esquerda, preço à direita, ligados por linha
  pontilhada (`Pão de queijo — 6un .......... R$ 18,90`). Sem área de imagem, sem
  placeholder — o layout inteiro muda, não só a imagem some. Tocar na linha abre o
  **modal de produto já existente** (`produto-modal.html`/componente de detalhe), de
  onde o cliente adiciona ao carrinho — a lista **não** tem botão de adicionar rápido
  inline (decisão de produto: visual de cardápio limpo, ação consolidada no modal que
  já existe e já é usado a partir do card).

Como o `foto_url` deixa de ser sequer necessário no template da lista, a decisão é
**estrutural**: o servidor escolhe qual componente montar por grupo, não só qual dado
passar pra ele. Isso é mais forte que zerar `foto_url` (RN-3) — na lista, a marcação
de imagem não existe no HTML de jeito nenhum.

**Comportamento — matriz decidida:**

| Preferência da categoria | Produto tem `foto_url`? | O que a vitrine mostra |
|---|---|---|
| `exibir_imagens = false` (ocultar) | sim ou não | **linha de lista** (`ItemProdutoLista`) — nome + linha pontilhada + preço; sem imagem, sem placeholder |
| `exibir_imagens = true` (exibir) | sim | grid: a **foto** do produto (`CardProduto`) |
| `exibir_imagens = true` (exibir) | não | grid: placeholder de gradiente (fallback atual, `CardProduto`) |

O grupo **"Outros"** (produtos sem categoria, `categoria_id = null`) **não tem** linha
de categoria e portanto **não tem toggle** — comporta-se como `exibir_imagens = true`
(grid, foto quando há, placeholder quando não há). Registrado em Regras (RN-5).

**Componentes:**
- `CardProduto.tsx` (`components/vitrine/`) — **sem mudança**. Segue usado só para
  grupos com `exibir_imagens = true`.
- `ItemProdutoLista.tsx` (`components/vitrine/`, **novo**) — linha de lista: nome
  (truncado se longo), linha pontilhada preenchendo o espaço, preço alinhado à
  direita. `onClick`/`onTap` na linha inteira reusa o **mesmo handler que o
  `CardProduto` já usa pra abrir o modal de produto** (extrair para um hook/util
  compartilhado se hoje estiver dentro do `CardProduto`, em vez de duplicar). Sem
  imagem, sem botão de adicionar — a11y: `role="button"`, `aria-label="Ver detalhes de
  {nome}, {preço}"`, alvo de toque ≥44px de altura.
- `SecaoCatalogo.tsx` — **estende o contrato**: por grupo, escolhe renderizar
  `<CardProduto>` (grid) ou `<ItemProdutoLista>` (lista) conforme
  `categoria.exibir_imagens`. Decisão de **qual componente**, feita a partir do dado
  já resolvido no servidor — não é toggle client-side (o `exibir_imagens` chega
  pronto do SSR, o componente só espelha).
- `buscarCatalogoPublico` (`lib/supabase/queries/produtos.ts`) **ou** a fronteira SSR
  em `loja/[slug]/page.tsx` — **ponto de enforcement** (ver Regras RN-3). Já carrega
  `categoria.exibir_imagens` por grupo; nenhuma query extra.
- `ProdutoModal.tsx` (`components/vitrine/`) — **pequeno ajuste**: o campo de imagem
  (`.img-hero`), quando não há `foto_url` pra mostrar (produto sem foto, **ou** modal
  aberto a partir de `ItemProdutoLista` de categoria "ocultar"), renderiza um **emoji
  fixo e genérico** (ex.: 🍽️) centralizado sobre o fundo gradiente já existente, em
  vez de área vazia. Mesmo emoji pra qualquer produto/categoria — sem customização
  (ver RN-9 e Fora de Escopo).
- ~~`ocultarImagensPorPreferencia(grupos)`~~ — **não é mais necessário** como
  transformação de dado (zerar `foto_url`). A decisão vira **escolha de componente**
  em `SecaoCatalogo`, direto sobre `categoria.exibir_imagens` — mais simples que gerar
  um util de projeção; menos um ponto de estado pra manter sincronizado.

**Behaviors:**
- [ ] Ver os produtos de uma categoria "ocultar" como **lista textual** (nome + linha
  pontilhada + preço), mesmo os que têm foto cadastrada — nunca em formato de card com
  imagem/placeholder. Garantido em: **Servidor (SSR)** — `SecaoCatalogo` escolhe
  `ItemProdutoLista` a partir de `categoria.exibir_imagens` resolvido no servidor; o
  `foto_url` nem precisa ser lido pra esse caminho de render.
- [ ] Tocar numa linha da lista abre o modal de produto (mesmo modal usado a partir do
  card) e permite adicionar ao carrinho por lá. Garantido em: **cliente** — reuso do
  handler/estado de modal já existente, sem lógica nova de carrinho.
- [ ] Ver os produtos de uma categoria "exibir" **em grid, com imagem** (ou placeholder
  se o produto não tem foto). Garantido em: **Servidor (SSR)** — `SecaoCatalogo`
  escolhe `CardProduto`; `CardProduto` decide foto vs. placeholder por presença de
  `foto_url` (`fotoSegura`), como hoje.
- [ ] Ver o grupo "Outros" sempre em grid (comportamento "exibir"). Garantido em:
  **Servidor (SSR)** — grupo sem categoria não tem preferência; default de projeção =
  exibir → `CardProduto`.
- [ ] Abrir o modal de um produto sem foto pra mostrar (produto sem `foto_url`, **ou**
  aberto a partir de uma linha de categoria "ocultar") e ver um **emoji genérico** no
  campo de imagem, em vez de área vazia/sem ícone. Garantido em: **cliente
  (apresentação)** — `ProdutoModal` decide emoji vs. `<img>` pela mesma checagem de
  presença de `foto_url`/`fotoSegura` já usada no `CardProduto`.

---

### Cadastro/edição de produto — `/painel/produtos` (`FormProduto`)

**Mundo:** painel (auth obrigatório).

**Descrição:** **sem toggle novo aqui.** O requisito de que "todo produto novo tenha
o controle disponível" é atendido **por herança**: o produto pertence a uma categoria,
e a categoria é quem carrega a preferência. O `FormProduto` continua com o upload de
imagem do produto (`UploadFotoProduto`) inalterado — o lojista pode subir a foto
mesmo em categoria "ocultar" (a foto fica cadastrada, só não é exibida na vitrine
enquanto a categoria estiver "ocultar"). Um micro-hint textual **opcional** pode
avisar "As imagens desta categoria estão ocultas na vitrine" quando a categoria
selecionada está em "ocultar" (UX informativa, não bloqueia o upload).

**Componentes:**
- `FormProduto.tsx` — **sem mudança de contrato de dados.** No máximo, um aviso
  textual condicional (UX). `UploadFotoProduto` inalterado.

**Behaviors:**
- [ ] Cadastrar produto em qualquer categoria e, opcionalmente, subir foto — a foto é
  salva independentemente da preferência da categoria. Garantido em: **Server Action**
  (`criarProduto`/`atualizarProduto`, inalteradas) — `foto_url` do produto e
  `exibir_imagens` da categoria são eixos independentes.
- [ ] (Opcional) Ver o aviso "imagens desta categoria estão ocultas na vitrine" ao
  escolher uma categoria "ocultar". Garantido em: cliente (UX) sobre dado server-side
  já carregado; não altera persistência.

---

## Modelos de Dados

**Migration nova:** `supabase/migrations/<timestamp>_categorias_exibir_imagens.sql`

```sql
ALTER TABLE categorias
  ADD COLUMN exibir_imagens boolean NOT NULL DEFAULT true;
```

- **Tabela afetada:** `categorias` (`schema.md` §categorias) — já tem `loja_id`,
  `ordem`, `nome`, `criado_em`. Ganha `exibir_imagens boolean NOT NULL DEFAULT true`.
- **Naming e padrão:** snake_case, `boolean NOT NULL DEFAULT` — mesmo padrão de
  `produtos.disponivel`/`produtos.oculto`/`lojas.ativo` (`schema.md`).
- **Default `true` (exibir):** escolha deliberada — é o **comportamento atual** (hoje
  toda categoria mostra imagens). `NOT NULL` evita tri-estado. Categorias existentes
  já ficam "exibir" após a migration; nenhuma vitrine muda de comportamento até o
  lojista desligar explicitamente uma categoria. Categoria **nova** também nasce
  "exibir" — assim o controle já aparece disponível e no estado esperado (requisito:
  "toda categoria, existente ou nova, tem esse controle").
- **Leitura no painel:** `buscarCategorias` faz `.select("*")` → coluna disponível
  sem mudança de query.
- **Leitura na vitrine:** `buscarCatalogoPublico` recebe as `categorias` já buscadas
  (com `exibir_imagens`) e monta os grupos com `.categoria` embutida — o util de
  ocultamento lê a preferência dali. Sem query extra.
- **RLS:** **nenhuma política nova.** `categorias` já tem
  `categorias_leitura_publica` (via `loja_esta_ativa`) e `categorias_escrita_propria`
  (dono) — `seguranca.md` §2. A coluna nova cai sob as políticas existentes. A escrita
  admin usa o caminho admin escopado por tenant já existente.

---

## Regras de Negócio

**RN-1 — Preferência por categoria, nunca por produto.** A verdade da exibição de
imagem é `categorias.exibir_imagens`. Produto **não** tem flag de imagem; herda a da
sua categoria. Camada: **banco (coluna em `categorias`) + Server Action**.

**RN-2 — Default seguro e retrocompatível.** `exibir_imagens NOT NULL DEFAULT true`.
Toda categoria (existente pós-migration ou criada depois) nasce "exibir". O painel
sempre mostra o controle no estado atual da coluna. Camada: **banco (DEFAULT)**.

**RN-3 — Ocultamento é autoritativo no servidor (SSR), não no cliente.** Para
categorias com `exibir_imagens = false`, o grupo é renderizado via
`ItemProdutoLista` — componente que **não tem marcação de imagem**. A escolha de
**qual componente montar por grupo** é feita no servidor, a partir de
`categoria.exibir_imagens` já resolvido no SSR (`SecaoCatalogo`). É mais forte que
zerar/ocultar `foto_url` no dado: a tag de imagem simplesmente **não existe** no HTML
enviado — nunca por CSS/`hidden`, nunca confiando em flag client-side
(`seguranca.md` §1/§3). Camada: **Servidor (SSR) — escolha de componente**.

**RN-4 — Dois fallbacks distintos, cada um no seu caminho.** (a) Categoria "ocultar" →
sempre **lista textual** (`ItemProdutoLista`: nome + linha pontilhada + preço),
independente de o produto ter foto ou não — layout inteiro muda, não só a imagem. (b)
Categoria "exibir" + produto sem foto → **placeholder de gradiente** existente do
`CardProduto` (grid mantido, só a imagem falha pro placeholder — comportamento atual,
inalterado). Os dois nunca se misturam: uma categoria é **toda** grid ou **toda**
lista, nunca mista dentro do mesmo grupo. Camada: **Servidor (SSR)** decide o
componente; **cliente (apresentação)** decide foto vs. placeholder dentro do
`CardProduto` quando aplicável.

**RN-5 — Grupo "Outros" (sem categoria) = exibir.** Produtos com `categoria_id = null`
caem no grupo "Outros", que não tem linha de categoria nem, portanto, preferência. A
projeção server-side trata ausência de preferência como "exibir" (fail-open apenas
para exibição — não há dado sensível: imagem de produto é pública). Camada:
**Servidor (SSR)**.

**RN-6 — Foto do produto e preferência são independentes.** O lojista pode cadastrar/
manter a foto do produto mesmo em categoria "ocultar"; a foto fica salva e volta a
aparecer se a categoria virar "exibir". Desligar o toggle **não** apaga `foto_url`.
Camada: **Server Action** (eixos independentes: `produtos.foto_url` vs.
`categorias.exibir_imagens`).

**RN-7 — Escrita escopada por loja/tenant.** No painel do lojista,
`alternarExibirImagens` grava sob RLS `categorias_escrita_propria`
(`auth.uid() = lojas.dono_id`). No hub admin, `alternarExibirImagensAdmin` grava via
escopo por tenant (`prepararContextoAdmin` + `escopo.atualizar`), com `lojaId` da rota
validada, nunca do payload. O cliente não escolhe qual loja/categoria de outra loja é
gravada. Camada: **RLS (lojista) / escopo admin por tenant + Server Action**.

**RN-8 — Painel não é afetado.** As miniaturas do painel do lojista (`ThumbProduto` na
tabela de produtos) **continuam mostrando** a foto — o toggle afeta **só a vitrine
pública**. O lojista precisa ver a foto que cadastrou para gerenciá-la. Camada:
decisão de produto (a escolha grid/lista roda só no caminho da vitrine).

**RN-9 — Modal sem foto mostra emoji genérico, não área vazia.** Quando o
`ProdutoModal` não tem `foto_url` válido pra exibir (produto sem foto, ou aberto a
partir de um item de lista de categoria "ocultar"), o campo de imagem mostra um
**emoji fixo, único, igual pra qualquer produto/categoria** — sem lógica de
seleção, sem campo novo no banco. Camada: **cliente (apresentação)**, mesma checagem
de `foto_url`/`fotoSegura` já usada no `CardProduto`.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não há PII nova. O payload de escrita é
  `{ nome, ordem, exibir_imagens }` da categoria. `foto_url` de produto já é dado
  **público** (imagem do catálogo) e continua sob `fotoSegura`/§15 (só `https://`
  vira `src`). Nenhuma chave Pix, cupom ou dado de cliente trafega.
- **Valor monetário?** **Não há.** `exibir_imagens` é booleano de apresentação,
  server-set após validação. Não existe "quanto paga". O análogo do "recálculo no
  servidor" (`seguranca.md` §10) aqui é o **ocultamento ser decidido no servidor**: o
  cliente nunca recebe a `foto_url` de categoria "ocultar" e não pode revelá-la
  editando o DOM — a URL simplesmente não está no HTML (RN-3). Isso é mais forte que
  CSS-hide.
- **Superfície de permissão real — escrita cross-tenant.** O ponto sensível é o hub
  admin editar categoria de loja de terceiro. A gravação usa o escopo por tenant
  (`prepararContextoAdmin(lojaId)` + `escopo.atualizar`, `lojaId` da rota validada por
  `validarLojaIdAdmin`, nunca do payload) — mesmo padrão de
  `specs/paridade-hub-admin-painel.md`. A via do lojista é protegida por RLS
  (`categorias_escrita_propria`).
- **Tabela nova?** Não — coluna nova em `categorias`. **Nenhuma política RLS nova**:
  as policies de `categorias` (leitura pública via `loja_esta_ativa`; escrita própria
  do dono) já cobrem a coluna. A coluna **não é billing** → **não** entra em
  `CAMPOS_LOJA_SOMENTE_SERVIDOR` nem em trigger de proteção; é preferência operacional
  editável pelo lojista.
- **API externa com key?** Não. Zero rede externa, zero chave, zero custo variável.
- **Validação na borda e no servidor.** O toggle é uma **action dedicada** cujo
  payload é um único boolean — `alternarExibirImagens(id, exibirImagens: boolean)` e a
  variante admin. O servidor valida `typeof exibirImagens === "boolean"` antes do
  I/O; qualquer outra coisa é rejeitada. `schemaCategoria` **não muda** (evita clobber
  no rename e regressão nos call sites de criar/renomear).

---

## Fora do Escopo (v1)

- **Toggle por produto individual** — o controle é por categoria por decisão de
  produto (requisito). Um override por produto fica para fase futura, se houver
  demanda.
- **Modos de imagem além de "exibir/ocultar"** (ex.: "sempre placeholder de marca
  customizado por categoria") — v1 é binário: grid com foto/placeholder de gradiente
  (exibir) vs. lista textual com emoji genérico no modal (ocultar). Não há modo
  intermediário nem customização por categoria além do próprio toggle.
- **Emoji customizável por categoria/produto** — o emoji do campo de imagem do modal
  (quando não há foto) é **fixo e genérico**, igual pra qualquer produto/categoria.
  Lojista escolher um emoji por categoria fica pra fase futura, se houver demanda
  (viraria coluna nova em `categorias` + campo no `GerenciarCategorias`).
- **Ocultar imagem por horário/condição** (ex.: só fora do horário de funcionamento)
  — toggle é estado fixo da categoria.
- **Preferência global da loja** ("ocultar todas as imagens da vitrine de uma vez") —
  v1 é por categoria. Um switch-mestre pode ser derivado depois iterando as
  categorias; não faz parte desta v1.
- **Aplicar a preferência às miniaturas do painel** — o painel continua mostrando as
  fotos para gestão (RN-8). O toggle é sobre a **vitrine pública**.
- **Reordenar/gerenciar imagens (galeria por produto)** — fora de escopo; produto
  tem uma `foto_url` única, inalterado.
</content>
</invoke>
