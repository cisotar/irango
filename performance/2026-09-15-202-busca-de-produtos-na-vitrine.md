# Auditoria de performance — 202 (busca de produtos na vitrine)

**Data:** 2026-09-15
**Escopo:** issue `tasks/202-busca-de-produtos-na-vitrine.md`, implementação não commitada
na branch `feat/busca-e-navegacao-categorias-vitrine`.
**Agente:** `acelerar`
**Auditorias anteriores da mesma branch:** `performance/2026-09-15-201-barra-sticky-vitrine.md`
e `performance/2026-09-15-200-203-realce-e-nav-categorias.md`. Este documento **não repete**
aquelas análises (LCP/imagens, `ResizeObserver` da barra, custo do `TextoRealcado`, scrollspy):
cobre o que a 202 acrescenta — **INP da digitação** e o custo de re-renderizar o catálogo
filtrado a cada tecla.

## Contexto

O plano da 202 sinalizou o risco explicitamente (§Ordem de Implementação, passo 7): `termo`
desce de `CatalogoVitrine` até cada card, então **toda tecla digitada re-renderiza o catálogo
filtrado inteiro**. As perguntas desta auditoria:

1. Quanto custa, em ms de main thread, uma tecla numa loja real?
2. O `useMemo` de `filtrarCatalogo` está de fato evitando trabalho redundante — e quanto vale?
3. A troca trilho↔resumo (D2) cobra alguma coisa além do render?
4. Bundle, payload e banco mudam?

### Arquivos lidos (íntegros)

- `src/components/vitrine/CatalogoVitrine.tsx` (diff — estado do termo, `useMemo`, região viva)
- `src/components/vitrine/BuscaProdutos.tsx` (novo, `'use client'`)
- `src/components/vitrine/resumoBusca.ts` (novo, módulo neutro)
- `src/components/vitrine/anunciadorBusca.ts` (novo, módulo neutro)
- `src/components/vitrine/SecaoCatalogo.tsx`, `CardProduto.tsx`, `ItemProdutoLista.tsx`,
  `TextoRealcado.tsx`, `NavCategorias.tsx` (consumidores do `termo`)
- `src/lib/utils/buscarProdutos.ts` (199)
- `src/app/(publica)/loja/[slug]/page.tsx` (origem do payload SSR)

## Medições

`npm run build` verde + `next start -p 3179`, Chrome 
(`/usr/bin/google-chrome`, headless), viewport 390×844 mobile, `PerformanceObserver`
(`event` com `durationThreshold: 0`, `longtask`, `layout-shift`) e **CPU throttling 4× e 6×**
via CDP. Loja de teste do usuário `lanches-base` — **12 categorias, 68 produtos** (23 em grid
de card, 45 em lista textual), o pior caso real disponível; `paodociso` (4 categorias,
16 produtos) como controle.

### INP da digitação — o número que a issue existe para responder

Digitação letra a letra com ~120 ms entre teclas (ritmo de polegar). `dur` = duração completa
do evento (entrada → próximo paint), que é o que o INP mede.

| Cenário (`lanches-base`, 68 produtos) | 1ª tecla (entra em modo busca) | teclas seguintes | long task |
|---|---|---|---|
| `"ao"`, 4× throttle | **72 ms** (processing 40 ms) | 24 ms | nenhuma |
| `"ao"`, 6× throttle (3 corridas) | **96 / 88 / 96 ms** (processing 51–56 ms) | ~40 ms | 52–57 ms |
| `"a"` (144 `<mark>` na tela), 4× | 64 ms | — | nenhuma |
| `"aco"` (68 → 20 produtos), 4× | 72 ms | 24 ms | nenhuma |
| `"pao"` em `paodociso`, 4× | 40 ms | 24 ms | nenhuma |
| apagar tudo (backspaces), 4× | 40 ms | 24 ms | nenhuma |

**Alvo INP < 200 ms: cumprido com ~2× de folga no pior caso medido.** Zero frame acima de
50 ms durante a digitação a 4×; mediana de frame 16,7 ms, p95 18,0 ms.

O padrão importante: a **primeira** tecla custa 3–4× as seguintes (72 vs 24 ms). É a tecla que
troca o modo — desmonta `NavCategorias` (D2), monta `ResumoBusca`, refaz a barra, refiltra e
repinta o catálogo. As teclas seguintes só refiltram.

Nenhuma requisição de rede é disparada pela digitação (confirmado no critério de aceite da
issue; a aba Network fica silenciosa porque não há `fetch` no caminho).

### Onde vão os ~50 ms da primeira tecla (não é a busca)

Custo isolado da lógica de busca, Node 22 sem throttle, catálogo sintético com nomes e
descrições de tamanho realista:

| Catálogo | `filtrarCatalogo("ao")` | `partirPorTermo` nos nomes que casaram | soma por tecla |
|---|---|---|---|
| 68 produtos | 0,236 ms | 0,462 ms (72 nomes) | **0,70 ms** |
| 200 produtos | 0,651 ms | 1,289 ms | 1,94 ms |
| 500 produtos | 1,575 ms | 3,152 ms | 4,73 ms |

`normalizarBusca` sobre nome + descrição dos 68 produtos: 0,214 ms.

A 6× de throttle, os 0,70 ms viram ~4 ms — **menos de 10 % dos ~51 ms de processing medidos
na primeira tecla**. O resto é reconciliação do React + estilo/layout/paint do catálogo. Ou
seja: **otimizar a lógica de busca não move o ponteiro**; o que custa é repintar o catálogo,
que é exatamente o que a feature precisa fazer.

Projeção (estimativa, não medição): a 500 produtos a lógica sozinha custa ~28 ms a 6×, e o
render escala junto — é a faixa em que o INP começa a apertar. **Gatilho para reauditar:
loja com catálogo acima de ~300 produtos.**

### O `useMemo` está evitando trabalho redundante? (experimento)

`useMemo(() => filtrarCatalogo(categorias, termo), [categorias, termo])` está correto:
`categorias` vem de Server Component (identidade estável entre renders do cliente), então o
filtro roda **uma vez por tecla**, e não roda nos renders que não mudam o termo — o
`setAnuncio` do debounce de 500 ms e o `setAlturaBarra` do `ResizeObserver`.

Quanto isso vale foi **medido, não estimado**. Patch experimental aplicado e buildado
(depois revertido — o working tree está intacto): `useMemo` também no elemento
`<SecaoCatalogo/>`, isolando o catálogo dos re-renders de `anuncio` e `alturaBarra`.

| 6× throttle, `lanches-base`, 1ª tecla | baseline | com `SecaoCatalogo` memoizado |
|---|---|---|
| duração do evento | 96 / 88 / 96 ms | 96 / 88 / 96 ms |
| processing | 51–56 ms | 51–53 ms |
| long task | 52–57 ms | 53–54 ms |

**Diferença: nenhuma, dentro do ruído.** Conclusão dupla: (a) o `useMemo` que já existe é
correto e custa nada, mas seu ganho medido é sub-milissegundo; (b) **memoização adicional não
se justifica** — seria complexidade sem medição que a sustente. Registrado aqui para que
ninguém "otimize" isso numa próxima passada.

Na mesma linha: o render extra que o anúncio provoca 500 ms depois da última tecla foi
procurado com `requestAnimationFrame` e não produziu **nenhum** gap de frame acima de 20 ms a
6× de throttle. Não é achado.

### Layout shift

| Momento | Medição |
|---|---|
| Carga da página | **CLS = 0** |
| Durante a digitação | 3 shifts (0,0032 / 0,1440 / 0,1266), **todos com `hadRecentInput: true`** |

Os shifts da digitação são consequência inevitável de filtrar o catálogo e, por definição do
Core Web Vital, não entram no CLS (acontecem dentro de 500 ms de um input). **CLS segue 0.**

### Troca trilho↔resumo — altura da barra

`--altura-barra` medida ao vivo (`MutationObserver` no `style` do `<html>`):

```
t=2700ms "125px"   (modo normal, trilho)
t=2770ms "129px"   (1ª tecla: resumo entra no lugar do trilho)
t=4094ms "125px"   (clique no ✕: trilho volta)
```

Altura dos dois slots: `<nav>` do trilho **56,0 px**, linha do resumo **59,97 px** — **3,97 px
de diferença**. Consequência medida no `IntersectionObserver` do scrollspy (wrapper sobre o
construtor, `observe` e `disconnect`):

```
após hidratação:      novos ["200px", "-125px 0px -55% 0px"]   observe 12   disconnect 0
entrando em busca:    novos []                                  observe  0   disconnect 1
limpando (✕):         novos ["-129px...", "-125px..."]          observe 24   disconnect 1
```

O `"200px"` é o observer de prefetch do próprio Next. Na hidratação o scrollspy é construído
**uma** vez (o guard `if (alturaBarra === 0) return;`, achado F1 da auditoria de 200/203, está
aplicado e funcionando). Mas **ao limpar a busca ele é construído duas vezes, com 24 `observe()`
para 12 seções** — e o primeiro com `rootMargin` errado (`-129px`, a altura do resumo que
acabou de sair). Ver F1 abaixo.

### Bundle

`esbuild --minify` + gzip -9 sobre cada módulo novo do grafo do cliente:

| Módulo | minificado | gzip |
|---|---|---|
| `BuscaProdutos.tsx` (+ `ResumoBusca` + `EstadoVazioBusca`) | 2.686 B | **1.153 B** |
| `resumoBusca.ts` | 360 B | 219 B |
| `anunciadorBusca.ts` | 227 B | 179 B |
| `CatalogoVitrine.tsx` | 1.992 B (era 972 B na 201) | 997 B |
| **Acréscimo da 202** | — | **≈ 1,9 KB gzip** |

`git diff package.json package-lock.json` **vazio** — zero dependência nova. Os três ícones
(`Search`, `X`, `SearchX`) vêm do `lucide-react` que já está no bundle da vitrine; nada de lib
de busca, de debounce ou de combobox (o plano proibiu e o código respeitou).

### Payload SSR

`/loja/lanches-base`: HTML **150.593 B raw / 14.350 B gzip**. O `<form role="search">` inteiro
ocupa **1.531 B raw** (≈1 % do documento, e comprime bem — são classes repetidas). A região
viva aparece **exatamente 1×** no documento (`role="status"`), como o critério de aceite exige.
Nenhum campo novo desce do servidor: a busca opera 100 % sobre o payload que 199/201 já
entregavam.

### Banco

`git status --short` e `git diff --stat` não tocam `supabase/`, `src/lib/supabase/queries/`,
`src/lib/actions/` nem `src/lib/validacoes/`. Zero query, índice, RLS, coluna ou migration nova.
**Nenhum `EXPLAIN ANALYZE` aplicável.** Sem N+1, sem `select()` gordo, sem lock — a filtragem
roda no browser sobre dado já baixado, como o plano previu (custo R$ 0,00, nenhuma quota).

### INP de adicionar ao carrinho a partir de um resultado filtrado

Clique no primeiro resultado (abre o `ProdutoModal`), 4× throttle, duas corridas cada:

| Caminho | duração do `click` |
|---|---|
| Sem busca (catálogo íntegro) | 128 ms / 136 ms |
| Com busca ativa (`"aco"`, 20 produtos) | 128 ms / 112 ms |

**A busca não piora o caminho do carrinho** — dentro do ruído, e com a busca ativa até um
pouco melhor (menos DOM). O modal abre normalmente a partir do resultado filtrado.
Os ~130 ms são custo pré-existente do `ProdutoModal`, não regressão da 202 (registrado abaixo).

## Findings

### F1 — `src/components/vitrine/BuscaProdutos.tsx:129` (e `NavCategorias.tsx:163`) — CUSTO

A linha do resumo é **3,97 px mais alta** que o trilho de categorias (59,97 px vs 56,0 px:
o botão "Limpar" tem `min-h-[44px]` e o trilho de chips fecha em 44 px de `<ul>` com outro
arredondamento de linha). Como os dois ocupam o mesmo slot da barra sticky (D2/RN-5),
`--altura-barra` oscila **125 → 129 → 125 px** a cada ciclo de buscar/limpar.

*Impacto medido:* ao limpar a busca, `alturaBarra` muda depois que `NavCategorias` já montou
com o valor velho — e como ele é o gatilho de reconstrução do scrollspy, o
`IntersectionObserver` é **construído duas vezes, com 24 `observe()` para 12 seções**
(`novos: ["-129px 0px -55% 0px", "-125px 0px -55% 0px"]`), o primeiro com `rootMargin` de 4 px
errado. É exatamente o desperdício que o fix F1 da auditoria de 200/203 eliminou na hidratação,
reintroduzido em cada ciclo de busca. Soma-se um render extra de `CatalogoVitrine` e o
recálculo de `scroll-margin-top` de todas as seções, além de um solavanco visual de 4 px no
conteúdo sob a barra (sem custo de CLS — é input-driven, ver medição acima). Sub-ms por ciclo,
mas 100 % evitável e escala com o número de categorias da loja.

*Fix:* **igualar a altura dos dois slots** para que `--altura-barra` não mude na troca. Reusar
`src/components/vitrine/layoutVitrine.ts` (já é o módulo das constantes de layout da vitrine,
precedente da 201) para uma constante compartilhada aplicada ao `<nav>` do trilho e à `<div>`
do resumo — nada de quarta cópia de classe solta. Os 44 px de alvo de toque do "Limpar" e dos
chips não mudam; só a caixa que os envolve passa a ter a mesma altura nos dois modos.
Vale confirmar o valor final com o `desenhar` (é 4 px de respiro visual, não só número).

*Status:* **fix recomendado no mesmo ciclo** (custo trivial, uma constante e duas classes).
Se não couber, vira issue separada — não bloqueia a 202.

### F2 — `src/components/vitrine/CatalogoVitrine.tsx:86-89` — avaliado, **sem achado**

O `useMemo` do `filtrarCatalogo` está correto (identidade de `categorias` estável pelo RSC) e
**memoização adicional foi medida e não produz ganho** (experimento acima: 96/88/96 ms com e
sem `SecaoCatalogo` memoizado, a 6× de throttle). Não otimizar sem medição nova.

## Avaliado — sem achado

- **Re-render do catálogo por tecla (o risco que o plano levantou):** custa 72 ms a 4× e 96 ms
  a 6× na tecla mais cara, contra orçamento de 200 ms de INP. **Dentro do orçamento**, e a
  lógica de busca responde por menos de 10 % disso.
- **Debounce do anúncio (`anunciadorBusca`):** o render que ele provoca 500 ms depois da última
  tecla não produziu nenhum gap de frame > 20 ms a 6×. A escolha de debouncar **só** o anúncio
  e nunca o `termo` (D4) está certa: a filtragem sai no frame e o `aria-live` não vira ruído.
- **`contarProdutos`/`textoResumoBusca`/`textoAnuncioBusca`:** O(categorias) e O(1) sobre
  strings curtas, fora de qualquer laço por produto. Irrelevante no perfil.
- **`EstadoVazioBusca`:** troca o catálogo inteiro por um bloco pequeno — é o caminho mais
  barato do modo busca, não o mais caro.
- **Bundle:** +1,9 KB gzip, zero dependência nova, nenhum `'use client'` supérfluo
  (`resumoBusca` e `anunciadorBusca` são módulos neutros, e `TextoRealcado` continua puro).
- **Payload e banco:** inalterados. Nenhuma query, nenhum campo a mais descendo do servidor.
- **Caminho do carrinho a partir de um resultado filtrado:** não regrediu (128/112 ms com
  busca vs 128/136 ms sem).
- **CLS:** 0 na carga; os shifts da filtragem são input-driven e não pontuam.

## Pré-existentes (não reabertos aqui)

- **F5/201 — imagens `unoptimized` na vitrine:** continua sendo a alavanca dominante de LCP
  (7,1 s medido na auditoria de 200/203) e de conversão. Fora do escopo da 202.
- **F6/201** — `Cache-Control` curto no bucket de fotos.
- **F7/201** — `/loja/[slug]` dinâmica por carregar disponibilidade viva junto do catálogo.
- **Peso de JS da vitrine (novo registro, não é da 202):** os 18 chunks referenciados por
  `/loja/lanches-base` somam **1.114.244 B raw / 339.849 B gzip**, com um chunk único de
  131 KB gzip. É ordem de grandeza acima de tudo que 199–203 acrescentaram juntas
  (~4 KB gzip). Não é regressão desta branch e não foi investigado aqui; fica anotado como
  candidato a issue própria de orçamento de bundle da vitrine.
- **`ProdutoModal` a ~130 ms de INP a 4× de throttle:** dentro do alvo hoje, mas é a interação
  mais cara da vitrine e não sobra muita folga em aparelho fraco. Independe da 202.

## Conclusão

**A issue 202 não introduz nenhum GARGALO.** O risco que o plano levantou — re-render do
catálogo inteiro por tecla — foi medido em loja real e cabe no orçamento com ~2× de folga
(96 ms de pior caso a 6× de throttle, contra 200 ms de INP), com a lógica de busca respondendo
por menos de 10 % do custo. Um achado **CUSTO** (F1: 4 px de diferença de altura entre resumo
e trilho fazem o scrollspy ser reconstruído duas vezes a cada limpeza, com fix de uma constante
compartilhada). CLS segue 0, bundle cresce 1,9 KB gzip sem dependência nova, payload e banco
não mudam, e o caminho do carrinho não regrediu.
