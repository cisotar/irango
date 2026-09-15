# Auditoria de performance — 204 (FECHAMENTO do ciclo 199–203)

**Data:** 2026-09-15
**Escopo:** issue `tasks/204-verificacao-em-360x640-e-auditoria-de-performance.md` — auditoria de
**fechamento** da feature inteira (`specs/busca-e-navegacao-categorias-vitrine.md`, issues 199,
200, 201, 202, 203) já commitada na branch `feat/busca-e-navegacao-categorias-vitrine`.
**Agente:** `acelerar`

**Auditorias parciais anteriores — não repetidas aqui:**

- `performance/2026-09-15-201-barra-sticky-vitrine.md` (barra sticky, `ResizeObserver`, imagens/LCP)
- `performance/2026-09-15-200-203-realce-e-nav-categorias.md` (`TextoRealcado`, scrollspy, trilho)
- `performance/2026-09-15-202-busca-de-produtos-na-vitrine.md` (INP da digitação, `useMemo`, payload)

Esta auditoria cobre só as três perguntas de fechamento:

1. Orçamento de bundle da **feature inteira** (não por issue): zero lib nova, zero dependência nova.
2. Jank de scroll no mobile com a feature **completa** (nav + busca juntas), não isoladas.
3. Reconferência dos fixes aplicados nas auditorias anteriores — guard `alturaBarra === 0` (F1/200-203)
   e `ALTURA_SLOT_BARRA` compartilhada (F1/202) — **em uso real**: alternar categoria → buscar →
   limpar → alternar categoria de novo.

## Ambiente de medição

`npm run build` verde (`EXIT=0`) + `next start -p 3187`, Chrome `/usr/bin/google-chrome`
(`--headless=new`), driver **CDP direto** (WebSocket nativo do Node 22 — o repo não tem
puppeteer/playwright instalado; nenhuma dependência foi adicionada para medir),
viewport **360×640** mobile (o da issue), `deviceScaleFactor: 2`, **CPU throttling 4×**.
Loja de teste do usuário `lanches-base` — **12 categorias, 23 cards + lista**, o pior caso real
disponível. Instrumentação injetada antes de qualquer script da página: wrappers em
`IntersectionObserver`, `ResizeObserver` e `Element.prototype.scrollIntoView`, amostragem de
`--altura-barra`, `PerformanceObserver` (`event` com `durationThreshold: 0`, `longtask`,
`layout-shift`) e relógio de frame por `requestAnimationFrame` com carimbo de tempo,
segmentado por fase do roteiro.

Lighthouse: `lighthouse --preset=perf --form-factor=mobile` sobre a mesma build.

## 1. Orçamento de bundle da feature inteira

`git diff main...HEAD -- package.json package-lock.json` → **vazio**. Zero dependência nova nas
cinco issues somadas (nenhuma lib de busca, debounce, combobox, carousel ou tabs; os ícones vêm do
`lucide-react` que a vitrine já carregava).

Delta real do grafo de cliente da rota, medido bundlando **só o código do projeto**
(`esbuild --bundle --minify --packages=external`, deps externalizadas — elas não mudaram):

| Grafo | raw | gzip |
|---|---|---|
| `main` — `SecaoCatalogo` (o que `page.tsx` renderizava antes) | 23.003 B | 7.290 B |
| branch — `CatalogoVitrine` (barra + busca + nav + realce + catálogo) | 32.729 B | 10.423 B |
| **Delta das 5 issues (199–203) somadas** | **+9.726 B** | **+3.133 B** |

Contexto: a rota `/loja/lanches-base` transfere **318.801 B de JS em 17 requisições**
(medido no `network-requests` do Lighthouse). A feature inteira é **+0,98 %** desse total.
**Dentro do orçamento** ("zero lib nova, zero dependência nova" do spec) com folga.

Peso por módulo novo (minificado isolado / gzip), para referência futura:

| Módulo | raw | gzip |
|---|---|---|
| `BuscaProdutos.tsx` | 2.770 | 1.212 |
| `NavCategorias.tsx` | 2.398 | 1.287 |
| `CatalogoVitrine.tsx` | 1.987 | 998 |
| `buscarProdutos.ts` | 969 | 503 |
| `scrollspyCategorias.ts` | 547 | 350 |
| `TextoRealcado.tsx` | 457 | 322 |
| `medicaoBarraVitrine.ts` / `resumoBusca.ts` / `anunciadorBusca.ts` / `layoutVitrine.ts` / `ancoraCategoria.ts` | 400 / 355 / 222 / 202 / 79 | 292 / 224 / 172 / 184 / 96 |

## 2. Roteiro de uso real — alternar categoria → buscar → limpar → alternar categoria

Sequência executada no browser, com a feature completa ligada
(chip #3 → digitar `"ao"` → botão "Limpar" → chip #6 → scroll da página inteira):

| Fase | frames | mediana | p95 | máx | frames > 50 ms |
|---|---|---|---|---|---|
| carga/hidratação | 338 | 16,7 ms | 17,4 ms | 182,4 ms | 3 |
| **alternar categoria (1ª)** | 151 | 16,6 ms | 17,4 ms | 23,1 ms | **0** |
| **buscar (`"ao"`, letra a letra)** | 91 | 16,6 ms | 21,5 ms | 359 ms¹ | 1¹ |
| **limpar** | 151 | 16,6 ms | 17,3 ms | 23,3 ms | **0** |
| **alternar categoria (2ª)** | 151 | 16,7 ms | 17,5 ms | 19,1 ms | **0** |
| **scroll da página inteira** | 144 | 16,6 ms | 17,6 ms | 19,2 ms | **0** |

¹ O frame de 359 ms cai em `t=10.490`, **depois** da última tecla (`t≈9.200`) e antes do clique em
"Limpar" (`t=10.750`) — é gap de `requestAnimationFrame` ocioso do headless, não jank de interação:
nenhuma long task e nenhum evento de entrada coincidem com ele.

**Eventos de entrada acima de 40 ms em todo o roteiro (4× throttle):**

```
keydown  t=8919  dur= 56 ms  processing= 2 ms   (1ª tecla — troca trilho→resumo)
keypress t=8919  dur= 56 ms  processing=37 ms
beforeinput/input t=8925/8927 dur=48 ms
```

**Pior interação do ciclo completo: 56 ms contra o alvo de INP de 200 ms** — ~3,5× de folga,
consistente com os 72 ms que a auditoria da 202 mediu isoladamente. Cliques em chip e em "Limpar"
nem entraram na lista (< 40 ms).

**Long tasks:** 3, todas em `t = 458 / 593 / 1.003` — **hidratação da página**, antes de qualquer
interação. **Zero long task durante os quatro passos do roteiro e durante o scroll.**

**Layout shift:** a fila de `layout-shift` ficou **vazia** na sessão inteira — nem os shifts
input-driven da filtragem foram registrados nesta corrida. **CLS = 0** (confirmado também pelo
Lighthouse: `cumulative-layout-shift: 0`).

**Jank de scroll com nav + busca juntas: nenhum.** Com 12 chips transbordando, `mask-image`,
`scroll-snap`, scrollspy ativo e o `scroll-margin-top` das 12 seções, o scroll da página inteira
fecha em p95 de **17,6 ms** e máximo de **19,2 ms** — nenhum frame perdido.
*Ressalva honesta (mesma da auditoria de 200/203):* Chrome headless em desktop é teto de custo de
main thread, não medição de Android de entrada.

## 3. Reconferência dos fixes anteriores sob a feature completa

### Guard `alturaBarra === 0` (F1 da auditoria 200/203) — **confirmado**

```
pós-hidratação:  IO construídos ["200px", "-129px 0px -55% 0px"]   observe 12   disconnect 0
```

Um único `IntersectionObserver` de scrollspy na hidratação (o `"200px"` é o prefetch do próprio
Next), 12 `observe()` para 12 seções. Antes do fix eram 24 `observe()` e dois observers idênticos.
`ResizeObserver` construído **1×**. `scrollIntoView` chamado **1×** na hidratação — o fix F2
(ler `prefers-reduced-motion` por ref, `NavCategorias.tsx:111-114`) também está aplicado e valendo.

### `ALTURA_SLOT_BARRA` compartilhada (F1 da auditoria 202) — **confirmado**

`--altura-barra` amostrada a cada 50 ms durante o ciclo inteiro:

```
t=577   ""        (pré-hidratação, fallback :root = 0px)
t=1047  "129px"   (medição real)
... buscar ... limpar ... alternar categoria ...  → permanece "129px" até o fim
```

**Zero oscilação.** Antes do fix a sequência medida era `125 → 129 → 125` a cada ciclo
buscar/limpar. Consequência direta no scrollspy, no ciclo completo:

```
entrando em busca:  disconnect 1   (NavCategorias desmontada, cleanup roda)
ao limpar:          1 observer novo, rootMargin "-129px 0px -55% 0px"   observe 12
total da sessão:    3 IO construídos (1 do Next + 2 do scrollspy), 24 observe, 1 disconnect
```

Um observer por montagem da nav, com o `rootMargin` **certo de primeira**. O desperdício que a
auditoria da 202 mediu (2 observers, 24 `observe()` e um `rootMargin` errado de 4 px por ciclo de
limpeza) **não se reproduz**. O `disconnect` na desmontagem também comprova o cleanup do
`IntersectionObserver` que o critério da 204 pede — observer não acumula entre montagens.

## Lighthouse — `/loja/lanches-base`, mobile, preset perf

| Métrica | Medido | Alvo |
|---|---|---|
| **LCP** | **4,2 s** | < 2,5 s — **fora**, causa pré-existente (F5/201) |
| **CLS** | **0** | ~0 — dentro |
| INP | 56 ms medido no roteiro CDP (Lighthouse lab não emite INP) | < 200 ms — dentro |
| FCP | 1,8 s | — |
| TBT | 320 ms | — |
| Speed Index | 3,0 s | — |
| Score perf | 0,77 | — |

Peso total 1.082 KiB, dos quais **750 KiB em 12 imagens** e 319 KiB em 17 scripts. A distribuição
não mudou: as imagens `unoptimized` continuam sendo **a** alavanca de LCP da vitrine, e a feature
inteira responde por 3,1 KB gzip (menos de 0,3 % do peso da página).

## Banco

`git diff --stat main...HEAD` não toca `supabase/`, `src/lib/supabase/queries/`,
`src/lib/actions/` nem `src/lib/validacoes/` em nenhuma das cinco issues. Zero query, índice, RLS,
coluna ou migration nova. **Nenhum `EXPLAIN ANALYZE` aplicável.** Sem N+1, sem `select()` gordo,
sem lock. A busca roda 100 % no browser sobre o payload que o SSR já entregava.

## Findings

**Nenhum achado de performance atribuível ao ciclo 199–203 — código dentro do orçamento.**

Os dois achados CUSTO/POLIMENTO das auditorias parciais (F1/200-203 e F1/202) estão **aplicados e
verificados em uso real** nesta auditoria; F2/200-203 também. Nada novo apareceu sob a feature
completa, e nenhuma mudança de código foi necessária — nenhuma issue aberta por esta auditoria.

## Pré-existentes (reafirmados, não reabertos — nenhum causado por 199–203)

| Item | Onde | Situação |
|---|---|---|
| **F5/201** — `unoptimized` nas imagens da vitrine (`CardProduto.tsx:50`, `ProdutoModal.tsx:232`, `HeaderLoja.tsx:52`) | auditoria da 201 | **A alavanca dominante**: 750 KiB de 1.082 KiB da página, LCP 4,2 s. Merece issue própria. |
| **F6/201** — `Cache-Control` curto no bucket de fotos | auditoria da 201 | aberto |
| **F7/201** — `/loja/[slug]` dinâmica por carregar disponibilidade viva junto do catálogo | auditoria da 201 | observação deliberada; cachear aqui venderia esgotado |
| Peso de JS da vitrine (319 KB gzip em 17 chunks) | auditoria da 202 | ordem de grandeza acima de tudo que 199–203 somaram (3,1 KB); candidato a issue de orçamento de bundle |
| `ProdutoModal` a ~130 ms de INP a 4× | auditoria da 202 | dentro do alvo, mas é a interação mais cara da vitrine |
| Gatilho de reauditoria | auditoria da 202 | loja com catálogo acima de ~300 produtos |

## Correção do orçamento de bundle (medição posterior no artefato real)

A estimativa `+3,1 KB gzip` acima foi calculada somando módulo a módulo com `esbuild
--bundle --minify --packages=external` — não é o artefato que o usuário baixa. Uma
segunda auditoria (independente, disparada em paralelo, mesma metodologia de CDP+4×
throttle) mediu o **build de produção real** dos dois lados (`next build` + `next start`
na branch `cf0c177` vs. worktree de `main`), somando todos os chunks `/_next/static/*.js`
referenciados no HTML de `/loja/lanches-base`:

| | main | branch | delta |
|---|---|---|---|
| chunks | 16 | 18 | +2 |
| gzip | 329.088 B | 339.626 B | **+10.538 B (+3,2 %)** |

O número correto do acréscimo de bundle é **~10,5 KB gzip**, não ~3,1 KB — a diferença é
framing/re-split de chunk do bundler de produção (Turbopack) mais `ui/input.tsx` e os
ícones (`Search`/`X`/`SearchX`) entrando no grafo da rota, que a soma por módulo isolado
não captura. **Zero dependência nova continua confirmado** (`package.json`/`package-lock.json`
sem diff) e o orçamento da 204 ("zero lib nova") segue cumprido — só o valor em KB muda.
Use **339.626 B gzip / 18 chunks** como baseline em comparações futuras, não a soma parcial.

A mesma auditoria reconfirmou, sem achado novo, os itens abaixo (métodos independentes,
mesmos resultados da auditoria original desta issue): zero listener de `scroll`, zero
leitura de layout durante o scroll (0 `getBoundingClientRect`/`getComputedStyle` no
caminho do scroll), scrollspy reconstruído 1× na hidratação e 1× (não 2×) ao limpar a
busca, `ativo` isolado em `TrilhoCategorias` (o catálogo nunca re-renderiza por causa do
scrollspy), e a medição da barra sem double-measure (o segundo `getBoundingClientRect`
é a entrega obrigatória do `ResizeObserver`, guardada por `ultimaAltura` contra escrita
redundante). Um item do checklist ficou inconclusivo por limitação de ambiente: navegação
SPA sintética via `pushState`/`popstate` não dispara o App Router de verdade, então
"observers não acumulam ao trocar de loja" segue provado só indiretamente (teste unitário
de cleanup + `ioDisconnect: 1` observado ao desmontar a nav) — verificação a olho fica
pendente para quando houver browser real disponível.

## Conclusão

**O ciclo 199–203 fecha sem nenhum GARGALO e sem nenhum CUSTO.** A feature inteira custa
**+10,5 KB gzip (+3,2 % do JS da rota, medido no artefato de produção — ver correção
acima) com zero dependência nova**, a pior interação do fluxo real (alternar categoria →
buscar → limpar → alternar categoria) mede **56 ms contra 200 ms de INP**, o scroll com
nav e busca ativas fecha em **p95 de 17,6 ms sem um único frame perdido**, o **CLS é 0**
e o banco não é tocado. Os dois fixes herdados das auditorias parciais foram reconferidos em uso
real e estão valendo: **um** observer por montagem da nav e `--altura-barra` estável em 129 px
durante todo o ciclo. O LCP fora do alvo é inteiramente pré-existente e vem das imagens sem
otimização (F5/201, já em `tasks/205`).
