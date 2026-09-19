## Plano Técnico

> Issue **não-crítica** pelos três mandatos (zero dinheiro, zero RLS, zero Server Action,
> zero auth) — **não** exige `tdd` red-first. É, porém, **perf-sensível**: `'use client'`
> na vitrine pública mobile-first, re-render por tecla digitada. Auditoria com `acelerar`
> depois de `executar`.

### Análise do Codebase

**Já existe e será reusado — nada disto se reimplementa:**

| Arquivo | O que faz | Como é usado na 202 |
|---|---|---|
| `src/lib/utils/buscarProdutos.ts` (199) | `normalizarBusca`, `filtrarCatalogo`, `partirPorTermo` | **Toda** a lógica de casamento. `CatalogoVitrine` chama só `filtrarCatalogo`. `partirPorTermo` já é consumida por `TextoRealcado` — a 202 **não** a importa direto. |
| `src/components/vitrine/TextoRealcado.tsx` (200) | Projeta `partirPorTermo` em `<mark>` como nós React (RN-9) | Já plugado dentro de `CardProduto`/`ItemProdutoLista`. A 202 só faz o `termo` chegar até lá. |
| `src/components/vitrine/SecaoCatalogo.tsx` | Já aceita `termo?: string` (prop existente, hoje sempre `undefined`) e repassa a `CardProduto`/`ItemProdutoLista` | **Assinatura inalterada.** A 202 é quem finalmente passa o valor. |
| `src/components/vitrine/CatalogoVitrine.tsx` (201) | Dono do `<main>`, da barra sticky, da medição `--altura-barra` (`useLayoutEffect` + `medirEObservarBarra`) e do slot marcado `{/* 202: <BuscaProdutos/> ... */}` | Ganha `useState` do `termo`, o `useMemo` do filtro, o `useRef` do input e a região viva. |
| `src/components/vitrine/NavCategorias.tsx` (203) | Trilho de chips + scrollspy; gate RN-4 (`< 3` categorias → `null`) antes de qualquer hook | Passa a ser **DESMONTADA** em modo busca (ver D2). Assinatura inalterada. |
| `src/components/vitrine/medicaoBarraVitrine.ts` (201) | `ResizeObserver` + `--altura-barra`, `aoMedir` só dispara quando a altura muda | **Zero mudança.** A troca trilho↔resumo muda a altura da barra e ele já reage (é literalmente o caso citado no comentário do módulo). |
| `src/components/vitrine/layoutVitrine.ts` (201) | `ESCADA_LARGURA_VITRINE`, `CLASSES_MAIN_VITRINE` | Reuso direto; nenhuma quarta cópia da escada de `max-w`. |
| `src/components/ui/input.tsx`, `button.tsx` | shadcn/Base UI | Reuso com `className` de override. **Não editar à mão.** |
| `lucide-react` `^1.18.0` | `Search`, `X`, `SearchX` | Já no `package.json`. |
| `confirmacao/StatusPedidoLive.tsx` | Precedente de `<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">` **e** de mecânica de timer extraída para função pura testável com fake timers (`criarControladorPolling`) | Copiar os dois padrões. |
| `scrollspyCategorias.ts` / `medicaoBarraVitrine.ts` | Precedente de **módulo neutro** (sem diretiva), deps injetadas, testado em `environment: node` | Molde para `resumoBusca.ts` e `anunciadorBusca.ts`. |
| `src/app/globals.css` | `--cor-destaque`, `--texto-muted`, `--borda-nav` já mapeados para utilities (`text-destaque`, `outline-destaque`, `border-borda-nav`, `text-texto-muted`) | Zero token novo. |
| `mockups/vitrine-nav-categorias-e-busca.html` §`.campo-busca`, `#resumo-busca`, `#vazio-busca` | Marcação e medidas aprovadas | Traduzir 1:1 para JSX/Tailwind. |

**Precisa ser criado (e por que não dá pra reusar):**

- `src/components/vitrine/BuscaProdutos.tsx` — não existe nenhum campo de busca na vitrine
  (o único `Input` de busca do projeto está em `painel/produtos`, com estado e layout de painel,
  sem os requisitos de 44px literal / 16px / `Esc` com `stopPropagation`). Componente controlado,
  sem estado próprio.
- `src/components/vitrine/resumoBusca.ts` — **módulo neutro** com `contarProdutos`,
  `textoResumoBusca`, `textoAnuncioBusca`. Não existe util de pluralização em `lib/utils/`
  (`grep -rn "plural" src/` vazio). Fica aqui e não em `lib/utils/` porque é copy de UI da
  vitrine, não regra de domínio — mesmo critério de `statusConfirmacaoUi.ts` (copy) vs.
  `transicaoStatus.ts` (regra). **É o que torna o modo-busca testável em `environment: node`.**
- `src/components/vitrine/anunciadorBusca.ts` — **módulo neutro** `criarAnunciadorBusca({ aoAnunciar, atrasoMs })`
  com `anunciar(texto)` / `parar()`. Não reusa `salvamento-coalescido.ts` (tem semântica de
  coalescer *escrita assíncrona com in-flight guard* — peso e API errados para "atrasar uma string 500ms")
  nem `comTimeout` (é corrida, não debounce). 15 linhas, testáveis com `vi.useFakeTimers()`.
- `src/components/vitrine/EstadoVazioBusca.tsx` — pode nascer dentro de `BuscaProdutos.tsx`
  ou como arquivo próprio; **não reusa** o empty state de loja sem produtos em `page.tsx`
  (é Server Component, copy diferente, sem CTA que devolve foco).

**NÃO criar:** nenhum hook de debounce genérico, nenhum `useSearch`, nenhum util de
normalização (199 já resolveu), nenhum `ui/command.tsx`/`ui/combobox` do shadcn
(spec §Fora do Escopo: não é combobox, não há popup).

### Decisões de arquitetura

- **D1 — `termo` mora em `CatalogoVitrine`, e o `ref` do input também.** O `useRef<HTMLInputElement>`
  fica no pai porque **três dos quatro caminhos de limpar nascem fora do `BuscaProdutos`**
  ("Limpar" do resumo, que está na barra; CTA do vazio, que está no `<main>`). Uma única
  `limpar = useCallback(() => { setTermo(""); inputRef.current?.focus(); }, [])` serve aos quatro
  e é a garantia estrutural de que o foco nunca cai no `<body>`. `BuscaProdutos` recebe
  `inputRef` como prop nomeada (explícito; `ref`-as-prop do React 19 funcionaria, mas
  `inputRef` deixa claro que o pai é o dono).
- **D2 — `NavCategorias` é DESMONTADA em modo busca, nunca `display:none`.** `{termo ? <ResumoBusca/> : <NavCategorias/>}`.
  Ocultar por CSS mantém o `IntersectionObserver` vivo observando `<section>` que
  `filtrarCatalogo` tirou do DOM — observer sobre nó órfão não dispara, o chip ativo congela no
  valor velho e, ao limpar a busca, o scrollspy volta errado. Desmontar roda o cleanup de
  `criarScrollspy` e reconstrói do zero na limpeza. Já antecipado no comentário do slot em
  `CatalogoVitrine.tsx` e na doc de `alturaBarra` em `NavCategorias.tsx`.
- **D3 — a região viva fica FORA do `<div ref={barraRef}>`,** irmã da barra, como no mockup
  (`<p id="busca-resumo">` fora de `.barra-sticky`). Mesmo sendo `sr-only`, mantê-la fora do
  nó medido elimina qualquer chance de o `ResizeObserver` reagir à troca do texto anunciado.
  **Uma única** região no componente inteiro, nunca aninhada (4.1.3).
- **D4 — filtragem síncrona, anúncio com debounce.** São dois caminhos distintos a partir do
  mesmo `termo`: `useMemo(() => filtrarCatalogo(categorias, termo), [categorias, termo])` roda
  no render (frame, sem debounce) e `criarAnunciadorBusca` agenda o texto do `aria-live` em 500ms.
  Nunca debouncar o `termo` em si — isso atrasaria a filtragem visual, que o spec exige imediata.
- **D5 — `filtrarCatalogo` devolve a MESMA referência quando o termo é vazio** (contrato
  documentado na 199). Isso faz `SecaoCatalogo` não re-renderizar por identidade nova quando
  a busca está vazia: preservar esse caminho é requisito de perf, não detalhe.
- **D6 — nenhum `id` literal.** `useId()` para `htmlFor`/`id` do input e para o
  `aria-describedby` → id da região viva. O mockup usa ids fixos porque é HTML estático.
- **D7 — `type="search"` do `Input` do shadcn com override, sem editar `ui/input.tsx`.**
  O default do componente é `h-8` (26,6px na base 120%) e `md:text-sm` — ambos violam o critério.
  Override via `className`: `min-h-[44px] text-[16px] md:text-[16px] rounded-full ...`.
  O `md:text-[16px]` é **obrigatório** para vencer o `md:text-sm` do componente (mesma
  especificidade, ordem de `tailwind-merge` resolve). `size="icon-sm"` é **proibido** no ✕
  (33,6px) — o ✕ é `<button>` cru com `min-h-[44px] min-w-[44px]`, não `Button` com size.
- **D8 — `<form role="search" onSubmit={(e) => e.preventDefault()}>`.** Sem action, sem
  navegação: Enter no campo não pode recarregar a página (`enterkeyhint="search"` só pinta a
  tecla do teclado virtual).

### Cenários

**Caminho feliz**
1. Cliente abre `/loja/[slug]`. SSR entrega `categoriasComProdutos` (já filtrado por RLS +
   `vitrine_lojas` + gate de assinatura — RN-1). `CatalogoVitrine` monta com `termo === ""`.
2. Barra sticky mostra `BuscaProdutos` (campo vazio, sem ✕) + `NavCategorias`. `<main>` mostra o
   catálogo íntegro (`filtrarCatalogo` devolveu a mesma referência — D5).
3. Cliente digita `p`, `a`, `o`. A cada tecla: `setTermo` → `useMemo` refiltra → `SecaoCatalogo`
   re-renderiza só com as categorias que casam, com `termo` descendo até `TextoRealcado` → `<mark>`
   em "**Pão** de queijo". **Zero requisição de rede.**
4. Ao mesmo tempo, `NavCategorias` desmonta e o resumo "3 produtos encontrados para “pao” · [Limpar]"
   toma seu lugar. A barra muda de altura → `medirEObservarBarra` republica `--altura-barra`.
5. 500ms depois da última tecla, a região viva recebe "3 produtos encontrados" — **um** anúncio, não três.
6. Cliente toca num card filtrado → `ProdutoModal` abre e adiciona ao carrinho exatamente como
   sempre (a busca não toca esse caminho; o valor cobrado continua recalculado na Server Action
   de checkout — RN-8, `seguranca.md` §10).
7. Cliente toca ✕ → `termo=""`, foco volta ao input, catálogo íntegro, `NavCategorias` remonta e
   o scrollspy reconstrói.

**Casos de borda**

| Situação | Comportamento exigido |
|---|---|
| Campo vazio / só espaços / só acentos (`"~~~"`) | `normalizarBusca` devolve `""` → `filtrarCatalogo` devolve a mesma referência → **modo normal**: trilho de volta, sem resumo, sem estado vazio, região viva zerada. O gate é `normalizarBusca(termo) !== ""`, **nunca** `termo !== ""` — senão digitar um espaço esconde o trilho e mostra "N produtos encontrados para “ ”". |
| Nenhum produto casa | `<main>` mostra `EstadoVazioBusca` (`SearchX` + "Nenhum produto encontrado para “x”." + CTA 44px). **Nunca tela em branco.** O resumo na barra mostra "0 produtos encontrados"; a região viva anuncia "Nenhum produto encontrado para x". |
| Exatamente 1 resultado | "1 produto encontrado" — singular. Coberto por teste unitário de `textoResumoBusca`. |
| Catálogo vazio (loja sem produtos) | `CatalogoVitrine` **nem é montado** — `page.tsx` já desvia para o empty state server-side (`temVazio`). Sem barra, sem busca. Inalterado. |
| Loja com 1 ou 2 categorias | `NavCategorias` já devolve `null` (RN-4). A busca **continua existindo** — o gate de 3 categorias é da nav, não da busca. Em modo busca, o resumo aparece normalmente onde a nav não estava. |
| Categoria "Outros" (`id: null`) filtrada | A âncora vem de `ancoraCategoria(id, indice)` e o índice muda com o filtro → a `<section>` de "Outros" remonta. Inócuo: em modo busca o trilho não existe (D2), nenhum link aponta para ela, e o estado do `ProdutoModal` vive no `SecaoCatalogo` (pai), não no card. |
| `Esc` **com** texto | `limpar()` + `event.stopPropagation()` — o `Sheet` do carrinho (Base UI, fecha no `Escape` que sobe) **não** pode fechar por baixo. |
| `Esc` **sem** texto | Propaga normalmente (não chamar `stopPropagation`): o cliente ainda precisa fechar o `Sheet` com `Esc`. |
| Produto com `descricao: null` | `casaTexto` já trata (`if (!texto) return false`). Coberto pelo teste da 199. |
| Cliente sem JS / antes da hidratação | SSR renderiza o campo (inerte) e o catálogo íntegro. Nada quebra; os links do trilho continuam nativos. |
| Rotação do celular em modo busca | `ResizeObserver` remede; como `NavCategorias` está desmontada, nenhum observer é reconstruído à toa. |
| Falha de rede | **Não aplicável** — nenhuma chamada de rede nesta feature. É justamente o critério de aceite ("nenhuma requisição na aba Network"). |
| Sem permissão / loja inativa / assinatura vencida | **Não aplicável nesta camada**: `page.tsx` já não renderiza a vitrine. A busca nunca vê o dado. |

**Tratamento de erros.** Não há erro de usuário a tratar: sem rede, sem validação, sem servidor.
O único modo de falha real é `ResizeObserver`/`IntersectionObserver` indisponíveis — já tratado
por injeção com fallback `undefined` em `medicaoBarraVitrine`/`scrollspyCategorias` (201/203).
Nada é logado (o termo digitado **não** vai para console, Sentry ou analytics — `seguranca.md` §14
e spec §LGPD). Nenhum detalhe interno chega ao cliente porque não há caminho de servidor.

### Schema de Banco

**Nenhum.** Zero migration, zero tabela, zero coluna, zero política RLS, zero índice.
Nenhuma query nova em `lib/supabase/queries/`. A feature opera 100% sobre o payload RSC que
`buscarCategorias` + `buscarCatalogoPublico` + `buscarOpcionaisPorCategoria` já entregam
sob role `anon`. Confirmado contra `references/schema.md` e o spec §Modelos de Dados.

### Validação (zod)

**Nenhum schema zod.** Não há form submetido, não há Server Action, não há payload cruzando a
fronteira cliente↔servidor. O `termo` é `string` de estado local que nunca sai do componente:
não vai para a URL, nem para `sessionStorage`, nem para o banco, nem para log. Criar um schema
aqui seria cerimônia sem invariante a proteger.

### Recálculo no Servidor

**Nenhum valor monetário novo.** A busca não lê, escreve nem deriva preço, frete, desconto,
subtotal ou total. Os preços exibidos continuam sendo o mesmo preview de UX de hoje, e o valor
cobrado continua sendo recalculado do zero pela Server Action de checkout a partir do banco
(RN-8, `seguranca.md` §10) — caminho **intocado** por esta issue.

**Mapa cliente ↔ servidor (obrigatório mesmo sendo feature de UI):**

| Invariante | Onde é garantida | Esta issue mexe? |
|---|---|---|
| Quais produtos o cliente pode ver | RLS + view `vitrine_lojas` + gate de assinatura em `page.tsx` (servidor) | **Não.** |
| A busca não amplia o conjunto visível | `filtrarCatalogo` é **estritamente subtrativo** (só `Array.prototype.filter` sobre o payload do SSR — nunca fetch, nunca construção de item). Teto do atacante que edita o JS: ver o catálogo inteiro que **já estava** no payload. | Garantido por construção. |
| Valor cobrado | Server Action de checkout, recálculo a partir do banco (`seguranca.md` §10) | **Não.** |
| XSS via termo do cliente ou via nome/descrição do lojista | JSX (escape automático do React) + `TextoRealcado` monta `<mark>` como nós React. Sem `innerHTML`, sem concatenação de HTML, sem `RegExp` derivada do termo (RN-9, `seguranca.md` §15). | Mantido — a 202 só passa a string adiante. |
| Termo como seletor/URL/log | Nunca. Só comparação de string e texto visível. | — |

Nenhum arquivo `'use client'` desta issue carrega invariante de valor ou de permissão: é o
raro caso em que "só cliente" é a resposta **correta**, e o motivo está mapeado acima linha a linha.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**

| Arquivo | Conteúdo |
|---|---|
| `src/components/vitrine/resumoBusca.ts` | Módulo **neutro**. `contarProdutos(categorias): number`; `textoResumoBusca(total, termo): string` ("N produto(s) encontrado(s) para “x”", singular/plural); `textoAnuncioBusca(total, termo): string` ("Nenhum produto encontrado para x" \| "N produtos encontrados"). Deps zero. |
| `src/components/vitrine/resumoBusca.test.ts` | Singular/plural, zero resultados, aspas curvas na copy. `environment: node`. |
| `src/components/vitrine/anunciadorBusca.ts` | Módulo **neutro**. `criarAnunciadorBusca({ aoAnunciar, atrasoMs = 500 })` → `{ anunciar(texto), parar() }`. `clearTimeout` no `anunciar` e no `parar`. Precedente: `criarControladorPolling`. |
| `src/components/vitrine/anunciadorBusca.test.ts` | `vi.useFakeTimers()`: 3 chamadas em < 500ms → **1** anúncio, com o último texto; `parar()` cancela o pendente. |
| `src/components/vitrine/BuscaProdutos.tsx` | `'use client'`. Props: `{ termo, aoMudar, aoLimpar, inputRef }` — **controlado, sem estado próprio**. `<form role="search" onSubmit={preventDefault}>` + `<label className="sr-only">Buscar produto no cardápio</label>` + `<Search aria-hidden>` absoluta + `Input type="search" inputMode="search" autoComplete="off" enterKeyHint="search"` com `min-h-[44px] text-[16px] md:text-[16px]` + `<button>` ✕ (`aria-label="Limpar busca"`, `min-h-[44px] min-w-[44px]`, só renderiza com texto). `onKeyDown` do `Esc`. Exporta também `ResumoBusca` e `EstadoVazioBusca` (props puras, testáveis isoladamente) — ou arquivos irmãos, a critério do `executar`. |
| `src/components/vitrine/BuscaProdutos.test.tsx` | `renderToStaticMarkup`: `role="search"` presente, `type="search"`, `min-h-[44px]` e `16px` literais no input e no ✕, `sr-only` no label, ✕ ausente com `termo=""` e presente com `termo="pao"`. Mais `ResumoBusca`/`EstadoVazioBusca` com `termo` fixo (é o que torna o modo-busca cobrível sem jsdom). |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `src/components/vitrine/CatalogoVitrine.tsx` | `useState` do `termo`; `useRef<HTMLInputElement>`; `useId()`; `limpar` em `useCallback`; `const emBusca = normalizarBusca(termo) !== ""`; `useMemo` do `filtrarCatalogo`; `<BuscaProdutos/>` no slot marcado (com o próprio `px-4 pt-3 pb-2`); `{emBusca ? <ResumoBusca/> : <NavCategorias/>}`; região viva `sr-only` **fora** do `barraRef`, alimentada por `criarAnunciadorBusca` num `useEffect` com cleanup; `<main>` com `{semResultado ? <EstadoVazioBusca/> : <SecaoCatalogo ... termo={termo}/>}`. |
| `src/components/vitrine/CatalogoVitrine.test.tsx` | Estender, não reescrever: manter os 3 testes da 201 (a árvore de `termo=""` **não pode** mudar) e somar "com `termo` vazio, região viva existe, está vazia e é única" (`role="status"` ocorre exatamente 1×). |
| `src/components/vitrine/NavCategorias.tsx` | Só se o `executar` precisar: nenhuma mudança prevista de assinatura ou de lógica. Atualizar o comentário que diz "a 202 vai desmontá-la" para o tempo presente. |

**NÃO tocar**

- `src/components/ui/input.tsx`, `src/components/ui/button.tsx` — gerados pelo shadcn CLI; todo
  ajuste vai por `className` (mandato 2 / CLAUDE.md).
- `src/lib/utils/buscarProdutos.ts` e seu teste — contrato da 199 fechado e auditado
  (o `mapa[0] = 0` veio de achado do `auditar`). Se algo parecer faltar, é bug de consumo.
- `src/components/vitrine/TextoRealcado.tsx`, `CardProduto.tsx`, `ItemProdutoLista.tsx` — a prop
  `termo?` já existe e funciona; esta issue só a alimenta.
- `src/components/vitrine/SecaoCatalogo.tsx` — a prop `termo?` e o `ESTILO_ANCORA_CATEGORIA` já
  estão prontos para a 202.
- `src/components/vitrine/medicaoBarraVitrine.ts`, `scrollspyCategorias.ts` — a troca
  trilho↔resumo já é caso previsto e testado.
- `src/app/(publica)/loja/[slug]/page.tsx` — Server Component; continua entregando
  `categoriasComProdutos` íntegro. **Nada de `?q=`** (fora de escopo pelo spec).
- `supabase/migrations/`, `src/lib/supabase/queries/`, `src/lib/validacoes/`, `src/lib/actions/` —
  nenhum arquivo destas pastas é tocado. Se o `executar` sentir vontade de criar um, o plano
  está sendo violado.

### Dependências Externas

**Nenhuma.** Zero pacote novo, zero API externa, zero chamada de rede (cliente ou servidor).
`lucide-react ^1.18.0` (`Search`, `X`, `SearchX`) e o shadcn/Base UI já estão no `package.json`.

**Custo e quota (`architecture.md` §9 nº1):** **R$ 0,00 e nenhuma quota consumida.**
Sem Upstash (nenhum rate limit novo — não há endpoint), sem Nominatim, sem evento Sentry
(nada é logado), sem invocação serverless extra na Vercel (a filtragem roda no browser do
cliente, sobre dado já baixado). Não existe cenário de "quota estourada" porque não existe
consumo variável. O único orçamento em jogo é o de **bundle da vitrine**: a meta é acréscimo
marginal (um componente + dois módulos neutros, sem lib nova) — validado pelo `acelerar`.

### Ordem de Implementação

Não é issue crítica → **sem fase RED obrigatória do `tdd`**. Mesmo assim, os dois módulos
neutros nascem com teste junto, porque é o único jeito de cobrir copy e debounce num ambiente
sem jsdom.

1. **`resumoBusca.ts` + teste** — puro, sem React, sem DOM. Fixa a copy (singular/plural,
   aspas curvas) antes de qualquer JSX depender dela.
2. **`anunciadorBusca.ts` + teste** — puro, `vi.useFakeTimers()`. Prova o "um anúncio por
   parada de digitação" isolado do React, exatamente como `criarControladorPolling` fez na 131.
3. **`BuscaProdutos.tsx`** (+ `ResumoBusca`, `EstadoVazioBusca`) — componentes **controlados**,
   sem estado. Dependem de (1) para a copy. Testáveis com `renderToStaticMarkup` porque recebem
   `termo` por prop.
4. **Wiring em `CatalogoVitrine.tsx`** — por último, porque consome (1), (2) e (3):
   estado, `useMemo` do filtro, `inputRef`, troca trilho↔resumo, região viva, estado vazio.
   É o passo que **não** pode alterar a árvore renderizada com `termo=""` (os testes da 201
   são o guarda-corpo disso).
5. **Gate local completo:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
6. **Verificação manual em 360×640** (não automatizável — sem Playwright, sem MCP de browser):
   os quatro caminhos de limpar devolvendo o foco ao input; `Esc` com carrinho aberto não
   fechando o `Sheet`; aba Network silenciosa ao digitar; alvos de 44px a olho; sem zoom do
   Safari iOS no focus; título de seção não escondido atrás da barra ao limpar a busca.
7. **`acelerar`** — bundle da vitrine e jank de scroll/digitação no mobile (re-render por tecla
   com o catálogo inteiro é o ponto a medir).
