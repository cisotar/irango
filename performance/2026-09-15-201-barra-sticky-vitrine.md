# Auditoria de performance — 201 (barra sticky da vitrine e âncora compartilhada)

**Data:** 2026-09-15
**Escopo:** issue `tasks/201-barra-sticky-da-vitrine-e-ancora-compartilhada.md`, implementação
não commitada na branch `feat/busca-e-navegacao-categorias-vitrine`.
**Agente:** `acelerar`

## Contexto

Issue introduz a primeira camada `'use client'` dona de layout na vitrine pública
mobile-first. Pergunta central da auditoria: o `ResizeObserver` da barra sticky custa
alguma coisa no caminho crítico, a medição em runtime gera layout thrashing, e o novo
client component cabe no orçamento de bundle da `/loja/[slug]`.

### Arquivos lidos (íntegros)

- `src/components/vitrine/CatalogoVitrine.tsx` (novo, `'use client'`)
- `src/components/vitrine/medicaoBarraVitrine.ts` (novo, módulo neutro — extraído da
  mecânica de medição durante a auditoria)
- `src/components/vitrine/layoutVitrine.ts` (novo, constantes)
- `src/lib/utils/ancoraCategoria.ts` (novo, puro)
- `src/components/vitrine/SecaoCatalogo.tsx` (diff)
- `src/app/(publica)/loja/[slug]/page.tsx` (diff)
- `src/app/globals.css` (diff)
- `src/components/vitrine/CardProduto.tsx`, `HeaderLoja.tsx` (contexto de imagem)
- `next.config.ts` (config de `images.remotePatterns`)

## Medições

### Lighthouse — vitrine real, mobile, build de produção

`npm run build` + `npm run start` na porta 3123, Chrome headless, `--preset=perf
--form-factor=mobile`, loja `paodociso` (loja de teste do usuário).

| Métrica | Medido | Alvo | Situação |
|---|---|---|---|
| **LCP** | **6,7 s** | < 2,5 s | **fora** (causa pré-existente, ver F5) |
| **CLS** | **0** | ~0 | dentro |
| INP | não coletado (Lighthouse lab não emite INP sem interação) | < 200 ms | — |
| FCP | 1,6 s | — | ok |
| TBT | 170 ms | — | ok |
| Speed Index | 3,7 s | — | ok |
| Score performance | 0,72 | — | — |

Peso total da página: **1.454 KiB**, dos quais **1.121 KiB em 17 imagens de produto**
servidas em resolução original do Supabase Storage. `image-delivery-insight` estima
**1.089 KiB** de economia e **−450 ms de LCP**. `cache-insight`: 897 KiB.
HTML do documento: 48 KB, `server-response-time` 320 ms (SSR on-demand contra o cloud).

### Bundle

`esbuild --minify` sobre cada módulo novo que entra no grafo do cliente:

| Módulo | Minificado |
|---|---|
| `CatalogoVitrine.tsx` | 972 B |
| `medicaoBarraVitrine.ts` | 411 B |
| `layoutVitrine.ts` | 181 B |
| `ancoraCategoria.ts` | 84 B |
| **Total** | **1.648 B** (~825 B gzip) |

Chunk do catálogo no build (`.next/static/chunks/38msu3ec7-z5y.js`, o que contém
`--altura-barra`): 68.529 B raw / **21.043 B gzip**. O acréscimo da 201 fica em **~4 %
gzip do chunk**, e `ancoraCategoria` (84 B) substitui uma função privada removida de
`SecaoCatalogo` — o delta líquido é menor ainda.

**Não há fronteira de cliente nova.** `SecaoCatalogo.tsx` já era `'use client'` e já era
renderizado direto por `page.tsx`; a 201 só sobe a fronteira um componente. O payload
RSC serializado é o mesmo (`categorias` + `opcionaisPorCategoria` seguem sendo
serializados uma única vez, agora para `CatalogoVitrine`). Zero dependência nova
(`git diff package.json` vazio).

### Banco

`git diff --stat` não toca `supabase/`, `lib/actions/` nem `lib/supabase/queries/`.
As 4 queries do SSR da rota são byte a byte as de hoje. **Nenhum `EXPLAIN ANALYZE`
aplicável** — a issue não introduz query, índice, RLS nem coluna. Sem N+1, sem `select()`
gordo novo, sem lock.

### Testes

`npx vitest run CatalogoVitrine.test.tsx SecaoCatalogo.test.tsx ancoraCategoria.test.ts`
→ 3 arquivos, 13 testes verdes. `npm run build` verde.

## Análise do `ResizeObserver` (pergunta central)

Não há layout thrashing. A sequência é:

1. `useLayoutEffect` → `medir()` → `getBoundingClientRect()`. É **um** reflow síncrono
   forçado, na hidratação, antes do paint. É exatamente o que a issue precisa (medir
   antes de pintar) e é irredutível.
2. `observer.observe(barra)` → callback do `ResizeObserver` roda **depois** do layout,
   no ponto de entrega do RO do mesmo frame. Ler `getBoundingClientRect()` ali **não**
   força reflow: a geometria já está limpa.
3. `--altura-barra` é consumida em um único lugar — `scroll-margin-top` das `<section>`
   (`SecaoCatalogo.tsx:124`) — que **não afeta layout**. Logo não existe realimentação
   e não há risco de `ResizeObserver loop completed with undelivered notifications`.
4. O RO observa **só a barra**. Altura da barra não muda com altura de viewport, então
   o show/hide da barra de endereço no mobile durante o scroll **não** dispara o
   observer. Na prática ele fica ocioso: só rotação, zoom de fonte e (a partir da 202/203)
   a troca trilho↔resumo o acordam.
5. Cleanup correto: `disconnect()` + `removeProperty()`. Não acumula observer nem vaza a
   var para `/checkout` (critério da 204 — satisfeito).

O custo real do RO nesta issue é ~0. Fica um desperdício menor: ver F1.

## Findings

### F1 — `medicaoBarraVitrine.ts:56-59` — POLIMENTO

`medir()` chama `setProperty` incondicionalmente, mesmo quando a altura não mudou.
`observe()` entrega um callback inicial por contrato, então **toda hidratação da vitrine
publica a mesma altura duas vezes** (uma no `useLayoutEffect`, outra na entrega inicial
do RO). Cada escrita de custom property não-registrada em `documentElement` invalida
estilo do documento inteiro.

*Impacto:* um recálculo de estilo redundante por carga da vitrine hoje — imperceptível
isolado. **Vira relevante em 202/203**, quando a barra passa a mudar de altura em
interação (troca trilho↔resumo) e o RO entra no caminho de INP.

*Fix (3 linhas, dentro de `medirEObservarBarra`):*

```ts
let ultimaAltura = -1;
function medir(): void {
  const altura = Math.ceil(barra.getBoundingClientRect().height);
  if (altura === ultimaAltura) return;
  ultimaAltura = altura;
  raiz.style.setProperty(VAR_ALTURA_BARRA, `${altura}px`);
}
```

Status: **aceito / recomendado aplicar no mesmo ciclo** (custo trivial, e é a guarda
que 202 e 203 vão querer de qualquer jeito).

### F2 — `SecaoCatalogo.tsx:124` — POLIMENTO

`style={{ scrollMarginTop: "..." }}` aloca um objeto novo por `<section>` a cada render.
Hoje `SecaoCatalogo` renderiza uma vez; na 202 ele re-renderiza a cada tecla digitada,
multiplicando a alocação pelo número de categorias.

*Impacto:* alocações por keystroke; React ainda diffa por chave de estilo, então não há
escrita no DOM. Marginal.

*Fix:* hoistar para constante de módulo, `const ESTILO_ANCORA_CATEGORIA = { scrollMarginTop:
"calc(var(--altura-barra) + 0.75rem)" } as const;` e usar `style={ESTILO_ANCORA_CATEGORIA}`.
Preserva o teste (`expect(html).toContain("scroll-margin-top:calc(var(--altura-barra)")`).

Status: opcional.

### F3 — CLS da barra — sem achado

A barra é renderizada no SSR (o HTML servido contém `sticky top-0 z-30` uma vez) com a
altura final de 1px, então não há inserção pós-hidratação e nenhum deslocamento.
`scroll-margin-top` não move layout. CLS medido: **0**. Confirmado também que
`--altura-barra: 0px` no `:root` vale como fallback pré-hidratação sem invalidar o
`calc()`.

### F4 — bundle da 201 — sem achado

+1,6 KB minificado / ~825 B gzip, sem fronteira de cliente nova e sem dependência nova.
Dentro do orçamento "zero lib nova" do spec.

---

## Pré-existentes na vitrine (NÃO causados pela 201, encontrados ao medir)

### F5 — `src/components/vitrine/CardProduto.tsx:50` — GARGALO (pré-existente)

`<Image ... unoptimized />` em todas as fotos de produto da vitrine (idem
`ProdutoModal.tsx:232` e `HeaderLoja.tsx:52`), **apesar de `next.config.ts` já ter
`images.remotePatterns` configurado para o host do Supabase Storage**. O resultado
medido: 17 imagens, **1.121 KiB** de JPEG em resolução original, e um LCP de **6,7 s**
contra o alvo de 2,5 s. `image-delivery-insight` do Lighthouse: **1.089 KiB / −450 ms de
LCP**. Nenhuma imagem tem `sizes` (0 ocorrências no HTML servido).

*Fix:* remover `unoptimized` nos três componentes de vitrine, acrescentar `sizes`
coerente com a grade (ex.: `sizes="(max-width: 768px) 50vw, 25vw"`) e marcar as primeiras
imagens acima da dobra com `priority`. O optimizer do Next já serve AVIF/WebP e o
`remotePatterns` já autoriza o host — é remover um opt-out, não construir nada.

*Risco a verificar antes:* `unoptimized` pode ter sido posto de propósito (custo de
transformação de imagem na Vercel / plano). Decisão de produto, não técnica — por isso
não é fix automático.

Status: **issue separada** (candidata natural à 204, que já é a issue de auditoria da
feature). Fora do escopo da 201.

### F6 — cache das imagens de Storage — CUSTO (pré-existente)

`cache-insight`: 897 KiB reentregues por TTL curto no `Cache-Control` do bucket público.
Fix: aumentar `cacheControl` no upload (as fotos de produto são imutáveis por URL).
Status: issue separada.

### F7 — `/loja/[slug]` é `ƒ` (dinâmica) — observação, não achado

O SSR roda as 4 queries a cada request (`server-response-time` 320 ms). ISR seria
tentador para nome/descrição/foto/categoria, **mas a mesma resposta carrega
disponibilidade de produto** — cachear aqui vende esgotado. Qualquer tentativa de ISR
teria que separar catálogo estável de dado vivo primeiro. Registrado para não ser
"descoberto" de novo como ganho fácil.

## Conclusão

**A issue 201 não introduz nenhum GARGALO nem CUSTO.** O `ResizeObserver` não gera
thrashing, o bundle cresce ~825 B gzip sem fronteira de cliente nova, o banco não é
tocado e o CLS medido é 0. Os dois findings da 201 são POLIMENTO, sendo o F1 recomendado
por ser a guarda que 202/203 vão exigir.

O LCP de 6,7 s da vitrine é **anterior a esta issue** e vem inteiramente das imagens de
produto sem otimização (F5). Essa é a alavanca real de conversão da vitrine e merece
issue própria.
