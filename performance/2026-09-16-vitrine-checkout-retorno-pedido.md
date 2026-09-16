# 2026-09-16 — vitrine, checkout e o retorno de `/pedido` para a vitrine

Auditoria sob demanda (não ligada a issue). Queixa do usuário: "o carregamento do
site, principalmente o fluxo de checkout e, principalmente, quando se volta de
`/pedido` para a vitrine".

## Contexto

Arquivos lidos por inteiro:

- `src/app/(publica)/loja/[slug]/page.tsx`
- `src/app/(publica)/loja/[slug]/pedido/page.tsx`
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx`
- `src/components/vitrine/{VitrineClient,Carrinho,CatalogoVitrine,CardProduto}.tsx`
- `src/components/vitrine/checkout/CheckoutWizard.tsx`
- `src/lib/supabase/queries/{lojas,categorias,produtos}.ts`
- `src/lib/supabase/{server,middleware}.ts`, `middleware.ts`, `next.config.ts`
- `src/hooks/useCarrinho.ts`

Baseline consultada: `performance/2026-07-09-vitrine-checkout.md`,
`2026-09-07-159-paralelizar-leituras-criarpedido.md`,
`2026-09-13-163-zod-fora-do-bundle.md` e as quatro de 2026-09-15 (199–204).

## Medições

Loja-alvo: `lanches-base` (14 categorias, 68 produtos, 0 opcionais).

### 1. Latência por query contra o Supabase cloud (anon, script descartável)

| # | query | ms | bytes |
|---|---|---|---|
| 1 | `buscarLojaPorSlug` (page) | 177 | 1.117 |
| 2 | `buscarCategorias` | 82 | 2.747 |
| 3 | `buscarCatalogoPublico` | 75 | 30.207 |
| 4 | `buscarOpcionaisPorCategoria` | 110 | 4 |
| | **soma sequencial da page** | **445** | |
| 5 | `buscarLojaPorSlug` (generateMetadata) | 45 | 1.117 |
| 6 | `buscarLojaPorSlug` (generateViewport) | 57 | 1.117 |

`/pedido`: `buscarLojaPorSlug` 37 ms + `Promise.all([zonas, formas])` 54 ms = **91 ms**.

→ A vitrine custa ~5× o checkout em trabalho de servidor, e paga 3 leituras
idênticas da mesma loja (1.117 B cada) por render.

### 2. `next build` + `next start` (produção real, porta 3123)

| rota | TTFB | bytes |
|---|---|---|
| `/loja/lanches-base` HTML (frio) | 690 ms | 151.287 |
| `/loja/lanches-base` HTML (quente) | 256 ms | 151.287 |
| **`/loja/lanches-base` payload RSC (`RSC: 1`) — é isto que a volta baixa** | 199 ms | **66.240** |
| `/loja/lanches-base/pedido` HTML | 191 ms | 19.590 |

JS da vitrine: **341.506 B gzip em 18 chunks** (baseline da auditoria 204:
339.626 B / 18 chunks → +0,6 %, dentro do ruído de build; **sem regressão**).

Tabela de rotas do build: `ƒ /loja/[slug]`, `ƒ /loja/[slug]/pedido`,
`ƒ /loja/[slug]/confirmacao` — **todas dinâmicas**, sem `generateStaticParams`,
sem `revalidate`, sem `'use cache'`.

### 3. Varreduras

- `find src/app -name "loading.tsx" -o -name "error.tsx" -o -name "template.tsx"` → **zero resultados**.
- `grep -rn "dynamic(\|lazy(\|Suspense" src/components/vitrine src/app/(publica)` → **zero resultados**.
- `grep` por `cache(` nas queries públicas → zero (o padrão existe no projeto:
  `src/app/(painel)/painel/(bloqueavel)/layout.tsx:1`).
- Não existe `src/app/(publica)/layout.tsx` — nenhum fetch duplicado de layout.
- `revalidatePath("/loja/<slug>")` só é disparado por ações do **lojista/admin**
  (`lib/actions/produto.ts:371`, `lib/actions/loja.ts:54`, `lib/actions/logo.ts:35`,
  `lib/actions/admin-loja.ts:190`). **Nada no fluxo do comprador invalida a vitrine** —
  a hipótese de "o checkout invalida o cache" está descartada.
- Lighthouse **não executado**: sem Chrome no ambiente.

## Findings

### F1 — GARGALO — volta para a vitrine não tem prefetch nem cache de router
`src/components/vitrine/checkout/CheckoutWizard.tsx:176` (idem `:213` e
`src/components/vitrine/Carrinho.tsx:150`)

```ts
const voltarHeader = useCallback(() => {
  if (etapa === 1) {
    router.push(`/loja/${lojaSlug}`);
```

Toda a navegação vitrine↔checkout é `router.push()` imperativo dentro de
`onClick`. Sem `<Link>` não há **prefetch** do App Router, e como a rota é `ƒ`
(dinâmica) o Router Cache do Next 16 tem `staleTimes.dynamic = 0` por padrão —
ou seja, a volta **nunca** reusa nada e refaz o render inteiro no servidor.
Impacto medido: 66.240 B de RSC + 199 ms de servidor com cache do processo
quente (445 ms de query fria contra o cloud). Em 4G isso vira 1–2 s.
Contraste no próprio repo: `confirmacao/page.tsx:318` já usa o padrão certo
(`Button nativeButton={false} render={<Link href={...}>}`).

**Fix:** trocar os três `router.push` de volta por `<Link prefetch>` renderizado
pelo `Button` (padrão já existente) e avaliar
`experimental: { staleTimes: { dynamic: 30 } }` em `next.config.ts` para que o
back reuse o Router Cache. Verificar a chave contra a doc do Next 16.2 antes.

### F2 — GARGALO — nenhum `loading.tsx` na árvore pública
`src/app/(publica)/loja/[slug]/` (ausência de arquivo)

Sem Suspense boundary, o App Router **segura a navegação inteira**: o usuário
continua vendo `/pedido` sem nenhum feedback durante todo o RTT + render da
vitrine. É literalmente a sensação de "travou" descrita na queixa — e é o
agravante que transforma os 199–690 ms de F1 em tela morta.

**Fix:** `src/app/(publica)/loja/[slug]/loading.tsx` com skeleton de header +
grid de cards, com `width`/`height` explícitos para manter CLS ~0.

### F3 — GARGALO — `buscarLojaPorSlug` roda 3× por render da vitrine
`src/app/(publica)/loja/[slug]/page.tsx:57` (generateMetadata), `:86`
(generateViewport) e `:100` (page)

Três round-trips à mesma linha de `vitrine_lojas` (1.117 B idênticos, 45–177 ms
cada). `createClient()` usa `cookies()`, então não há dedup de `fetch` do Next.

**Fix:** memoizar por request com `cache()` do React — o padrão já está em uso em
`src/app/(painel)/painel/(bloqueavel)/layout.tsx:1`. Elimina 2 RTTs (~100 ms
medidos) sem mudar contrato.

### F4 — GARGALO — waterfall de 4 queries sequenciais na vitrine
`src/app/(publica)/loja/[slug]/page.tsx:100,142,143,151`

`loja → categorias → catálogo → opcionais`, tudo com `await` em série: **445 ms
somados**. Só a primeira dependência é real. `buscarCategorias` e a consulta a
`produtos` dentro de `buscarCatalogoPublico` precisam apenas de `lojaId` — o
parâmetro `categorias` daquela função é usado só no **agrupamento em memória**
(`produtos.ts:78-102`), depois da query. O `/pedido` já faz o certo
(`pedido/page.tsx:70`, `Promise.all`).

**Fix:** separar fetch de agrupamento em `buscarCatalogoPublico` e rodar
`Promise.all([buscarCategorias, <produtos>])`, agrupando depois; opcionais
seguem como 3ª etapa. 4 RTTs → 3, economia medida ~75–150 ms.

### F5 — CUSTO — `select("*")` nas duas queries mais pesadas da vitrine
`src/lib/supabase/queries/produtos.ts:70` e `src/lib/supabase/queries/lojas.ts:51`

`produtos.select("*")` devolve 12 colunas × 68 linhas = **30.207 B**, mas a page
projeta só 8 (`page.tsx:164-174`) — `loja_id`, `criado_em`, `atualizado_em` e
`oculto` trafegam à toa. `vitrine_lojas.select("*")` traz 20 colunas; a page usa 9.

**Fix:** projetar explicitamente as colunas consumidas. Atenção: `buscarCatalogoPublico`
também serve o painel? Não — o painel usa `buscarProdutosDoLojista`. Mudança
contida na vitrine. Corta ~25–30 % do payload da query dominante.

### F6 — CUSTO — `ProdutoModal` estático no bundle inicial
`src/components/vitrine/SecaoCatalogo.tsx:8`

O modal só aparece no clique de um card, mas entra no grafo do primeiro paint.
Zero `dynamic()`/`lazy()` em toda a vitrine.

**Fix:** `dynamic(() => import("@/components/vitrine/ProdutoModal"), { ssr: false })`.
Delta não medido isoladamente — validar com o método de soma de chunks das
auditorias 201/204 (`next start` + parse do HTML) antes de aceitar.

### F7 — CUSTO (pré-existente, já rastreado) — imagens de produto sem otimização
`src/components/vitrine/CardProduto.tsx:57` — `unoptimized`, sem `sizes`, sem
`priority`. Já é `tasks/205-imagens-de-produto-nao-otimizadas-na-vitrine.md`.
Reconfirmado; continua sendo a causa dominante do LCP fora do alvo. Não é
achado novo desta auditoria.

### F8 — POLIMENTO — middleware roda em toda rota pública
`middleware.ts:10` — o matcher cobre `/loja/*`. Rota pública nunca precisa de
refresh de sessão. Para visitante anônimo, `getUser()` não faz rede (sem cookie),
então o ganho é pequeno; vale só se o fix for trivial (excluir `loja` do matcher)
e não conflitar com o guard do painel (que é nos layouts, não aqui).

## O que NÃO fazer

**Não cachear a vitrine com ISR / `revalidate` / `'use cache'`.** O catálogo
carrega `disponivel` (`page.tsx:173`) e o gate de assinatura (`page.tsx:108`) —
dado vivo. Cache aí vende produto esgotado e mantém loja suspensa no ar. O ganho
buscado (F1–F4) é de *router cache do cliente* + paralelismo + dedup, não de
cache de dado no servidor.

## Status

Nenhum fix aplicado — auditoria é diagnóstico. F1+F2 devem virar uma issue única
(são o mesmo sintoma); F3+F4 uma segunda; F5/F6 podem virar issue separada; F7
já está em `tasks/205`; F8 opcional.

### Atualização — 2026-09-16, F1–F4 aplicados

Branch `fix/retorno-vitrine-loading-prefetch`. F1+F2 no commit `3d8d107`; F3+F4
na issue 207 (plano em `plan/loop-cache-e-paralelizacao-vitrine.md`).

**F3 — dedup confirmado por contagem de queries.** Instrumentação temporária em
`buscarLojaPorSlug`, uma requisição a `/loja/lanches-base` em `next start`:

| Código | Queries a `vitrine_lojas` por requisição |
|---|---|
| Antes | 3 |
| Depois | 1 |

O escopo de `cache()` do React é compartilhado entre `generateMetadata`,
`generateViewport` e o render — o melhor caso previsto pelo plano. Confirmado
que o Next **não** deduplicava isso sozinho: o código original de fato emitia as
três leituras.

**F3+F4 — latência ponta a ponta.** Mediana de 10 requisições (2 cold
descartadas), `curl -H 'RSC: 1'`, mesmo build e mesma sessão de rede para os dois
lados, medindo `time_total`:

| Código | Mediana | Min | Max |
|---|---|---|---|
| Antes | 163,5 ms | 151,4 ms | 263,5 ms |
| Depois | 148,0 ms | 116,6 ms | 183,5 ms |

Ganho de 15,6 ms (9,5 %). `size_download` idêntico nos dois (72.477 B), como
esperado — projeção de colunas é F5 e segue fora de escopo.

**Por que o ganho é menor que os ~200 ms projetados.** A projeção somava os
round-trips economizados assumindo que todos estavam no caminho crítico. Com o
`loading.tsx` do F1 em produção, o Next passa a transmitir o shell em streaming,
e as leituras de `generateMetadata`/`generateViewport` deixam de bloquear o
primeiro byte. Os dois round-trips economizados são reais, mas estavam
parcialmente fora do caminho crítico. O ganho medido é o que sobra.

**Correção de metodologia para auditorias futuras:** `time_starttransfer` deixou
de ser métrica válida para esta rota depois do `loading.tsx`. Com streaming ele
mede a chegada do esqueleto (~8 ms), não o custo dos dados. Usar `time_total`.

**Armadilha registrada (vale para o resto do repo).** `React.cache` memoiza por
igualdade referencial dos argumentos. Passar o client do Supabase como argumento
dá cache miss em toda chamada, porque `createClient()` devolve objeto novo. A
memoização precisa ter como chave só o `slug`, com o client criado dentro. Pela
mesma mecânica, o dedup de `src/app/(painel)/painel/(bloqueavel)/layout.tsx:13`
provavelmente também não funciona hoje — não medido, issue própria a abrir.

**Limite honesto:** nada disso cobre render visual em navegador real. Sem
Playwright e sem MCP de browser nesta máquina (débito da `tasks/176`).

**Aberto:** F5 (`select("*")` → projeção explícita), F6 (`dynamic()` no
`ProdutoModal`, medir antes), F7 (`tasks/205`), F8 (matcher do middleware).
