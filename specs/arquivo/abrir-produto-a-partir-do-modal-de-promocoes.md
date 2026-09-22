# Spec: Abrir o produto a partir do modal de promoções

**Versão:** 0.2.0 | **Atualizado:** 2026-09-22

## Visão Geral

Na vitrine pública (`/loja/[slug]`), quando a loja tem prato em promoção e o lojista mantém
`lojas.modal_promocoes` ligado, o `ModalPromocoes` abre no primeiro acesso do dia àquela loja (regra da
`specs/arquivo/desconto-por-produto-e-pratos-promocionais.md`, RN-15/16/17/18). O modal lista até 3
pratos com foto, nome, preço efetivo e selo de desconto — e **as linhas não são clicáveis**. O cliente
vê a promoção, fecha o modal e tem que caçar o prato no catálogo: o único CTA ("Ver promoções") leva
ao `<main>`, isto é, ao topo do cardápio. É um beco sem saída — a mesma classe de erro de UX que o D13
(card marcado que não abria modal) e a 262 (card não comprável sem saída de leitura) já fecharam em
outras superfícies.

**O que esta feature faz:** tocar num prato listado no modal de promoções **fecha o modal e abre o
`ProdutoModal` daquele prato**, pronto para escolher quantidade/opcionais e adicionar ao carrinho. O
cliente sai do modal promocional dentro do fluxo de compra, no mesmo toque.

**A tela não rola.** Levar o cliente até o card no catálogo foi explicitamente descartado como
entrega; nenhuma mecânica de scroll entra neste spec (ver §Fora do Escopo, primeiro item, e a
justificativa de foco na RN-6).

**Mundo:** vitrine pública, sem autenticação. **Nenhum valor monetário novo é decidido ou calculado no
cliente:** preço efetivo, selo, `temDesconto` e comprabilidade chegam prontos do servidor no
`ProdutoVitrine` (contrato de catálogo, regra 6), e todo valor continua recalculado na Server Action do
checkout a partir do banco (`seguranca.md` §10), com a trava `promocaoExibida` (238/RN-12-a) intacta.
Nenhuma migration, nenhuma tabela, nenhuma política RLS, nenhuma query nova.

**O que NÃO pode regredir:** as sete travas do `ModalPromocoes` (decisão única na montagem, zero
temporizador, `scrollY > 0` não abre, marca como visto no instante da decisão, um único `fechar()`,
nada no SSR, uma condição num lugar só), a regra de **quando** o modal dispara (fora de escopo por
declaração do usuário) e o comportamento atual do `ProdutoModal` abrindo a partir do card/linha.

## Atores Envolvidos

- **Cliente (vitrine, sem login):** único ator com comportamento novo. Toca num prato do modal
  promocional e cai no detalhe daquele prato, com "Adicionar ao carrinho".
- **Lojista:** nenhum comportamento novo. Continua ligando/desligando o modal
  (`lojas.modal_promocoes`) e cadastrando desconto por produto no painel; nenhuma tela do painel muda.
- **iRango (SaaS):** nenhum. Sem migration, sem Server Action, sem RLS, sem query nova.

## Decisão de arquitetura (D1) — quem é o dono do `ProdutoModal`

**O problema, concreto.** O estado do `ProdutoModal` (`produtoSelecionado` + `modalAberto`) vive em
`SecaoCatalogo`, que é descendente de `CatalogoVitrine`. O `ModalPromocoes` vive em `VitrineClient`.
Os dois são **irmãos** sob um Server Component (`page.tsx`) e não compartilham estado — é o mesmo
problema que a 234 resolveu para o foco com `ID_MAIN_VITRINE`. Além do estado, o `ProdutoModal` precisa
de dois mapas que hoje **só existem no servidor e descem pelo ramo do catálogo**:
`opcionaisPorCategoria` (de `buscarOpcionaisPorCategoria`, `page.tsx`) e `rotulosVigencia` (do mesmo
retorno que produziu os produtos, 247/254).

**Saída escolhida: store de módulo + `useSyncExternalStore`, no padrão que o projeto já usa em
`useCarrinho`.** Um hook novo, `src/hooks/useProdutoEmFoco.ts` (~40 linhas, espelhando a forma do
store do carrinho: `subscribe`/`getSnapshot`/`abrir`/`fechar`, **sem persistência** — memória apenas),
passa a ser a fonte única de "qual produto está em foco". O `ProdutoModal` continua sendo renderizado
**onde já é hoje**, por `SecaoCatalogo`, em **uma única instância**, agora lendo o store em vez de
`useState`. `SecaoCatalogo` continua montando o `ProdutoModalDados` do catálogo (com
`opcionaisPorCategoria`/`rotulosVigencia`, como hoje) e `ModalPromocoes` chama `abrir(dados)` com o
objeto que **o servidor já montou** para os pratos promocionais.

**Por que não as outras saídas:**

| Saída | Custo / risco concreto | Veredito |
|---|---|---|
| **Contexto React de vitrine** (provider client envolvendo `CatalogoVitrine` + `VitrineClient` em `page.tsx`) | Seria o **primeiro `createContext` do repo** (`grep -rn createContext src` = zero hits): novo padrão a documentar, e a fiação só é provável **renderizando**, o que esta suíte não faz (`environment: node`, sem jsdom; `renderToStaticMarkup` não roda efeito nem provider útil). Ainda exige reestruturar o JSX de `page.tsx` (wrapper client em volta de children RSC) e mover `opcionaisPorCategoria`. | Rejeitada: mais superfície e **menos testável** que o store, pelo mesmo resultado |
| **Elevar o estado do `ProdutoModal` para `VitrineClient`** | `VitrineClient` é irmão do catálogo: para alcançá-lo, os dois mapas teriam que ser repassados a ele **e** o `ProdutoModal` sairia de dentro do `<main>`; `page.tsx`, `CatalogoVitrine` e `SecaoCatalogo` mudam de assinatura juntos. Diff grande em três componentes de vitrine, nenhum ganho sobre o store. | Rejeitada por custo |
| **Mover o `ModalPromocoes` para dentro do `CatalogoVitrine`/`SecaoCatalogo`** | Coloca o modal promocional **dentro do ramo que reage à busca**: `SecaoCatalogo` re-renderiza a cada tecla e `CatalogoVitrine` desmonta/remonta partes em modo busca. A **trava 1** do modal ("decisão ÚNICA, na montagem") depende de montar uma vez só — um remonte futuro reabriria o modal no meio da navegação. Também não existe no ramo `temVazio` de `page.tsx`. | Rejeitada: risco de regressão na trava mais importante do modal |
| **Uma SEGUNDA instância de `ProdutoModal` dentro do `ModalPromocoes`** | Criaria um **segundo montador do payload de `adicionar`** — o lugar exato onde `temDesconto: true` alimenta `promocaoExibida` (238/RN-12-a). Um caminho de compra que esquece esse campo faz a trava do servidor **nunca disparar** para os pratos promocionais, em silêncio. É a classe de bug do D13. | Rejeitada **por segurança**, não só por DRY |

**Nada é replicado.** `opcionaisPorCategoria` e `rotulosVigencia` continuam sendo buscados **uma vez
por request** em `page.tsx`, nas mesmas linhas de hoje, e continuam descendo por `CatalogoVitrine` →
`SecaoCatalogo` como hoje. A única mudança de fiação no servidor é que a lista de promocionais passa a
sair **enriquecida** pela mesma função pura que já a deriva: `page.tsx` entrega
`ProdutoModalDados[]` em vez de `ProdutoVitrine[]`, usando os mapas que já estão ali em escopo. Como
os grupos de opcional e as frases de vigência são as **mesmas referências** de objeto que já viajam no
payload RSC, o Flight as serializa uma vez e referencia nas demais — não há segunda cópia no payload.
(A checar na auditoria do `acelerar`, não assumido como fato de performance.)

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** no primeiro acesso do dia àquela loja, com promoção ativa e o toggle ligado, o modal
"Promoções de hoje" abre listando até 3 pratos. Depois desta feature cada linha é um botão: tocar
fecha o modal promocional e abre o `ProdutoModal` daquele prato — foto grande, descrição, quantidade,
opcionais, observação e "Adicionar ao carrinho", exatamente o modal que o card do catálogo abre.
Adicionar faz a barra do carrinho aparecer no rodapé, como em qualquer adição. Os dois CTAs do rodapé
do modal promocional continuam existindo e continuam fechando para o `<main>`.

**Componentes:** nenhum componente de UI novo; nenhum primitivo `shadcn/ui` novo (`design-system.md`
§7). Um hook novo (mecânica testável) e ajustes em componentes existentes.

- `useProdutoEmFoco` (`src/hooks/useProdutoEmFoco.ts`) — **NOVO.** Store de módulo + `useSyncExternalStore`,
  mesma forma do `useCarrinho` (o precedente de estado compartilhado entre irmãos na vitrine). Guarda
  `{ dados: ProdutoModalDados | null; aberto: boolean; origem: "catalogo" | "promocoes" }`.
  **Sem `localStorage`** (nada a persistir; o carrinho persiste, o foco de produto não). Testável em
  `environment: node` porque é store puro — é o que decide a escolha do D1.
- `ModalPromocoes` (`components/vitrine/ModalPromocoes.tsx`) — as `<li>` inertes passam a
  `<li><button>`. O clique guarda o prato como **pendente** e chama o **mesmo** `fechar()` de sempre
  (trava 5); a abertura do `ProdutoModal` acontece no `onOpenChangeComplete` (ver RN-5). A prop
  `promocoes` muda de `ProdutoVitrine[]` para `ProdutoModalDados[]` — **superset** do tipo atual, então
  a marcação existente (foto, nome, `PrecoProduto`, `SeloDesconto`, linha "e mais N") compila e
  renderiza sem mudança.
- `SecaoCatalogo` (`components/vitrine/SecaoCatalogo.tsx`) — troca `useState` pelo store: `abrirModal`
  passa a chamar `abrir({...}, "catalogo")` e o `ProdutoModal` passa a ler `dados`/`aberto` do store.
  `confirmarAdicao` (o montador do payload de `adicionar`, com `temDesconto`) **fica onde está, uma
  vez só, sem mudança de conteúdo**. Continua o único componente que renderiza `ProdutoModal`.
- `ProdutoModal` (`components/vitrine/ProdutoModal.tsx`) — ganha **uma** prop opcional
  `focoDeSaida?: RefObject<HTMLElement | null>`, repassada ao `finalFocus` do `DialogContent`. Nenhuma
  mudança de layout, de preço, de subtotal, de opcionais ou do CTA.
- `VitrineClient` (`components/vitrine/VitrineClient.tsx`) — só o tipo da prop `promocoes` muda
  (repasse). Continua dono do `Carrinho`, da barra fixa e do `destinoFoco` (`ID_MAIN_VITRINE`, 234).
- `catalogoVitrine.ts` (`lib/utils/`) — a derivação de promocionais da RN-15 (hoje um `flatMap` +
  `filter` inline em `page.tsx`) passa a ser a função pura **`derivarPromocionaisParaModal(secoes, opcionaisPorCategoria, rotulosVigencia)`**,
  no módulo que já é dono do contrato de catálogo (e onde a RN-15 já é testada,
  `catalogoVitrine.test.ts`). É ela que monta o `ProdutoModalDados` de cada prato promocional — a
  mesma composição que `SecaoCatalogo.abrirModal` faz para o catálogo, agora escrita uma vez e
  testada.
- `page.tsx` (`app/(publica)/loja/[slug]/`) — passa a chamar `derivarPromocionaisParaModal` com os
  mapas que já tem em escopo. **Nenhuma query nova, nenhum wrapper novo, nenhuma mudança na árvore de
  componentes.**
- **NÃO mudam:** `CatalogoVitrine`, `CardProduto`, `ItemProdutoLista`, `layoutVitrine.ts`,
  `ancoraCategoria.ts`, `scrollspyCategorias.ts`, `NavCategorias`, `decisaoModalPromocoes.ts`,
  `useCarrinho`, `Carrinho`, `checkout/*`, `components/ui/*`, e qualquer coisa do painel.

**Behaviors:**

- [ ] **Tocar num prato listado abre o detalhe daquele prato** — a linha é um `<button type="button">`
      que guarda o prato como pendente e chama o único `fechar()`; quando o modal promocional termina
      de fechar, o `ProdutoModal` abre com aquele produto. Garantido em: **cliente (UX)** — o conjunto
      de produtos veio do SSR sob `anon` + RLS e nenhum valor é decidido aqui.
- [ ] **O detalhe abre completo: quantidade, opcionais, observação e "Adicionar ao carrinho"** — os
      opcionais e a frase de vigência do prato promocional vêm **prontos do servidor**, montados por
      `derivarPromocionaisParaModal`; o modal não busca nada. Garantido em: servidor (dados) +
      cliente (UX). Preço e subtotal exibidos são **preview** (`seguranca.md` §10).
- [ ] **Adicionar ao carrinho a partir desse modal é idêntico a adicionar pelo card** — mesmo
      `confirmarAdicao`, mesmo payload, mesmo `temDesconto: true`, mesmo toast, mesma barra de
      carrinho. Garantido em: cliente (preview do carrinho) e **Server Action + RLS** (o valor cobrado
      é recalculado no checkout a partir do banco, e a trava `promocaoExibida` valida a promoção que a
      vitrine exibiu — 238/RN-12-a).
- [ ] **Nunca há dois modais abertos ao mesmo tempo** — a abertura do `ProdutoModal` é sequenciada no
      `onOpenChangeComplete(false)` do modal promocional ("após terminarem as animações", verificado em
      `@base-ui/react` 1.6.0, `DialogRoot.d.ts:44`): uma trava de scroll e um focus-trap por vez.
      Garantido em: cliente (UX).
- [ ] **O foco entra no `ProdutoModal` e não pisca no caminho** — quando há prato pendente, o
      `finalFocus` do modal promocional devolve `false` ("do nothing", `DialogPopup.d.ts`), então o
      foco não vai ao `<main>` para depois saltar; quem move o foco é a abertura do `ProdutoModal`.
      Garantido em: cliente (UX).
- [ ] **Fechar o `ProdutoModal` vindo da promoção devolve o foco ao `<main>`** — `origem === "promocoes"`
      faz `SecaoCatalogo` passar `focoDeSaida` (o `<main>` por `ID_MAIN_VITRINE`, mecanismo da 234): o
      botão que abriu já não existe e sem isso o foco cairia no `<body>`. Vindo do card/linha, nada
      muda (comportamento atual do Base UI). Garantido em: cliente (UX/acessibilidade).
- [ ] **Fechar o `ProdutoModal` não reabre o modal promocional e não deixa o body travado** — a única
      transição para "aberto" do `ModalPromocoes` continua sendo o `useEffect` de deps `[]` da montagem
      (trava 1), e o "já mostrei hoje" já foi marcado no instante da decisão (trava 4); a trava de
      scroll é do `Dialog` que está aberto e é liberada pelo próprio Base UI ao fechar. Garantido em:
      cliente (UX) + revisão de código.
- [ ] **Prato em promoção e esgotado (ou fora da janela) abre o detalhe sem CTA de compra** — o
      `ProdutoModal` não comprável mostra a frase de "quando volta" e não tem botão de adicionar
      (262/design §4.2). Garantido em: cliente (ausência de UI) e **Server Action + RLS** (a
      impossibilidade de comprar, RN-08 do pedido).
- [ ] **Fechar por ✕, ESC, clique-fora ou pelos dois CTAs do rodapé continua idêntico** — sem prato
      pendente, o `finalFocus` segue devolvendo o foco ao `<main>` (`destinoFoco`), o dia já está
      marcado e o modal não reabre. Garantido em: cliente (UX); persistência é `localStorage` em
      try/catch, por loja (RN-18).
- [ ] **A linha "e mais N pratos em promoção" continua não interativa** — o teto de 3 listados
      (`MAX_LISTADOS`) não muda e a linha de resumo não abre nada. Garantido em: cliente (UX).

---

## Modelos de Dados

**Nenhuma tabela é lida ou escrita por esta feature.** Nenhuma migration, nenhuma coluna nova, nenhuma
política RLS nova — `references/schema.md` fica inalterado. O que a feature consome já existe:

- `lojas.modal_promocoes` — coluna existente (migration `20260920121000_lojas_modal_promocoes.sql`,
  projetada em `vitrine_lojas` por `20260920122000`), lida no SSR como hoje. **Nota de drift para o
  `escriba`, fora do escopo da implementação:** `references/schema.md` não lista essa coluna.
- catálogo projetado (`vitrine_produtos` → `projetarCatalogoVitrine`) — `ProdutoVitrine` já traz tudo
  o que o modal precisa. **Nenhum campo novo no contrato de catálogo.**

Contratos de módulo alterados (TypeScript, não banco):

- **Novo** `src/hooks/useProdutoEmFoco.ts`:
  `type ProdutoEmFoco = { dados: ProdutoModalDados | null; aberto: boolean; origem: "catalogo" | "promocoes" }`,
  com `abrir(dados, origem)`, `fechar()`, `subscribe`, `getSnapshot` e o hook
  `useProdutoEmFoco()`. Store de módulo, **sem persistência**; `getServerSnapshot` devolve o estado
  fechado (nada no SSR).
- `lib/utils/catalogoVitrine.ts` — **nova** `derivarPromocionaisParaModal(secoes, opcionaisPorCategoria, rotulosVigencia): ProdutoModalDados[]`:
  filtra `temDesconto` sobre o catálogo já carregado (RN-15, sem query) e acopla
  `gruposOpcionais` + `rotuloIndisponivel` por id. Pura, `agora` não entra (nada de relógio).
- `ModalPromocoes` — `promocoes: ProdutoModalDados[]` (era `ProdutoVitrine[]`; superset). `destinoFoco`
  continua obrigatória e com o mesmo tipo.
- `VitrineClient` — `promocoes: ProdutoModalDados[]` (repasse).
- `ProdutoModal` — `focoDeSaida?: RefObject<HTMLElement | null>` (nova, opcional). `produto`, `open`,
  `onOpenChange` e `onAdicionar` **não mudam de forma**, então `SecaoCatalogo` é o único chamador
  afetado.
- `SecaoCatalogo` — **nenhuma prop muda** (`opcionaisPorCategoria` e `rotulosVigencia` continuam onde
  estão, inclusive a obrigatoriedade de `rotulosVigencia` que o `tsc` usa como trava, design §4.1).

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| RN-1 | Todo prato listado no modal promocional abre o detalhe daquele prato. Beco sem saída é proibido. | Cliente (UX) — `ModalPromocoes` + store |
| RN-2 | A regra de **quando** o modal promocional abre não muda: decisão única na montagem, `scrollY > 0` não abre, um por dia por loja, zero temporizador. | Cliente — `decisaoModalPromocoes.ts` **inalterado** (um diff nele é escopo estourado) |
| RN-3 | Existe **um único** `fechar()` no `ModalPromocoes`; o toque no prato usa o mesmo, depois de registrar o pendente. | Revisão de código — nenhuma segunda transição para `open: false` no arquivo |
| RN-4 | Existe **uma única** instância de `ProdutoModal` na vitrine e **um único** montador do payload de `adicionar` (`confirmarAdicao`, em `SecaoCatalogo`). Nenhum caminho de compra novo. | `grep`/revisão de código + o store como fonte única de "produto em foco" |
| RN-5 | Nunca dois dialogs abertos ao mesmo tempo: o `ProdutoModal` só abre depois de o modal promocional **terminar** de fechar (`onOpenChangeComplete(false)`). Uma trava de scroll e um focus-trap por vez. | Cliente — sequenciamento em `ModalPromocoes` |
| RN-6 | O foco nunca cai no `<body>`: com pendente o modal promocional não move foco (`finalFocus` → `false`) e quem o move é o `ProdutoModal`; ao fechar o `ProdutoModal` vindo da promoção, o foco volta ao `<main>` (`ID_MAIN_VITRINE`, 234). Como a página nunca rolou, `<main>` é onde o cliente já estava — é isso que substitui a rolagem, sem mecânica nova. | Cliente — `finalFocus` do Base UI nos dois dialogs |
| RN-7 | Os dois modais **não** são dialogs aninhados do Base UI (o `ProdutoModal` não é renderizado dentro do popup do promocional): nada de `--nested-dialogs`, backdrop suprimido ou parent escalado. | Estrutura de componentes — `ProdutoModal` segue em `SecaoCatalogo` |
| RN-8 | Comprabilidade **não** filtra a navegação: prato em promoção e esgotado continua listado e continua abrindo o detalhe (sem CTA de compra). Esgotado e promoção são ortogonais. | Cliente (navegação/ausência de CTA) + **Server Action + RLS** (a compra) |
| RN-9 | Opcionais e frase de vigência do prato promocional vêm **prontos do servidor**; o cliente não busca nem deriva nada no caminho do modal. | Servidor — `derivarPromocionaisParaModal` em `page.tsx` |
| RN-10 | Alvo de toque de cada linha ≥ 44px em valor **literal** (`design-system.md` §5 — base de fonte 120%, `min-h-11` não vale 44px), com rótulo acessível de `rotuloPrecoAcessivel` (senão o cliente cego ouve só o preço cheio, 233). | Cliente — revisão de código |
| RN-11 | Nenhum handler de `touchstart`/`pointerdown`/`mousedown` entra no modal promocional: só `onClick`, para preservar a regra nativa "click exige down E up no mesmo elemento" — é o que impede um gesto iniciado na página de ativar um prato do modal que apareceu no caminho do dedo. | Revisão de código — trava herdada do modal |
| RN-12 | O store de produto em foco **não persiste** e é zerado quando `SecaoCatalogo` desmonta (navegação client-side para outra loja), para não abrir modal sozinho ao voltar. | Cliente — cleanup de efeito em `SecaoCatalogo`, coberto por teste do store |
| RN-13 | `scrollspyCategorias.ts`, `NavCategorias.tsx`, `CardProduto`, `ItemProdutoLista` e `layoutVitrine.ts` **não são tocados**. | `git diff` na revisão |

**Supersessão declarada:** a `specs/arquivo/desconto-por-produto-e-pratos-promocionais.md` (§5.4)
decidiu que as linhas do modal seriam **não interativas** ("o único CTA é o do rodapé"), e o
comentário em `ModalPromocoes.tsx` repete a decisão. Esta spec a substitui: o CTA único levava ao topo
do `<main>` e transformava a promoção num beco sem saída. O argumento original — "três alvos dentro de
um modal que o cliente não abriu" — segue válido quanto a **toque acidental**, e é por isso que a
RN-11 é explícita e as sete travas permanecem. Comentários do arquivo e a referência arquivada devem
ser corrigidos junto com a implementação (trabalho do `escriba`; `design-system.md` não descreve esse
modal e não precisa mudar).

## Segurança (obrigatório)

- **Que dado sensível entra/sai?** Nenhum. Sem PII de cliente, sem chave Pix, sem cupom, sem token de
  pedido, sem secret. O que trafega a mais no payload é o que o catálogo já expõe (grupos de opcional
  públicos e frase de vigência, ambos já no payload pelo ramo do catálogo). O `localStorage` continua
  guardando só `"YYYY-MM-DD"` por slug de loja, em try/catch (RN-18); o store novo não persiste nada.
- **Algum valor monetário?** Nenhum novo, e **nenhum recálculo no cliente**. Preço efetivo, selo e
  `temDesconto` chegam prontos no `ProdutoVitrine`; o modal apenas imprime (`PrecoProduto`,
  `SeloDesconto`) e o subtotal do detalhe é **preview**. O valor cobrado continua **recalculado na
  Server Action do checkout a partir do banco** (`seguranca.md` §10).
- **A trava de promoção continua de pé — e é o motivo de D1 recusar um segundo modal.** Toda adição,
  venha do card ou do modal promocional, passa pelo **mesmo** `confirmarAdicao`, que marca
  `temDesconto: true` e alimenta `promocaoExibida` no payload do pedido (238/RN-12-a). Duplicar o
  `ProdutoModal` criaria um segundo montador desse payload — um caminho de compra onde a trava do
  servidor deixaria de disparar em silêncio. Uma instância, um montador: garantido em **Server Action
  + RLS** na ponta, e estruturalmente no cliente por RN-4.
- **Tabela nova?** Não — nenhuma política RLS nova. O conjunto de produtos continua vindo do SSR sob
  `anon` + RLS (RN-1 da vitrine); o cliente não pode fazer aparecer no modal um produto que a RLS não
  revelou, porque a lista é derivada **no servidor** do catálogo já carregado.
- **Isolamento entre lojas:** nada é lido por `loja_id` no cliente; a feature opera dentro do payload
  da própria página, já escopado pela RLS da vitrine. Nenhum caminho novo de leitura cross-tenant.
- **Store global no cliente é superfície nova?** É estado de UX em memória (qual produto está em foco),
  do mesmo tipo do carrinho, que já é store de módulo. Forçar o store pelo devtools abre um modal com
  dados que o cliente **já recebeu** e não altera preço, disponibilidade nem o que o servidor cobra.
  Não persiste, não cruza loja (RN-12).
- **API externa com key?** Não.
- **Erro interno não vaza:** prato pendente sem dados ou store inconsistente ⇒ o modal simplesmente não
  abre (estado fechado é o default), sem toast nem mensagem técnica.

## Testabilidade (restrição de ambiente)

Suíte em Vitest `environment: node` — **sem jsdom, sem Playwright, sem MCP de browser** (`CLAUDE.md`).
Foco, animação de fechamento e trava de scroll do Base UI **não** são observáveis por teste aqui. Por
isso o desenho empurra tudo o que é decisão para módulos puros:

- `src/hooks/useProdutoEmFoco.test.ts` (**novo**): abre com dados e origem; `fechar` zera `aberto` sem
  perder identidade até a próxima abertura; `getServerSnapshot` é o estado fechado (nada no SSR);
  `subscribe` notifica e o `unsubscribe` para de notificar; dois `abrir` seguidos substituem o produto
  (nunca dois em disputa). Mesmo estilo do `useCarrinho.test.ts` já existente.
- `lib/utils/catalogoVitrine.test.ts` (existente, já cobre a RN-15 na linha ~395): ganha
  `derivarPromocionaisParaModal` — filtra só `temDesconto`, acopla `gruposOpcionais` da categoria certa,
  acopla `rotuloIndisponivel` por id, produto sem categoria não recebe opcionais, e **não** inventa
  rótulo quando a chave falta.
- `ModalPromocoes.test.tsx` (existente, `renderToStaticMarkup` — não roda efeitos): prova de **árvore**
  — cada prato listado é um `<button type="button">` com altura mínima literal e rótulo acessível de
  `rotuloPrecoAcessivel`; a linha "e mais N" **não** é botão; os dois CTAs do rodapé seguem lá; nenhum
  handler de `pointerdown`/`touchstart` no arquivo (RN-11, verificável por leitura/`grep` no teste ou
  na revisão). **Não** tentar provar foco, sequenciamento ou abertura do `ProdutoModal` ali.
- `superficiesPromocao.test.ts` / `superficiesProdutoVitrine.test.ts` / `SecaoCatalogo.test.tsx`
  (existentes): continuam valendo; conferir que a troca de `useState` pelo store não mudou a árvore
  renderizada com o modal fechado (o `Dialog` fechado não emite popup).
- `decisaoModalPromocoes.test.ts`: **não muda.**
- Verificação final é manual, no browser, na loja de teste padrão ("Lanches base"), em viewport mobile:
  limpar o `localStorage` da loja, recarregar, tocar no segundo prato do modal e observar (a) o modal
  promocional fechar, (b) o `ProdutoModal` do prato certo abrir com o preço promocional, (c) adicionar
  ao carrinho e a barra do rodapé aparecer com o valor com desconto, (d) fechar o `ProdutoModal` e o
  modal promocional **não** reabrir, a página seguir rolável e o foco estar no `<main>`. Repetir com um
  prato em promoção **e** esgotado (detalhe abre, sem CTA) e com um prato de categoria
  `exibir_imagens = false` (o caminho não depende de como o catálogo desenha o prato).

## Fora do Escopo (v1)

- **Rolar a tela até o card do produto.** Descartado pelo usuário: "não quero que a tela role até o
  produto, mas abra o modal para ele ser adicionado ao carrinho". Não sobrevive nem como efeito
  secundário — seria uma segunda mecânica (marcação de alvo no DOM, `scroll-margin` compartilhado,
  elementos focáveis) sem entrega própria, agora que o destino é o modal. O lugar do cliente ao fechar
  o detalhe é resolvido **de graça** pelo `finalFocus` do Base UI apontando para o `<main>` (RN-6), que
  já existe desde a 234. Consequência: **não** entram `data-produto-id`, `tabIndex` novos em
  `CardProduto`/`ItemProdutoLista`, guarda de uuid para seletor, módulo de busca de alvo no DOM, nem a
  mudança de `ESTILO_ANCORA_CATEGORIA` para `layoutVitrine.ts` (itens da v0.1.0 deste spec, removidos).
- **Mudar quando o modal promocional abre** (frequência, gatilho, contagem de acessos, `scrollY`,
  temporizador) — restrição declarada; `decisaoModalPromocoes.ts` não é tocado.
- **Mexer no scrollspy / trilho de chips** — território da `specs/flicker-chip-nav-categorias.md`; as
  duas specs não podem tocar `scrollspyCategorias.ts` na mesma branch (aqui, não tocamos).
- **Adicionar ao carrinho direto do modal promocional**, sem passar pelo `ProdutoModal` (sem opcionais
  nem quantidade) — atalho que pula o detalhe é justamente onde preço e opcionais caem no chão (D13).
- **Deep-link / hash na URL** para prato promocional; promoção compartilhável por link.
- **Aumentar o teto de 3 pratos listados**, paginar o modal, ou dar ação à linha "e mais N".
- **Realce/animação no catálogo** ao fechar o detalhe.
- **`tasks/267` — selo de promoção vs. cache de rota e foto em promocionais.** Segue issue própria:
  esta spec não muda a revalidação da rota nem a política de foto do modal.
- **Qualquer coisa no painel do lojista** (nenhuma tela, nenhum toggle) e nada do working tree em
  andamento (`tasks/287-*`, `tasks/288-*`, `src/components/painel/*`).
- **Métrica/telemetria** de conversão do modal promocional — relatórios são Fase 3 no
  `modelo-negocio.md`.
