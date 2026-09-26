# Spec: Modal de divulgação sazonal

**Versão:** 0.1.0 | **Atualizado:** 2026-09-25

> **Camada NOVA por cima da infra de cardápio sazonal já entregue**
> (`specs/arquivo/cardapio-sazonal.md`, `specs/arquivo/vigencia-por-item-do-cardapio.md`).
> Esta spec **não recria** `cardapios`, `cardapio_produtos`, o motor de vigência
> (`src/lib/utils/vigenciaCardapio.ts`), nem o `ModalPromocoes` (itens com desconto). Ela
> introduz **um segundo modal de abertura** — de curadoria comercial, não de desconto — que o
> lojista monta e liga por conta própria, e uma regra de **quem abre quando os dois poderiam abrir**.
>
> **Correção de premissa (não herdar do pedido original).** A tabela `public.cardapios` **NÃO** tem
> `vigencia_inicio`/`vigencia_fim`. O contrato real é
> `supabase/migrations/20260920128000_cardapios_checks_vigencia_rls.sql`: `modo`
> (`'recorrente'|'prazo_fixo'`), `prazo_inicio`/`prazo_fim`, `dias_semana`/`dias_mes`/`hora_inicio`/`hora_fim`.
> A vigência do cardápio é avaliada em **função pura TS** (`cardapioAberto`, `itemAberto`,
> `avaliarVigenciaDoProduto`), **nunca em SQL**. Este modal **reusa essa avaliação**. Ela não é
> reimplementada, e a **janela de exibição do modal** (datas próprias, RN-02) é coisa **separada** da
> vigência do cardápio que ele aponta (RN-08).

---

## Visão Geral

Hoje o único modal de abertura da vitrine é o **`ModalPromocoes`** (issues 231/289): ele lista os
pratos com desconto vigente, decide-se sozinho no cliente com quatro condições puras
(`decidirModalPromocoes`) e respeita "1× por dia por loja" via `localStorage` (`irango:promo:{slug}`).
É automático — o lojista só o liga/desliga (`lojas.modal_promocoes`); **não escolhe o que ele
mostra**, porque o conteúdo é derivado do preço.

Falta ao lojista um modal que ele **cura**: "Chegou o Cardápio de Inverno", "Especial de Dia das
Mães", com **título próprio**, uma **janela de exibição** com data de início e fim, e uma **seleção
de produtos** que ele monta — por **categoria inteira** e/ou por **cardápio sazonal** (os menus com
vigência que a infra já entrega). Este é o **modal de divulgação sazonal**.

Como os dois modais disputam o mesmo instante (a abertura da vitrine, antes de o cliente rolar), a
feature também decide a **precedência**: quando há um modal sazonal ativo, o lojista escolhe se o
`ModalPromocoes` **também** aparece ou é **suprimido** — para não empilhar dois overlays na cara do
cliente que acabou de entrar.

**Só pode haver um modal sazonal ativo por loja por vez** (RN-05): o lojista pode ter vários
rascunhos ("Natal", "Ano-novo"), mas só um no ar.

**Mundos em que vive:**

| Mundo | O que muda |
|---|---|
| Vitrine pública (`/loja/[slug]`) | um segundo modal de abertura, curado pelo lojista, abrindo 1×/dia/loja; e a decisão de suprimir ou não o `ModalPromocoes` quando ele está no ar — **tudo decidido no SSR e descido pronto** |
| Painel do lojista (`/painel/configuracoes/promocoes`) | CRUD do modal sazonal: título, janela de exibição, seleção de categorias/cardápios, ligar/desligar, e o toggle "mostrar promoções junto" |
| Hub admin (`/admin/assinantes/[lojaId]/*`) | **nada** na v1 (§Fora do Escopo, com a consequência de segurança registrada) |
| Auth | nada muda |

**O que este modal NÃO é.** Não é uma terceira fonte de preço nem de desconto: os produtos que ele
mostra descem do **mesmo contrato de catálogo** (`ProdutoVitrine`), com `precoEfetivo`, `seloDesconto`
e `compravel` já resolvidos pelo servidor. Não é uma nova entidade de vigência: a "data de início e
fim" é uma janela de **exibição do overlay**, não uma janela de venda de produto (isso é do cardápio).
Um modal sazonal pode apontar **só categorias**, **só cardápios**, os dois, ou (recusado na escrita —
RN-06) nenhum.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|---|---|
| **iRango (SaaS)** | fornece o mecanismo. Garante que loja A nunca lê/edita modal da loja B, que a **janela de exibição** e a **decisão de abrir/suprimir** são avaliadas **no servidor** no fuso da loja, e que o título do lojista é renderizado como **texto, nunca HTML**. Continua sem tocar em pagamento (`modelo-negocio.md` §3). |
| **Lojista** | cria o modal, dá título, define a janela de exibição (início/fim), escolhe categorias e/ou cardápios a divulgar, liga/desliga, e decide se o `ModalPromocoes` aparece junto. Só um modal seu fica ativo por vez. |
| **Cliente** | vê o modal sazonal na **primeira visita do dia** à loja (se houver um ativo dentro da janela), com o título e os produtos curados; toca num prato para abrir o detalhe; fecha. **Nunca decide** se o modal abre, nunca informa data e nunca envia valor — o conteúdo é preview de UX, a compra é do carrinho/checkout como sempre. |

---

## Como esta spec consome contratos já existentes (reuso, não recriação)

`architecture.md` e o mandato 2 do `CLAUDE.md` exigem reuso. Esta feature reusa, sem reescrever:

- **Decisão pura + localStorage** — `src/components/vitrine/decisaoModalPromocoes.ts`
  (`decidirModalPromocoes`, `chaveModalPromocoes`, `lerUltimaVisualizacao`, `marcarVisualizado`). O
  modal sazonal ganha um **irmão** `decisaoModalSazonal.ts` com a mesma forma: decisão pura testável
  em `environment: node`, `scrollY`/`Storage`/`dia` injetados por parâmetro. **Chave de storage
  separada** — `irango:promo-sazonal:{slug}` (RN-07): o "já vi as promoções hoje" e o "já vi o modal
  sazonal hoje" são independentes.
- **As 7 travas anti-gesto** — `src/components/vitrine/ModalPromocoes.tsx` é o **molde exato** do
  `ModalSazonal.tsx`: decisão única na montagem (`useEffect` deps `[]`), zero temporizador,
  `scrollY > 0` ⇒ não abre, marca-visto no instante da decisão, `fechar()` único, só `onClick`, guarda
  de "nada a mostrar" no próprio componente. Mesmo `Dialog` do shadcn, mesmo botão de fechar 44×44,
  mesmo `finalFocus`/`destinoFoco`.
- **Motor de vigência** — `src/lib/utils/vigenciaCardapio.ts` (`cardapioAberto`, `itemAberto`,
  `avaliarVigenciaDoProduto`) e a projeção `src/lib/utils/catalogoVitrine.ts`
  (`projetarCatalogoVitrine`, `agruparPorCardapio`, `derivarPromocionaisParaModal`). A derivação dos
  produtos do modal sazonal **filtra sobre a lista que a página já projetou** — zero query nova de
  produto no caminho do modal, mesma disciplina de `derivarPromocionaisParaModal`.
- **Leitura de cardápio** — `src/lib/supabase/queries/cardapios.ts` (`buscarCardapiosComProdutos`,
  `cardapioPertenceALoja`) para resolver "produtos deste cardápio, da própria loja".
- **Sub-página de config** — o molde de `/painel/configuracoes/perfil` (`page.tsx` + `PerfilClient.tsx`
  + `montarPayloadPerfil.ts`), a Server Action `salvarPerfil` (rate-limit → zod → allowlist-patch →
  UPDATE → revalidate) e `montarPatchPerfil` (`src/lib/actions/patches-loja.ts`, allowlist coluna a
  coluna — **nunca spread do payload**). O CRUD do modal sazonal segue esse padrão passo a passo.
- **zod isomórfico** — o **mesmo** schema no cliente (react-hook-form) e na Server Action, em
  `src/lib/validacoes/`, com `.strict()` e teto de cardinalidade nas listas (`.max(...)`, CWE-770),
  molde de `schemaPerfil` e `schemaLoteDeProdutos`.
- **shadcn/ui** — `Dialog`, `Card`, `Input`, `Switch`, `Checkbox`, `Button`, `Form`, `AlertDialog`
  (gerados pelo CLI, `components/ui/`, **não editar**).

---

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** na primeira visita do dia, se a loja tem um modal sazonal **ativo** e **dentro da
janela de exibição** (avaliado no SSR, RN-02/RN-04), abre um overlay com o **título** que o lojista
escreveu e os **produtos curados** — os mesmos cards do catálogo, comprabilidade e preço já resolvidos
pelo servidor. Toca-se num prato para abrir o `ProdutoModal` do produto (sequenciamento idêntico ao do
`ModalPromocoes`, um dialog por vez). Fecha por ✕, ESC, clique-fora ou CTA. **Marca-se visto no
instante da decisão** (não reaparece no mesmo dia da loja, mesma loja).

Quando o modal sazonal está no ar, a **decisão de deixar o `ModalPromocoes` abrir ou não** já desceu
pronta do SSR (RN-09). O cliente nunca resolve precedência.

**Componentes:**
- `ModalSazonal` (`components/vitrine/ModalSazonal.tsx`) — **criar**, molde de `ModalPromocoes.tsx`
  (as 7 travas, `Dialog` do shadcn, botão fechar 44×44, `finalFocus`/`destinoFoco`, sequenciamento
  do detalhe). Recebe `titulo`, a lista de produtos derivada, `lojaSlug`, `diaDeHojeNaLoja`,
  `storage`, `destinoFoco`. **Não recebe** `toggleDaLoja` de promoções — a existência do modal já é a
  condição de abertura.
- `decisaoModalSazonal` (`components/vitrine/decisaoModalSazonal.ts`) — **criar**, módulo neutro
  (sem `'use client'`), irmão de `decisaoModalPromocoes`. `decidirModalSazonal({ temModalSazonal,
  diaDeHojeNaLoja, ultimaVisualizacao, scrollY })` → boolean; e `chaveModalSazonal(slug) =
  \`irango:promo-sazonal:${slug}\``, `lerUltimaVisualizacaoSazonal`, `marcarVisualizadoSazonal`
  (try/catch, silêncio proposital — é preferência de UX, não permissão).
- `ModalPromocoes` (`components/vitrine/ModalPromocoes.tsx`) — **não modificar internamente**: a
  supressão entra como **input** ao seu `toggleDaLoja` já existente. O `VitrineClient` passa
  `toggleDaLoja = loja.modal_promocoes && !suprimirPromocoes` (RN-09), e a trava 1/2 do próprio
  `decidirModalPromocoes` (`if (!toggleDaLoja) return false`) já cobre o caso. **Nenhuma trava nova
  no componente.**
- `VitrineClient` (`components/vitrine/VitrineClient.tsx`) — **modificar**: passa a montar
  **ambos** os modais, recebendo por prop `modalSazonal` (título + produtos, ou `null`) e
  `suprimirPromocoes: boolean`. Repasse puro; não decide nada. Os dois nunca ficam abertos ao mesmo
  tempo — a supressão é a garantia (RN-09).
- `derivarProdutosDoModalSazonal` — **criar**, função pura em `catalogoVitrine.ts` (coeso com
  `derivarPromocionaisParaModal`) ou `src/lib/utils/derivarModalSazonal.ts`. Recebe as seções já
  projetadas (`categoriasComProdutos`), os `secoesDestaque` (cardápios abertos), os
  `opcionaisPorCategoria`, os `rotulosVigencia`, e a **seleção do modal** (ids de categoria + ids de
  cardápio). Devolve `ProdutoModalDados[]` — os produtos que pertencem às categorias/cardápios
  selecionados, **deduplicados por id**, na ordem do catálogo. **Zero query nova** de produto: filtra
  sobre o que a página já tem em escopo (RN-10).
- `Dialog` — **reuso** de `components/ui/`.

**Behaviors:**
- [x] **Ver o modal sazonal na primeira visita do dia**, com o título do lojista e os produtos
  curados. Garantido em: **SSR** — a existência do modal ativo, a janela de exibição e a lista de
  produtos são resolvidas no servidor, no fuso da loja, no instante do request. O cliente **nunca**
  avalia janela nem existência (RN-02/RN-04/RN-10).
- [x] **Não ver o modal ao recarregar no mesmo dia** — `localStorage` `irango:promo-sazonal:{slug}`
  guarda o dia da loja. Garantido em: **cliente (UX)** (`decidirModalSazonal`) + **SSR** (o
  `diaDeHojeNaLoja` vem pronto, no fuso da loja — RN-07).
- [x] **Não ver o modal quando já estou rolando a página** (`scrollY > 0`). Garantido em:
  **cliente (UX)** (trava anti-gesto de `decidirModalSazonal`, herdada do molde).
- [x] **Não ver modal nenhum quando a loja não tem um sazonal ativo dentro da janela** — o
  `ModalSazonal` nem entra no payload. Garantido em: **SSR** (RN-02/RN-04).
- [x] **Tocar num prato do modal e abrir o detalhe dele** (`ProdutoModal`), com preço/opcionais/selo
  já prontos. Garantido em: **cliente (UX)** para a abertura + **SSR** para os dados (mesmo
  sequenciamento do `ModalPromocoes`, um dialog por vez).
- [x] **Fechar por ✕, ESC, clique-fora ou CTA**, com o foco voltando ao `destinoFoco`. Garantido em:
  **cliente (UX)** (`Dialog` do shadcn + `fechar()` único).
- [x] **Não ver o `ModalPromocoes` quando o lojista pediu para suprimi-lo** enquanto há sazonal
  ativo. Garantido em: **SSR** (a supressão desce pronta como `toggleDaLoja = false` — RN-09). O
  cliente não resolve precedência.
- [x] **Ver o `ModalPromocoes` normalmente quando NÃO há modal sazonal ativo**, ou quando há mas o
  lojista deixou "mostrar promoções junto" ligado. Garantido em: **SSR** (RN-09) — comportamento de
  hoje, inalterado.

---

### Promoções e modal sazonal do painel — `/painel/configuracoes/promocoes`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)` — o paywall de assinatura já se aplica)

> **Rota nova em `/painel/configuracoes/`**, irmã de `perfil`, `entregas`, `horarios`, `pagamentos`,
> `tema`. Escolhida por coerência: o `ModalPromocoes` já é ligado/desligado em
> `configuracoes/perfil` (`lojas.modal_promocoes`), e o modal sazonal é da mesma família de
> "divulgação/promoções na vitrine". A rota reúne os dois controles de abertura da vitrine num lugar.

**Descrição:** o lojista vê seus modais sazonais (lista, com estado ao vivo — "Ativo", "Rascunho",
"Fora da janela"), cria/edita um, define título e a **janela de exibição** (início/fim), escolhe
**categorias** e/ou **cardápios** a divulgar, liga/desliga, e configura o toggle **"mostrar as
promoções junto"** (RN-09). Ativar um modal desativa o que estava ativo (RN-05).

**Componentes:**
- `PromocoesClient` (`app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/PromocoesClient.tsx`)
  — **criar**. Casca sobre `Card`, `Button`, `Switch`, `AlertDialog` (shadcn, não editar). Molde:
  `PerfilClient.tsx`.
- `FormModalSazonal` — **criar**. `react-hook-form` + **o mesmo `schemaModalSazonal`** da Server
  Action (`lib/validacoes/modalSazonal.ts`), validação isomórfica. Campos: título (`Input`), início
  e fim da exibição (date/datetime), seleção de categorias (`Checkbox` por categoria), seleção de
  cardápios (`Checkbox` por cardápio, mostrando o estado de vigência ao vivo de cada um).
- `montarPatchModalSazonal` — **criar**, módulo neutro em `patches-modal-sazonal.ts` (ou junto de
  `patches-loja.ts`), allowlist **coluna a coluna** (nunca spread), molde de `montarPatchPerfil`.
- `Switch` — **reuso**: o toggle "mostrar promoções junto".
- `BadgeStatus` (`components/vitrine/BadgeStatus.tsx`) — **reuso** para o estado ao vivo do modal
  ("Ativo" / "Rascunho" / "Fora da janela"): cor de sistema + texto (§8), nunca cor do tema.
- `AlertDialog` — **reuso** para remover um modal (ação destrutiva; `design-system.md` §6).

**Behaviors:**
- [x] **Criar um modal sazonal** (título + janela de início/fim + seleção). Garantido em:
  **Server Action + RLS** (`modais_sazonais_escrita_propria`) + **zod** (`schemaModalSazonal`,
  `.strict()`, `.max()` nas listas) + **CHECK** no banco (`fim > inicio`; ao menos uma seleção — RN-06).
  `loja_id` derivado de `buscarLojaDoDono`, **nunca do payload**.
- [x] **Editar título/janela/seleção de um modal.** Garantido em: **Server Action + RLS** + **zod** +
  **allowlist-patch** (`montarPatchModalSazonal`, coluna a coluna).
- [x] **Escolher categorias a divulgar** (checkbox por categoria da loja). Garantido em:
  **cliente (UX)** para a marcação + **Server Action + RLS + FK/checagem de posse** para a gravação
  (categoria de outra loja é impossível de vincular — RN-11).
- [x] **Escolher cardápios a divulgar** (checkbox por cardápio da loja). Garantido em:
  **cliente (UX)** para a marcação + **Server Action + RLS + FK/checagem de posse** (`cardapioPertenceALoja`)
  para a gravação (RN-11).
- [x] **Ligar um modal** — ativar. Se já havia um ativo, ele é **desativado na mesma transação**
  (RN-05). Garantido em: **Server Action + RLS** + **índice único parcial** `WHERE ativo = true`
  (o backstop estrutural — RN-05).
- [x] **Desligar um modal** sem perder a configuração (vira rascunho). Garantido em:
  **Server Action + RLS** (coluna `ativo`).
- [x] **Ligar/desligar "mostrar as promoções junto"** — quando o modal sazonal está ativo, decide se
  o `ModalPromocoes` também abre. Garantido em: **Server Action + RLS** (coluna
  `mostrar_promocoes_junto` na própria `modais_sazonais` — RN-09). É preferência do lojista, não
  valor nem permissão de terceiro.
- [x] **Remover um modal sazonal.** Garantido em: **Server Action + RLS** + **FK ON DELETE CASCADE**
  (as junções de categoria/cardápio caem junto).
- [x] **Ver o estado ao vivo de cada modal** ("Ativo", "Rascunho", "Fora da janela"). Garantido em:
  **SSR** (preview de UX — recalculado no servidor a cada render; nada depende dele).
- [x] **Não conseguir ver nem tocar em modal de outra loja**, nem por `id` forjado no payload.
  Garantido em: **RLS** (`modais_sazonais_escrita_propria`, `modais_sazonais_leitura_propria`) +
  **Server Action** (`loja_id` de `buscarLojaDoDono`, nunca do payload).
- [x] **Não conseguir ter dois modais ativos ao mesmo tempo**, nem por duas requisições concorrentes.
  Garantido em: **índice único parcial** (`23505` — RN-05) + **Server Action** (transição de estado
  que desativa o anterior antes/junto de ativar o novo).

---

## Modelos de Dados

Referência: `references/schema.md`. **Uma tabela nova** (`modais_sazonais`) e **duas de junção**
(`modal_sazonal_categorias`, `modal_sazonal_cardapios`) ⇒ política RLS obrigatória antes de produção
(`seguranca.md` §2), GRANTs explícitos, e um **índice único parcial** para a invariante "um ativo por
loja". Tudo **aditivo e reversível**; nenhuma tabela existente muda.

> **`cardapios`, `cardapio_produtos` e `vitrine_lojas` NÃO são tocadas.** O toggle de supressão mora
> na **própria** `modais_sazonais` (decisão (c) do plano — RN-09), então **não há coluna nova em
> `lojas`** e **não há recriação de `vitrine_lojas`** (o risco principal do Spec A). A vitrine já lê
> `lojas.modal_promocoes` via `vitrine_lojas` para o `ModalPromocoes`; para o modal sazonal a vitrine
> faz **uma leitura nova** de `modais_sazonais` (o ativo público da loja) — não uma view recriada.

### `modais_sazonais` (migration 1)

```sql
create table public.modais_sazonais (
  id                        uuid primary key default gen_random_uuid(),
  loja_id                   uuid not null references public.lojas(id) on delete cascade,
  titulo                    text not null,
  ativo                     boolean not null default false,

  -- JANELA DE EXIBIÇÃO DO OVERLAY — coisa PRÓPRIA, separada da vigência do
  -- cardápio (RN-08). INCLUSIVO/EXCLUSIVO como o prazo de cardápio e de desconto.
  exibicao_inicio           timestamptz not null,   -- INCLUSIVO
  exibicao_fim              timestamptz not null,    -- EXCLUSIVO

  -- Toggle de precedência (RN-09): com este modal ativo, o ModalPromocoes
  -- também abre? Mora AQUI, não em `lojas`: é preferência POR MODAL, some quando
  -- o modal é removido, e não polui a linha de `lojas` nem a view `vitrine_lojas`.
  mostrar_promocoes_junto   boolean not null default false,

  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now(),

  -- Alvo das FKs compostas das junções (mesmo padrão de `cardapios_id_loja_unico`).
  constraint modais_sazonais_id_loja_unico unique (id, loja_id),

  -- Janela ordenada: fim depois do início. `23514` com nome → mensagem genérica
  -- na UI, detalhe no log (`seguranca.md` §14).
  constraint modais_sazonais_janela_ordem check (exibicao_fim > exibicao_inicio)
);

-- INVARIANTE "um ativo por loja" (RN-05): índice único PARCIAL. É a defesa
-- ESTRUTURAL — vale inclusive sob `service_role` (BYPASSRLS). A Server Action
-- desativa o anterior na mesma transação; o índice é o backstop contra corrida.
create unique index modais_sazonais_um_ativo_por_loja
  on public.modais_sazonais (loja_id)
  where ativo = true;

-- Consulta quente da vitrine: o modal ativo da loja.
create index modais_sazonais_loja_ativo_idx
  on public.modais_sazonais (loja_id, ativo);
```

**Por que a janela é `timestamptz` própria, e não reuso da vigência do cardápio.** A vigência do
cardápio decide **o que está à venda** (produto marcado/comprável); a janela do modal decide **quando
o overlay aparece**. São eixos ortogonais: um lojista pode querer divulgar o Cardápio de Inverno
(recorrente, sáb/dom) num modal que aparece **a semana toda** de 1 a 15 de junho. Amarrar a
exibição à vigência tiraria essa liberdade e misturaria duas regras que a §Correção de premissa
manda manter separadas.

**Por que o toggle mora aqui e não em `lojas`.** `lojas.modal_promocoes` é a preferência **global**
("eu uso o modal de promoções?"). `mostrar_promocoes_junto` é **contextual ao modal sazonal** ("quando
este modal está no ar, empilho promoções junto?"). Pôr em `lojas` obrigaria a recriar/alterar
`vitrine_lojas` e deixaria uma coluna órfã quando não houvesse modal ativo. Na junção com o modal, ela
some com o `ON DELETE CASCADE` e o SSR resolve tudo lendo uma linha só.

### `modal_sazonal_categorias` (migration 1, junção)

```sql
create table public.modal_sazonal_categorias (
  id                uuid primary key default gen_random_uuid(),
  loja_id           uuid not null references public.lojas(id) on delete cascade,
  modal_sazonal_id  uuid not null,
  categoria_id      uuid not null,
  criado_em         timestamptz not null default now(),

  -- FKs COMPOSTAS: a linha só existe se modal e categoria forem da MESMA loja
  -- que ela declara — o vetor cross-tenant vira IMPOSSÍVEL, não checado
  -- (mesmo padrão de `cardapio_produtos`, spec cardápio-sazonal §Modelos).
  constraint msc_modal_fk
    foreign key (modal_sazonal_id, loja_id)
    references public.modais_sazonais (id, loja_id) on delete cascade,
  constraint msc_categoria_fk
    foreign key (categoria_id, loja_id)
    references public.categorias (id, loja_id) on delete cascade,

  unique (modal_sazonal_id, categoria_id)
);
```

> **Depende de `categorias` ter o par único `(id, loja_id)`.** Se a tabela `categorias` ainda não
> tem `unique (id, loja_id)` (como `produtos_id_loja_unico`), a migration acrescenta essa constraint
> redundante-com-a-PK **antes** da FK composta — mesmo padrão da migration 1 do Spec B. A issue de
> migration verifica e adiciona se faltar.

### `modal_sazonal_cardapios` (migration 1, junção)

```sql
create table public.modal_sazonal_cardapios (
  id                uuid primary key default gen_random_uuid(),
  loja_id           uuid not null references public.lojas(id) on delete cascade,
  modal_sazonal_id  uuid not null,
  cardapio_id       uuid not null,
  criado_em         timestamptz not null default now(),

  constraint mscard_modal_fk
    foreign key (modal_sazonal_id, loja_id)
    references public.modais_sazonais (id, loja_id) on delete cascade,
  -- `cardapios` já tem `cardapios_id_loja_unico` (Spec B, migration 1).
  constraint mscard_cardapio_fk
    foreign key (cardapio_id, loja_id)
    references public.cardapios (id, loja_id) on delete cascade,

  unique (modal_sazonal_id, cardapio_id)
);
```

### RLS (todas as três tabelas, na mesma migration)

Tabela nova ⇒ RLS na **mesma** migration (`seguranca.md` §2). Molde: as policies de `cardapios`
(`20260920128000_...`).

- **Leitura pública** (`*_leitura_publica`, `for select`, `to anon`): só quando a loja está ativa,
  via `public.loja_esta_ativa(loja_id)` (security definer — **não** um `EXISTS` direto em `lojas`,
  que devolveria zero sob a RLS do anon). Para `modais_sazonais`, também **`ativo = true`**: rascunho
  não vaza (mesma preocupação que impede SELECT público de `cupons` e de cardápio inativo).
  **A policy NÃO filtra a janela de exibição** — a janela é avaliada na função pura TS do SSR (RN-04),
  não em SQL (mesma decisão de `cardapios_leitura_publica`, que não replica dia/hora/fuso).
- **Leitura própria** (`*_leitura_propria`, `for select`): o dono lê os próprios, inclusive
  inativos/rascunhos (painel). Combinada por OR com a pública.
- **Escrita própria** (`*_escrita_propria`, `for all`, com `using` **e** `with check`): dono da loja
  (via `exists (select 1 from lojas where lojas.id = <tabela>.loja_id and lojas.dono_id = auth.uid())`).
  O `with check` impede INSERT forjando `loja_id` alheio. Mesmo par de `cardapios`.

### GRANTs (obrigatório, não detectável em pglite)

`anon` ⇒ `select` apenas. `authenticated` ⇒ `select, insert, update, delete`. `service_role` ⇒ `all`.
Sem os grants o lojista levaria `42501` antes de a policy sequer ser avaliada (mesma nota da migration
de `cardapios`). Verificado por **inspeção da migration**, não por teste pglite.

---

## Regras de Negócio

Cada regra marca **em qual camada é garantida**.

- **RN-01 — Título é dado do lojista, renderizado como texto.** O `titulo` é validado (zod, não-vazio,
  teto de comprimento) e renderizado como **conteúdo de texto do React**, nunca `dangerouslySetInnerHTML`.
  Garantido em: **zod** (formato) + **React** (escape automático no render) + **RLS** (só o dono grava
  na própria loja). Input externo é dado, nunca instrução (`seguranca.md` §6).
- **RN-02 — Só um modal ATIVO e DENTRO DA JANELA abre.** O SSR busca o modal `ativo` da loja e avalia
  `exibicao_inicio <= agora < exibicao_fim` (instante × instante — o fuso da loja não muda o veredito,
  mesma aritmética de `dentroDoPrazo` em `vigenciaCardapio.ts`). Fora da janela ⇒ o `ModalSazonal` não
  desce. Garantido em: **SSR** (a comparação é do servidor, no instante do request; o cliente nunca
  avalia).
- **RN-03 — Modal inativo nunca abre e nunca vaza.** `ativo = false` é rascunho. Garantido em:
  **RLS** (`modais_sazonais_leitura_publica` exige `ativo = true`) + **SSR** (a query da vitrine
  filtra `ativo = true` explicitamente — cinto e suspensório, como `cardapios`).
- **RN-04 — A janela de exibição é do MODAL, não do cardápio.** Nenhuma leitura de vigência de
  cardápio entra na decisão de **abrir** o modal. A vigência do cardápio só decide **quais produtos**
  daquele cardápio entram na lista curada (RN-10). Garantido em: **SSR** (duas avaliações distintas,
  documentadas na função de derivação).
- **RN-05 — Um modal ativo por loja por vez.** A ativação de um modal desativa o anterior **na mesma
  transação** (transição de estado na Server Action). O **índice único parcial**
  `WHERE ativo = true` é a defesa estrutural — recusa (`23505`) um segundo ativo mesmo sob corrida ou
  `service_role`. Garantido em: **índice único parcial (banco)** + **Server Action** (a transição).
- **RN-06 — Um modal precisa de ao menos uma seleção.** Modal sem nenhuma categoria e sem nenhum
  cardápio não tem o que mostrar — é recusado na **escrita**. Garantido em: **zod** (a Server Action
  valida que `categorias.length + cardapios.length >= 1` antes de gravar as junções) + **Server
  Action** (a gravação das junções é atômica com a criação). (Não é CHECK no banco porque a seleção
  vive em tabelas de junção, não em colunas da linha; a atomicidade é da transação da Action.)
- **RN-07 — "1× por dia por loja" no fuso da LOJA.** `diaDeHojeNaLoja` é derivado no **servidor**
  (`diaNoFuso(agora, timezoneLoja)`, o mesmo já usado pelo `ModalPromocoes`), e comparado no cliente
  contra o `localStorage` `irango:promo-sazonal:{slug}`. Chave **separada** da de promoções. Garantido
  em: **SSR** (o dia) + **cliente (UX)** (a comparação e o storage — é preferência, não permissão).
- **RN-08 — Janela de exibição ≠ vigência do cardápio.** Reafirmação estrutural de RN-04 no modelo de
  dados: `exibicao_inicio`/`exibicao_fim` são colunas próprias de `modais_sazonais`; a spec **não**
  cria `vigencia_inicio`/`vigencia_fim` em lugar nenhum, e **não** lê `prazo_inicio`/`prazo_fim` do
  cardápio para decidir a exibição do modal. Garantido em: **schema** (colunas próprias) + **SSR**
  (funções distintas).
- **RN-09 — Precedência sazonal × promoções, decidida no SERVIDOR.** Quando há modal sazonal ativo
  dentro da janela, o SSR calcula `suprimirPromocoes = !modalSazonal.mostrar_promocoes_junto` e desce
  ao `VitrineClient` o `toggleDaLoja` do `ModalPromocoes` já como `loja.modal_promocoes &&
  !suprimirPromocoes`. Sem modal sazonal ativo, nada muda: o `ModalPromocoes` segue como hoje.
  Garantido em: **SSR** (a decisão desce pronta) — o cliente **nunca** resolve qual modal abre.
- **RN-10 — Produtos do modal saem do catálogo já projetado, deduplicados.** A lista curada é o
  conjunto dos produtos das categorias selecionadas **mais** os produtos dos cardápios selecionados
  que estão **abertos/à venda agora** (`itemAberto`, reusado — a vigência do cardápio filtra aqui, e
  só aqui), unidos e deduplicados por `id`, na ordem do catálogo. **Nenhuma query nova de produto** no
  caminho do modal: filtra sobre `categoriasComProdutos`/`secoesDestaque` já em escopo. Preço, selo e
  comprabilidade vêm **prontos** do contrato de catálogo. Garantido em: **SSR** (função pura de
  derivação, reuso de `vigenciaCardapio.ts` + `catalogoVitrine.ts`).
- **RN-11 — Seleção cross-tenant é impossível.** Vincular uma categoria ou um cardápio de outra loja
  ao modal viola a **FK composta** (`23503`) e derruba a transação; e o `loja_id` do modal vem de
  `buscarLojaDoDono`, nunca do payload. Garantido em: **FK composta (banco)** + **RLS** + **Server
  Action** (posse derivada, não recebida).

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** título e datas do modal (dado do lojista, não PII de cliente). O
  título é renderizado como **texto**, nunca HTML (RN-01) — sem XSS refletido. Datas validadas por zod
  e comparadas no servidor.
- **Valor monetário?** **Não há valor monetário nesta feature.** O modal só **exibe** produtos cujo
  preço/selo/comprabilidade **já foram recalculados** pelo contrato de catálogo no SSR. O modal não
  aplica desconto, não define frete, não cria preço. O carrinho e o `criarPedido` continuam sendo a
  autoridade de qualquer valor — o modal é preview de UX puro. (Portanto, **não há** "recálculo no
  servidor" novo a especificar aqui além do que o catálogo já faz.)
- **Tabelas novas ⇒ RLS obrigatória** (as três, na mesma migration):
  - `modais_sazonais_leitura_publica` (anon, `ativo = true` + `loja_esta_ativa`),
    `modais_sazonais_leitura_propria` (dono), `modais_sazonais_escrita_propria` (dono, USING + WITH CHECK).
  - As mesmas três para `modal_sazonal_categorias` e `modal_sazonal_cardapios` (leitura pública
    condicionada à loja ativa; escrita/leitura própria do dono).
  - GRANTs: anon SELECT; authenticated CRUD; service_role ALL (não detectável em pglite — inspeção).
- **Invariante "um ativo por loja":** índice único parcial `WHERE ativo = true` (RN-05) — defesa que
  não depende de disciplina de Server Action e vale sob `service_role`.
- **Isolamento multitenant:** FKs compostas nas duas junções tornam o vínculo cross-tenant estrutural
  impossível (RN-11); `loja_id` sempre derivado de `buscarLojaDoDono`, nunca do payload; `.eq("loja_id")`
  explícito nas queries além da RLS (padrão de `cardapios.ts`).
- **CWE-770 (unbounded input):** as listas de categorias/cardápios no payload têm teto (`.max(...)` no
  zod, molde de `schemaLoteDeProdutos`), para um payload hostil não gerar milhares de INSERTs.
- **API externa com key?** Nenhuma — a feature não chama serviço externo.
- **Erro do banco não vaza:** `23514`/`23505`/`23503` viram mensagem genérica na UI, detalhe no log do
  servidor (`seguranca.md` §14).

---

## Fora do Escopo (v1)

- **Gestão de modal sazonal no hub admin** (`/admin/assinantes/[lojaId]/*`). Como em cardápio-sazonal:
  a via admin fica de fora; a consequência é que as Server Actions são para `authenticated` apenas
  (sob `service_role`, `auth.uid()` é NULL e a checagem de posse fail-closes). Quando o admin precisar,
  a conversão é a documentada em `seguranca.md` §2 (SECURITY DEFINER + T1–T7), não só um grant.
- **Múltiplos modais ativos / agendamento em fila.** Um ativo por vez (RN-05). Uma "fila" de modais
  que se sucedem por data é fase posterior — hoje o lojista troca manualmente.
- **Segmentação de público** (mostrar modal só para novos visitantes, ou por origem de tráfego). O
  gatilho é só "primeira visita do dia", como o `ModalPromocoes`.
- **Personalização visual do modal** (imagem de capa, cor própria, layout). v1 usa o mesmo `Dialog`
  do molde: título + lista de produtos. Cor vem do tema da loja (§4).
- **Empilhar os dois modais em sequência** (fechar o sazonal e então abrir promoções). A precedência é
  binária: ou promoções aparece **junto** (dois overlays gerenciados pelo cliente, o que a supressão
  existe para evitar) — na v1, "junto" significa "ambos habilitados", e a experiência de nunca ter
  dois abertos ao mesmo tempo é herdada do sequenciamento de um-dialog-por-vez do molde. Uma coreografia
  explícita de "primeiro um, depois o outro" fica fora.
- **Reordenar produtos dentro do modal / limitar quantos aparecem.** A lista sai na ordem do catálogo;
  um teto de "N pratos + e mais M" (como o `MAX_LISTADOS` do `ModalPromocoes`) pode ser herdado do
  molde no `executar`, mas não é regra de negócio decidida aqui.
- **Analytics de conversão do modal** (quantos abriram, quantos compraram a partir dele). Fase
  posterior; alinhado ao roadmap de relatórios (`modelo-negocio.md` §8, Fase 3).
