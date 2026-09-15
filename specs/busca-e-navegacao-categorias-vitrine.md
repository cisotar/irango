# Spec: Busca de produtos e navegação por categorias na vitrine

**Versão:** 0.1.0 | **Atualizado:** 2026-09-15

> Mockup aprovado: `mockups/vitrine-nav-categorias-e-busca.html` + contrato de interação em `mockups/vitrine-nav-categorias-e-busca.md` (agente `desenhar`). Este spec é a tradução daquele contrato em páginas, behaviors e critérios de aceite. Onde houver divergência, o contrato de interação manda no detalhe de UX; este spec manda no escopo.

## Visão Geral

Hoje `/loja/[slug]` renderiza o catálogo inteiro como uma pilha vertical de seções (`SecaoCatalogo`). Numa loja com 6+ categorias e dezenas de itens, o cliente no celular só tem a rolagem: não consegue pular para "Bebidas" nem achar "pão de queijo" sem varrer a página. Duas features resolvem isso, ambas **na vitrine pública, 100% no cliente**:

1. **NavCategorias** — carrossel horizontal de chips de categoria numa barra sticky no topo do catálogo. Toque num chip rola até a seção (`#cat-<id>`); o chip da categoria em tela fica marcado (scrollspy via `IntersectionObserver`).
2. **BuscaProdutos** — campo `role="search"` que filtra o catálogo conforme se digita, sobre os dados já entregues pelo SSR. Sem nova query, sem Server Action, sem round-trip.

**Mundo:** vitrine pública (`/loja/[slug]`), sem login.

**Não há dado nem valor autoritativo do servidor nesta feature.** O catálogo (produtos, preços, disponibilidade, categorias, `exibir_imagens`) já é resolvido no servidor pelo SSR existente (`buscarCategorias` + `buscarCatalogoPublico` + `buscarOpcionaisPorCategoria`, sob role `anon`, filtrado por RLS/`vitrine_lojas`). A busca **filtra em memória o que o servidor já entregou** e a nav **rola a página** — nenhuma das duas lê, escreve ou decide nada. Preço continua sendo preview de UX e continua sendo recalculado no checkout (`seguranca.md` §10) exatamente como hoje: nada nesta feature altera esse caminho.

Ambas são entregáveis independentes. A busca depende só de um util puro; a nav depende de exportar a função de âncora e de tornar a barra sticky.

## Atores Envolvidos

| Ator | Papel nesta feature |
|---|---|
| **Cliente final** | único ator. Digita para filtrar, toca em chip para navegar, limpa a busca. Sem login, sem escrita no banco. |
| **Lojista** | indireto: o conteúdo filtrado/navegado é o catálogo que ele cadastrou no painel (nome, descrição, categoria, ordem). Nenhuma tela nova de painel. |
| **iRango (SaaS)** | nenhum. Sem cobrança, sem entitlement, sem gate de módulo pago. |

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)
**Arquivo:** `src/app/(publica)/loja/[slug]/page.tsx` (Server Component, inalterado no que busca dado)
**Descrição:** o cliente vê o `HeaderLoja` (que continua rolando com a página — **não** vira sticky), abaixo dele a nova barra sticky com busca + carrossel de categorias, e abaixo o catálogo em seções. Ele pode tocar num chip para pular para a categoria, ou digitar para filtrar o cardápio inteiro. O rodapé com a barra do carrinho (`VitrineClient`) segue como está.

**Estrutura de componentes (nova camada client):**

```
page.tsx (server)
└── CatalogoVitrine.tsx  ('use client')   ← NOVO: dono do estado `termo`
    ├── BarraVitrine (sticky, dentro do CatalogoVitrine)
    │   ├── BuscaProdutos.tsx             ← NOVO
    │   └── NavCategorias.tsx             ← NOVO (oculto em modo busca)
    └── SecaoCatalogo.tsx                 ← existente, recebe categorias já filtradas
```

O estado do termo vive em `CatalogoVitrine` porque busca, nav e catálogo precisam do mesmo termo. `page.tsx` continua montando `categoriasComProdutos` no servidor e passa a entregá-lo a `CatalogoVitrine` em vez de direto a `SecaoCatalogo`.

**Componentes:**

- `HeaderLoja` — **reuso sem alteração**. Continua rolando (grudá-lo no topo comeria metade de um 360×640).
- `SecaoCatalogo` — **reuso estendido**: (a) exporta a função de âncora hoje privada; (b) troca `scroll-mt-24` (valor mágico de 6rem ≈ 115px na base 120%) por `scroll-margin-top` lendo `--altura-barra`; (c) aceita `termo` opcional para realçar o trecho que casou. Grade (`grid-cols-2 md:3 lg:4 xl:6`), título de seção e `ProdutoModal` inalterados.
- `CardProduto`, `ItemProdutoLista` — **reuso estendido**: aceitam `termo` opcional e renderizam `<mark>` no trecho casado de nome (e descrição, no `CardProduto`). Sem `dangerouslySetInnerHTML` — o realce é feito partindo a string em nós React (`seguranca.md` §15).
- `Input` (shadcn, `components/ui/input.tsx`) — **reuso** para o campo de busca, com override de `min-height: 44px` literal e `font-size: 16px`.
- `Button` (shadcn) — **reuso** para "Limpar" e para o CTA do estado vazio.
- `lucide-react` (`Search`, `X`, `SearchX`) — **reuso**, já é a lib de ícones do projeto.
- `NavCategorias.tsx` — **novo**, `src/components/vitrine/NavCategorias.tsx`. `<nav aria-label="Categorias do cardápio">` + `<ul>` + `<a href="#ancora">`. **Não** é `Tabs` e **não** é um carousel de lib: as seções não são painéis mutuamente exclusivos, e anunciar "aba 3 de 7" mentiria para o leitor de tela. **Não gerar `ui/tabs.tsx` nem `ui/carousel.tsx`.**
- `BuscaProdutos.tsx` — **novo**, `src/components/vitrine/BuscaProdutos.tsx`. `<form role="search">` + `Input` + botão limpar. **Não** é combobox (não há popup; o resultado é a própria página filtrada).
- `CatalogoVitrine.tsx` — **novo**, `src/components/vitrine/CatalogoVitrine.tsx`. Client wrapper: estado do termo, medição da barra, região viva única.
- `buscarProdutos.ts` — **novo util puro**, `src/lib/utils/buscarProdutos.ts`, com teste unitário ao lado.

**Tokens:** zero token novo. `--cor-primaria`, `--cor-fundo`, `--cor-destaque`, `--marrom-cafe`, `--texto`, `--texto-muted`, `--borda-nav`, `--cinza-medio`, `--radius` já cobrem tudo (`design-system.md` §4).

---

#### Behaviors — NavCategorias

- [x] **Ver os chips de categoria numa barra sticky** — a barra (busca + trilho) gruda em `top-0` com `z-30` ao rolar; o `HeaderLoja` rola para fora normalmente. Garantido em: cliente (UX puro). Os nomes e a ordem das categorias vêm do SSR.
- [x] **Tocar num chip e rolar até a categoria** — `<a href="#cat-<id>">` nativo: funciona antes da hidratação e com JS desligado. Garantido em: cliente (UX puro).
- [x] **Ver o chip da categoria em tela marcado** — `IntersectionObserver` sobre as `<section>`, `rootMargin: "-<altura-barra> 0px -55% 0px"`, `threshold: 0`. Sem listener de `scroll` (evita jank no mobile). Empate entre duas seções visíveis: vence a primeira na ordem do catálogo. Chip ativo recebe `aria-current="true"`. Garantido em: cliente (UX puro).
- [x] **Ver o chip ativo trazido para o centro do trilho** — `scrollIntoView({ inline: "center", block: "nearest" })`. `block: "nearest"` é **obrigatório**: sem ele o `scrollIntoView` sequestra o scroll vertical e o catálogo pula sozinho. Garantido em: cliente (UX puro).
- [x] **Clicar num chip marca o ativo imediatamente**, antes do observer reagir — senão o chip pisca no estado antigo durante o scroll suave. Garantido em: cliente (UX puro).
- [x] **Percorrer os chips por teclado** — Tab entra na lista, Enter navega. Sem `tabindex` custom, sem roving tabindex, **sem sequestrar ←/→** (o usuário ainda precisa das setas para rolar a página). O chip fora da viewport do trilho é trazido para dentro ao receber foco.
- [x] **Rolar o trilho com o dedo** — `overflow-x: auto`, `scroll-snap-type: x proximity`, `scroll-snap-align: center` nos chips, fade de 16px (`mask-image`) nas duas bordas como affordance de "tem mais". Sem botões de seta.
- [x] **Não ver o trilho quando ele não serve** — `NavCategorias` só renderiza com **≥3 categorias**; com 1 ou 2, a rolagem natural basta. A barra inteira não renderiza quando o catálogo está vazio (`temVazio`). Garantido em: cliente (derivado do dado do SSR).

#### Behaviors — BuscaProdutos

- [ ] **Digitar e ver o cardápio filtrar na hora** — filtragem síncrona sobre o catálogo já em memória. **Nenhuma query nova, nenhuma Server Action, nenhum fetch.** Garantido em: cliente (UX puro) — o conjunto de produtos filtrável foi definido pelo servidor no SSR (RLS + `vitrine_lojas` já limitaram a esta loja; o cliente não pode fazer aparecer produto que o servidor não mandou).
- [ ] **Achar "Pão" digitando "pao"** — casamento por substring sobre nome + descrição, normalizado (NFD, sem diacrítico, minúsculo, trim). Não é fuzzy: em cardápio de 40 itens, fuzzy traz falso positivo. Garantido em: cliente (`filtrarCatalogo`, util puro testado).
- [ ] **Ver por que o produto apareceu** — trecho casado envolto em `<mark>` no nome (e na descrição, quando o match veio dela). Agrupamento por categoria preservado no resultado. Garantido em: cliente. Renderização por nós React, nunca `dangerouslySetInnerHTML` (`seguranca.md` §15).
- [ ] **Ver o carrossel ser substituído pelo resumo durante a busca** — com termo não vazio, o trilho some e dá lugar a "N produtos encontrados para "x" · [Limpar]". Obrigatório: as âncoras do trilho apontam para seções que a filtragem removeu do DOM, e chip que não leva a lugar nenhum é pior que chip nenhum. Garantido em: cliente.
- [ ] **Ouvir a contagem no leitor de tela** — **uma única** região `role="status" aria-live="polite" aria-atomic="true"` `sr-only`, nunca aninhada, com debounce de **500ms** (senão o leitor recita um número por tecla). Precedente autoritativo: `confirmacao/StatusPedidoLive.tsx` e `LinhaTempoStatus.tsx`. A filtragem visual **não** tem debounce (é barata e tem que responder no frame).
- [ ] **Ver um estado vazio útil quando nada casa** — ícone + "Nenhum produto encontrado para "x"." + CTA **"Ver cardápio completo"** (44px), que limpa a busca e devolve o foco ao input. Nunca tela em branco (`design-system.md` §6, empty states).
- [ ] **Limpar a busca por quatro caminhos** — botão ✕ no campo (só aparece com texto, `aria-label="Limpar busca"`), "Limpar" na linha de resumo, CTA do estado vazio, e `Esc` no campo. Em todos, **o foco volta ao input** — limpar não pode jogar o foco no `<body>`.
- [ ] **Apertar `Esc` sem fechar o carrinho** — quando há texto no campo, o handler limpa e chama `stopPropagation()`, para não fechar o `Sheet` do carrinho por baixo. Sem texto, o `Esc` passa adiante normalmente.
- [ ] **Adicionar ao carrinho a partir de um resultado de busca** — clicar num card filtrado abre o `ProdutoModal` e adiciona como sempre. Garantido em: cliente para o preview (`useCarrinho`); **o valor cobrado continua recalculado na Server Action de checkout a partir do banco** (`seguranca.md` §10) — a busca não toca nesse caminho.

#### Behaviors — barra sticky e âncoras

- [x] **Chegar na categoria com o título visível** — a altura real da barra é **medida em runtime** (`ResizeObserver` + `getBoundingClientRect`, arredondada para cima) e publicada como `--altura-barra` no `documentElement`; `SecaoCatalogo` usa `scroll-margin-top: calc(var(--altura-barra) + folga)`. **Nunca valor fixo:** hoje `scroll-mt-24` é uma coincidência que quebra assim que a barra existir, escondendo o título atrás dela — o cliente acha que o link não funcionou. O `rootMargin` do scrollspy lê a **mesma** variável, senão scrollspy e âncora marcam pontos diferentes.
- [x] **Ver a barra remedida ao girar o celular ou trocar de modo** — o `ResizeObserver` reage a rotação, quebra de linha e à troca trilho ↔ resumo de busca (alturas diferentes). Garantido em: cliente.
- [x] **Não sofrer movimento indesejado** — `scroll-behavior: smooth` (na página e no `scrollIntoView` do chip) só dentro de `@media (prefers-reduced-motion: no-preference)`.

---

## Modelos de Dados

**Nenhuma mudança de schema. Nenhuma migration. Nenhuma tabela nova. Nenhuma política RLS nova.**

Tabelas lidas — todas pelo caminho SSR **já existente**, sem query nova (`schema.md`):

| Tabela / view | Papel | Como é lida |
|---|---|---|
| `vitrine_lojas` (view) | loja, tema, horários, assinatura | `buscarLojaPorSlug` — inalterado |
| `categorias` | nome, ordem, `exibir_imagens` | `buscarCategorias` — inalterado; alimenta chips **e** seções |
| `produtos` | nome, descrição, preço, foto, `disponivel` | `buscarCatalogoPublico` — inalterado; `nome` e `descricao` passam a ser também o corpus da busca |
| `opcionais` / grupos | opcionais do modal | `buscarOpcionaisPorCategoria` — inalterado |

O contrato de dado do cliente é o tipo `CategoriaComProdutos` que já existe em `SecaoCatalogo.tsx` — `filtrarCatalogo` recebe e devolve exatamente esse tipo. Nenhum campo novo trafega para o cliente: a busca opera sobre o payload RSC que já era enviado.

**Novo util puro** — `src/lib/utils/buscarProdutos.ts`:

```ts
export function normalizarBusca(s: string): string;            // NFD → sem diacrítico → lowercase → trim
export function filtrarCatalogo(
  categorias: CategoriaComProdutos[],
  termo: string,
): CategoriaComProdutos[];                                     // categoria sem match é removida
```

Verificado que não existe equivalente: a única normalização sem acento do projeto está presa dentro de `lib/validacoes/loja.ts` (geração de slug) e não é reutilizável.

**Função de âncora compartilhada** — `ancora(id, indice)` hoje é privada em `SecaoCatalogo.tsx`. Passa a ser exportada (ou sobe para um módulo compartilhado) e consumida por `NavCategorias` e `SecaoCatalogo`. Duas implementações de âncora = links quebrados na primeira vez que alguém mexer numa.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| RN-1 | O conjunto de produtos que o cliente pode filtrar é **exatamente** o que o SSR entregou (loja ativa, assinatura válida, produto visível, foto zerada em categoria sem imagem). A busca não amplia esse conjunto. | **Servidor**: RLS + view `vitrine_lojas` + gate de assinatura em `page.tsx` (já existentes). A busca é filtro estritamente subtrativo no cliente. |
| RN-2 | Casamento é por substring de `nome` + `descricao`, normalizado sem acento e sem caixa. Sem fuzzy. | Cliente (`filtrarCatalogo`, util puro com teste unitário). |
| RN-3 | Categoria sem nenhum produto casando é removida do resultado; categoria com match mantém título e agrupamento. | Cliente (`filtrarCatalogo`). |
| RN-4 | `NavCategorias` só renderiza com ≥3 categorias; a barra inteira não renderiza quando o catálogo está vazio. | Cliente, derivado do dado do SSR. |
| RN-5 | Durante a busca (termo não vazio), o trilho de categorias não é exibido. | Cliente. |
| RN-6 | `scroll-margin-top` das seções e `rootMargin` do scrollspy leem a **mesma** `--altura-barra`, medida em runtime. Valor fixo é proibido. | Cliente (CSS var + `ResizeObserver`). Critério de aceite verificável a olho. |
| RN-7 | Texto sobre `--cor-primaria` (chip ativo) é **branco fixo**, nunca derivado do tema da loja. | Cliente (`design-system.md` §4). |
| RN-8 | Preço, subtotal e total exibidos continuam sendo **preview de UX**. O valor cobrado é o recalculado pela Server Action de checkout a partir do banco. | **Server Action** (`seguranca.md` §10) — caminho existente, não alterado por esta feature. |
| RN-9 | O realce de match nunca usa `dangerouslySetInnerHTML`; o `<mark>` é montado como nós React sobre a string já escapada. | Cliente (`seguranca.md` §15). |

## Segurança (obrigatório)

- **Dado sensível entrando ou saindo?** Não. Nenhum PII de cliente, nenhuma chave Pix, nenhum cupom, nenhum token de pedido. O termo digitado fica em memória do componente — não é persistido, não vai para a URL, não é logado, não é enviado a lugar nenhum.
- **Valor monetário?** Não há cálculo novo. Preços exibidos continuam preview; o recálculo autoritativo no checkout (`seguranca.md` §10) permanece intocado. **Nenhum behavior desta feature pode influenciar quanto o cliente paga** — filtrar e rolar não alteram carrinho, cupom nem frete.
- **Tabela nova / RLS nova?** Não. Zero migration, zero política.
- **API externa com key?** Não. Nenhuma chamada de rede nova, nem cliente nem servidor.
- **Superfície de entrada não confiável:** (a) o **termo digitado pelo cliente** e (b) **nome/descrição de produto vindos do banco**, preenchidos por lojista. Ambos são renderizados só via JSX (escape automático do React) e, no realce, como nós React — nunca `dangerouslySetInnerHTML`, nunca concatenação de HTML (`seguranca.md` §15). O termo é usado apenas para comparar strings e para compor texto visível ("Nenhum produto encontrado para "x""), nunca como seletor CSS, `innerHTML`, regex construída dinamicamente ou parte de URL.
- **Bypass de visibilidade?** Impossível: a filtragem só remove itens de uma lista que o servidor já limitou. Um cliente que manipule o JS no máximo vê o catálogo inteiro que já estava no payload — o mesmo que ele veria sem a busca.
- **Cross-tenant?** Não aplicável: nada aqui consulta por `loja_id`; a página inteira já é escopada pelo slug no servidor.

**Performance (sensível — vitrine pública mobile-first, `'use client'` novo):**

- A barra é sticky e client; o catálogo (`SecaoCatalogo`) já era client. O novo wrapper `CatalogoVitrine` não deve aumentar materialmente o bundle da vitrine — orçamento: sem lib nova, sem dependência nova.
- Filtragem síncrona, sem `useMemo` desnecessário mas memoizada por `termo` para não refiltrar a cada render.
- Scrollspy por `IntersectionObserver`, **proibido listener de `scroll`**.
- `ResizeObserver` único, na barra, desconectado no unmount. `IntersectionObserver` reconstruído quando o conjunto de seções muda (busca) e desconectado no unmount.
- Auditoria com o agente `acelerar` após a implementação (bundle da vitrine + jank de scroll no mobile).

**Acessibilidade — critérios de aceite (WCAG 2.1 AA):**

| Critério | Contrato |
|---|---|
| 2.5.5 Alvo de toque | chip, input, ✕, "Limpar", CTA do vazio: `min-h-[44px]` **literal** (`min-h-11` vale 52,8px na base 120% e não é a régua; `size="icon-sm"` é proibido) — `design-system.md` §5. |
| 2.1.1 Teclado | Tab percorre, Enter navega. Sem `tabindex` custom, sem ←/→ sequestradas. |
| 2.4.7 Foco visível | `outline: 3px solid var(--cor-destaque); outline-offset: 2px` em chip e input; chip focado é trazido para dentro do trilho. |
| 4.1.3 Status | uma região `role="status" aria-live="polite" aria-atomic="true"` `sr-only`, debounce 500ms, nunca aninhada. |
| 3.3.2 Rótulo | `<label class="sr-only">` no input — placeholder não é label. |
| 1.4.1 Uso da cor | chip ativo = cor **+** sublinhado interno (`box-shadow: inset 0 -3px 0 rgba(255,255,255,.45)`), para a loja com `primaria` quase branca não perder a distinção. |
| 1.4.3 Contraste | texto sobre `--cor-primaria` branco fixo; chip inativo `--texto` sobre branco. |
| 1.4.4 Zoom / iOS | input a `font-size: 16px` — abaixo disso o Safari iOS dá zoom no focus e desloca o layout. |
| 1.4.10 Reflow | em 360px o trilho rola em X; o catálogo **nunca** rola em X. |
| 2.3.3 Movimento | `scroll-behavior: smooth` só sob `prefers-reduced-motion: no-preference`. |
| 4.1.2 Nome/função | `aria-label="Limpar busca"` no ✕; `<nav aria-label="Categorias do cardápio">` (a barra do carrinho já usa `aria-label="Resumo do carrinho"`). |

**Testes.** Não é issue crítica pelos três mandatos (zero dinheiro, RLS, Server Action de valor, auth) — não exige `tdd` red-first. O teste **obrigatório** é o unitário de `src/lib/utils/buscarProdutos.ts` em Vitest (`environment: node`), cobrindo: acento (`pao` → "Pão"), caixa (`CAFE` → "Café"), match por descrição, categoria sem match removida, termo vazio devolvendo o catálogo íntegro, termo só com espaços, produto com `descricao: null`. Scrollspy, `scroll-snap`, sticky e alvo de toque **não são testáveis automaticamente neste ambiente** (sem Playwright, sem MCP de browser): verificar a olho no mockup e depois na vitrine real, em 360×640.

## Fora do Escopo (v1)

- **Busca no servidor / full-text search.** O catálogo inteiro já vem no SSR; round-trip só pioraria. Se algum dia uma loja tiver centenas de itens, aí sim vira tema — não agora.
- **Fuzzy matching, correção de digitação, sinônimos, ranking por relevância.** Substring é suficiente e previsível num cardápio de dezenas de itens.
- **Persistir o termo na URL (`?q=`) ou no `sessionStorage`.** Busca é efêmera; deep link de resultado não foi pedido.
- **Histórico de busca, sugestões, autocomplete com popup.** Seria combobox — descartado no contrato de interação.
- **Busca por preço, faixa de preço, filtro por disponibilidade ou por tag.**
- **`ui/tabs.tsx` e `ui/carousel.tsx` do shadcn.** Não devem ser gerados — a nav é `<nav>` + links âncora.
- **Tornar o `HeaderLoja` sticky** ou colapsar o campo de busca em ícone ao rolar. Busca escondida não é usada.
- **Botões de seta no trilho.** No mobile ninguém usa; no desktop o Tab já percorre.
- **Truncar nome de categoria.** Nome truncado de categoria não identifica nada — `white-space: nowrap` e o trilho rola.
- **Qualquer mudança no painel do lojista** (ordenar categorias, destacar categoria na nav, configurar busca).
- **Métrica/analytics de termo buscado.** Envolveria coletar comportamento do cliente — decisão de LGPD (`modelo-negocio.md` §7), não de UI. Fora da v1.
- Itens de fase 2/3 do roadmap (subdomínio por loja, realtime, relatórios) seguem fora.
