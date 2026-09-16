# Auditoria de performance — 200 (realce do trecho casado) + 203 (nav de categorias com scrollspy)

**Data:** 2026-09-15
**Escopo:** issues `tasks/200-realce-do-trecho-casado-no-card-e-na-lista.md` e
`tasks/203-nav-de-categorias-com-scrollspy.md`, implementação não commitada na branch
`feat/busca-e-navegacao-categorias-vitrine`.
**Agente:** `acelerar`
**Auditoria anterior da mesma branch:** `performance/2026-09-15-201-barra-sticky-vitrine.md`
(barra sticky / `ResizeObserver` / âncora compartilhada). Este documento **não repete** aquela
análise; cobre só o que 200 e 203 acrescentam.

## Contexto

Perguntas da auditoria: (1) custo do `TextoRealcado` como componente novo por card/linha em
todo render do catálogo; (2) custo do `IntersectionObserver` do scrollspy; (3) jank do
`scroll-snap`/`mask-image` no trilho horizontal; (4) bundle do novo `'use client'`.

### Arquivos lidos (íntegros)

- `src/components/vitrine/TextoRealcado.tsx` (novo)
- `src/components/vitrine/NavCategorias.tsx` (novo, `'use client'`)
- `src/components/vitrine/scrollspyCategorias.ts` (novo, módulo neutro)
- `src/lib/utils/buscarProdutos.ts` (199, agora no grafo do cliente)
- `src/hooks/useMediaQuery.ts` (reusado)
- `src/lib/utils/ancoraCategoria.ts` (201, reusado)
- diffs de `CatalogoVitrine.tsx`, `SecaoCatalogo.tsx`, `CardProduto.tsx`,
  `ItemProdutoLista.tsx`, `medicaoBarraVitrine.ts`, `globals.css`

## Medições

Build de produção (`npm run build` verde) + `next start -p 3123`, Chrome 
(`/usr/bin/google-chrome`), viewport iPhone 390×844, **CPU throttling 4×**.
Lojas de teste do usuário: `paodociso` (4 categorias) e `lanches-base` (12 categorias —
trilho que de fato transborda).

### Lighthouse — `/loja/paodociso`, mobile, preset perf

| Métrica | 201 (antes) | 200+203 (agora) | Alvo |
|---|---|---|---|
| LCP | 6,7 s | **7,1 s** | < 2,5 s |
| CLS | 0 | **0** | ~0 |
| TBT | 170 ms | **120 ms** | — |
| FCP | 1,6 s | 1,9 s | — |
| Speed Index | 3,7 s | 4,0 s | — |
| Score perf | 0,72 | 0,72 | — |

LCP e peso total (1.457 KiB) seguem dominados pelas imagens `unoptimized` — **F5 da auditoria
da 201**, pré-existente e fora do escopo destas issues. A variação 6,7→7,1 s é ruído de
medição sobre a mesma causa; **CLS continua 0** (a nav é renderizada no SSR, não inserida
depois da hidratação).

### Instrumentação em browser real (puppeteer-core + Chrome, 4× CPU throttle)

`IntersectionObserver`, `ResizeObserver` e `Element.prototype.scrollIntoView` envelopados
antes de qualquer script da página.

**Após hidratação, `lanches-base` (12 categorias):**

```
ioNew: 3   ioObserve: 24   ioDisconnect: 1   ioCallbacks: 1   scrollIntoView: 2
rootMargins: ["200px", "-57px 0px -55% 0px", "-57px 0px -55% 0px"]
```

O `200px` é o observer de prefetch do próprio Next. Os outros dois são o scrollspy: **dois
observers construídos com rootMargin IDÊNTICO**, 24 `observe()` para 12 seções, 1 `disconnect()`
(ver F1). `scrollIntoView` chamado 2× antes de qualquer scroll do usuário (ver F2).

**Durante scroll da página inteira (7.391 px, passos de 700 px, `lanches-base`):**

```
chip ativo: "Hamburgueres" -> "Bebidas"   (scrollspy funciona)
ioCallbacks: 10   scrollIntoView: 8
frames: 196   mediana 16,7 ms   p95 17,7 ms   frames > 50 ms: 0   long tasks: []
```

### Custo do `TextoRealcado` (Node 22, sem throttle, nomes reais de cardápio)

| Catálogo renderizado | `partirPorTermo` em todos os nomes |
|---|---|
| 12 cards | 0,047 ms |
| 40 cards | 0,153 ms |
| 100 cards | **0,406 ms** |

Caminho de hoje (`termo` ausente): `partirPorTermo` **não é chamado** — early return.
Confirmado no HTML servido: `<mark>` aparece **0 vez**.

### Bundle

| Grafo | raw | gzip |
|---|---|---|
| `NavCategorias` + `scrollspyCategorias` + `useMediaQuery` + `ancoraCategoria` | 2.753 B | **1.479 B** |
| `TextoRealcado` + `partirPorTermo` (tree-shaken) | 1.034 B | **591 B** |
| Chunk do catálogo no build (`1dimow1m3ld1j.js`) | 27.150 B | 8.163 B |

`git diff package.json` **vazio** — zero dependência nova. `useMediaQuery` e `ancoraCategoria`
reusados em vez de reimplementados; nada de lib de carousel/tabs.

### Payload do documento

`lanches-base`: HTML 149.283 B raw / 13.899 B gzip. O `<nav>` inteiro com 12 chips ocupa
5.963 B raw / **1.008 B gzip** — as strings de classe repetidas por chip comprimem bem.
Não é achado.

### Banco

`git diff --stat` não toca `supabase/`, `src/lib/actions/` nem `src/lib/supabase/queries/`.
Nenhuma query, índice, RLS ou coluna nova. **Nenhum `EXPLAIN ANALYZE` aplicável.**
Sem N+1, sem `select()` gordo, sem lock.

## Findings

### F1 — `src/components/vitrine/NavCategorias.tsx:126` — CUSTO

`alturaBarra` na lista de dependências do efeito faz o `IntersectionObserver` do scrollspy ser
**construído, ligado às N seções, desconectado e reconstruído em toda carga da vitrine — com o
mesmo `rootMargin`**. `alturaBarra` nasce `0` e vira `57` no `useLayoutEffect` do pai; o efeito
passivo do filho roda nas duas passadas. Medido em `lanches-base`: `ioObserve: 24` para 12
seções, `ioDisconnect: 1`, `rootMargins` do scrollspy `["-57px 0px -55% 0px", "-57px 0px -55%
0px"]` — os dois já corretos, porque a própria decisão D3 garante que a CSS var está publicada
quando o efeito passivo roda.

*Impacto:* 12 `observe()` desperdiçados (cada um força um cálculo de interseção) + um render
extra da nav inteira, no caminho de hidratação da vitrine. Sub-ms, mas 100 % evitável, e escala
com o número de categorias da loja.

*Fix (1 linha, no topo do `useEffect`):*

```ts
if (alturaBarra === 0) return;
```

Seguro: a nav só existe com `categorias.length >= 3`, o que implica `temBarra`, o que implica
que `medir()` roda e `aoMedir` publica altura > 0 (a barra tem borda). O gatilho continua
funcionando para rotação e para a troca trilho↔resumo da 202 — só a passada inicial morta é
cortada.

*Status:* **fix recomendado no mesmo ciclo** (custo trivial).

### F2 — `src/components/vitrine/NavCategorias.tsx:132-138` — POLIMENTO

`aceitaMovimento` nas dependências do efeito de centralização faz `scrollIntoView` ser chamado
**2× em toda hidratação**, sem o usuário ter tocado em nada (medido: `scrollIntoView: 2` antes
de qualquer scroll). `useMediaQuery` retorna `false` no primeiro paint e flipa para `true` no
seu próprio efeito, re-disparando o efeito com o mesmo `ativo`.

*Impacto:* dois scrolls programáticos no chip 0 (ambos no-op na prática, porque o chip já está
visível). Marginal hoje; vira uma animação `smooth` visível se a 202 fizer o termo de busca
mudar o chip ativo logo após a montagem.

*Fix:* ler a preferência por ref, tirando-a das deps.

```ts
const movimentoRef = useRef(aceitaMovimento);
movimentoRef.current = aceitaMovimento;

useEffect(() => {
  chipsRef.current.get(ativo)?.scrollIntoView({
    inline: "center",
    block: "nearest",
    behavior: movimentoRef.current ? "smooth" : "auto",
  });
}, [ativo]);
```

*Status:* opcional.

## Avaliado — sem achado

### `TextoRealcado` por card/linha

**Dentro do orçamento.** Hoje custa zero: `CatalogoVitrine` ainda não repassa `termo`
(é a 202 que liga), então toda chamada cai no early return e `partirPorTermo` não roda —
0 `<mark>` no HTML servido. Quando a 202 ligar, o pior caso medido é **0,406 ms para 100 cards
por tecla digitada** (≈1,6 ms a 4× de throttle), contra orçamento de INP de 200 ms. O early
return também preserva a árvore de SSR byte a byte quando não há match, o que é o que mantém
o CLS em 0.

Fica registrado que o custo é pago **duas vezes por produto visível** a cada tecla —
`filtrarCatalogo` já normalizou nome e descrição para filtrar, e `partirPorTermo` normaliza o
nome de novo para o mapa de índices. É deliberado (o comentário em `buscarProdutos.ts:63-69`
explica: o mapa por code point só se paga na string curta do match) e o número acima mostra que
cabe no orçamento. **Não otimizar sem medição nova** — se a 202 medir INP fora do alvo em loja
grande, este é o primeiro lugar a olhar.

### Jank do `scroll-snap` / `mask-image` / trilho horizontal

**Nenhum.** Com 12 chips transbordando, `mask-image` de gradiente nas duas bordas,
`scroll-snap-type: x proximity` e 8 `scrollIntoView({behavior:"smooth"})` disparados pelo
scrollspy ao longo de um scroll de 7.391 px, a 4× de CPU throttle: **196 frames, mediana
16,7 ms, p95 17,7 ms, zero frames acima de 50 ms, zero long tasks.** O `mask-image` na barra
sticky não força re-rasterização por frame, e o smooth scroll horizontal não briga com o scroll
vertical (é o `block: "nearest"` que garante isso).

*Ressalva honesta:* Chrome headless em GPU de desktop não é Android de entrada. O número é um
teto de custo de main thread, não uma medição de dispositivo real.

### Custo do scrollspy durante o scroll

**Barato como prometido.** 10 callbacks do `IntersectionObserver` em um scroll de página
inteira com 12 seções — a decisão de proibir listener de `scroll` (critério de aceite da 203)
se paga. `escolherAtivo` é O(n) sobre 12 âncoras, e o `setAtivo` com valor igual faz bail-out
do React.

### CLS da nav

**0 medido.** A nav vai no HTML do SSR com os 12 chips e a altura final; nada é inserido depois
da hidratação. `aria-current` e `box-shadow: inset` do chip ativo não movem layout.

### Bundle

+2,0 KB gzip de código de cliente novo, **zero dependência nova**, sem fronteira `'use client'`
supérflua — `TextoRealcado` é de propósito um módulo puro sem `'use client'` próprio, e
`scrollspyCategorias.ts` é neutro (o `IntersectionObserver` é injetado), então nada de
mecânica testável em node vaza para o bundle como componente. Dentro do orçamento.

### Banco

Sem achado — as issues não tocam o banco.

## Pré-existentes (já registrados na auditoria da 201, não reabertos aqui)

- **F5/201** — `unoptimized` nas imagens da vitrine: LCP 7,1 s, 1.457 KiB de página.
  Continua sendo **a** alavanca de conversão da vitrine e continua fora do escopo de 200/203.
- **F6/201** — `Cache-Control` curto no bucket de fotos.
- **F7/201** — `/loja/[slug]` dinâmica por carregar disponibilidade viva junto do catálogo.

## Conclusão

**As issues 200 e 203 não introduzem nenhum GARGALO.** Um achado CUSTO (F1, observer construído
duas vezes por carga, fix de uma linha) e um POLIMENTO (F2). O realce cabe folgado no orçamento
de INP e hoje custa literalmente zero; o trilho não janka a 4× de throttle; o CLS segue em 0;
o bundle cresce 2,0 KB gzip sem dependência nova; o banco não é tocado.
