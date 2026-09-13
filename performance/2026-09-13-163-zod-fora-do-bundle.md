# Auditoria de performance — issue 163 (zod fora do bundle público do checkout)

**Data:** 2026-09-13 · **Branch:** `fix/163-zod-fora-do-bundle-checkout`
**Escopo:** `tasks/163-zod-no-bundle-publico-do-checkout.md` · Plano:
`plan/loop-163-zod-fora-do-bundle-do-checkout.md` (passo 3, papel `acelerar`)
**Papel:** MEDIR a implementação já commitada. Nenhum arquivo de produção foi editado.

## Contexto

A issue 163 nasceu do finding CUSTO da auditoria da 126
(`performance/2026-09-06-checkout-abertura-whatsapp.md`): o chunk de zod era 42% do JS
do cliente da rota `/loja/[slug]/pedido`.

A implementação (variante B″ do plano) tirou o import estático de
`@/lib/validacoes/pedido` de `useEnviarPedido.ts` e passou a buscar o schema por
`import()` dinâmico agendado em `requestIdleCallback` (fallback `setTimeout(…,0)`),
em escopo de módulo. `enviar()` segue síncrono.

Arquivos lidos: `tasks/163-…md`, `plan/loop-163-…md`,
`performance/2026-09-06-checkout-abertura-whatsapp.md`, diff de `e0324ca`.

## Método (bundle) — build A/B real, reuso literal do método da 126

Duas cópias do repo **fora do repo**, em `/home/lenovo/github/.perf163/{bA,bB}`
(`git clone --no-hardlinks` + `git checkout <commit>`), `node_modules` por hardlink
`cp -al` (symlink não serve — o Turbopack aborta com
`Symlink [project]/node_modules is invalid`). O `.next/` do repo **não foi tocado**.

- **bA (baseline)** = `6dd491b` (`main`, antes da 163)
- **bB (depois)** = `e0324ca` (branch da 163)

`npx next build` nas duas: **exit 0**, mesma tabela de rotas. Chunks do cliente
atribuídos à rota por
`.next/server/app/(publica)/loja/[slug]/pedido/page_client-reference-manifest.js`.
Gzip = `gzip -9`.

Lighthouse **não executado**: a trava desta auditoria proíbe subir o app (o `npm run dev`
roda contra o Supabase cloud). LCP/INP/CLS ficam para a verificação manual do passo 5.
Nenhuma query, RLS ou payload de servidor mudou nesta issue — não havia o que medir
com `EXPLAIN`.

## Medições

### JS **inicial** (bloqueante) da rota `/loja/[slug]/pedido`

| | chunks | raw | gzip |
|---|---|---|---|
| bA (`6dd491b`) | 10 | 582.376 B | 151.775 B |
| bB (`e0324ca`) | 9 | 298.008 B | 87.610 B |
| **delta** | **−1** | **−284.368 B (−48,8%)** | **−64.165 B (−42,3%)** |

**Critério 3 do plano (queda ≥ 55 KB gzip no JS inicial): ATENDIDO** — 64.165 B gzip
(62,7 KiB), acima do piso de 55 KB. Nenhum módulo client da rota puxa zod estaticamente:
`grep -c 'cuid2\|toJSONSchema\|base64url'` devolve **0 em todos os 9 chunks** de bB
(em bA o chunk `2-3f1p4geboky.js` devolvia 3).

Chunks por build (raw / gzip):

- **bA:** `02ed_jp62045x` 23.076/8.460 · `054mgz9uv12in` 62.889/17.087 ·
  `0kf4l6ljddz5d` 43.350/15.340 · `0ynmvrf3e9z7y` 27.405/8.433 ·
  `1b59gvd7_3bac` 35.286/9.598 · `1spkje_hq9u5j` 777/531 ·
  **`2-3f1p4geboky` 283.469/63.925 (zod)** · `2agyljdl01jan` 18.918/6.731 ·
  `2vuqtpvwxw81h` 34.946/9.453 · `3exokyziuuf9m` 52.260/12.217
- **bB:** os mesmos, **sem** o chunk de zod, com `0kf4l6ljddz5d`+`1b59gvd7_3bac`
  rehashados em `2hgvr7x2sg3j3` 43.596/15.429 e `34mvtpwon6hnf` 34.141/9.269.

Os dois chunks rehashados somam 24.938 B gzip em bA e 24.698 B gzip em bB (**−240 B**):
é o import estático que saiu menos o loader dinâmico que entrou. Nenhum peso escondido.

### Limite honesto — isto NÃO é economia de tráfego

A mudança reduz o JS **inicial/bloqueante**, **não** o total de bytes baixados: o chunk
de zod continua existindo e continua sendo buscado, só que fora do caminho crítico de
parse/hidratação, em `requestIdleCallback`.

| | raw | gzip |
|---|---|---|
| bA — inicial (zod incluído, bloqueante) | 582.376 B | 151.775 B |
| bB — inicial (bloqueante) | 298.008 B | 87.610 B |
| bB — chunk diferido `2-3f1p4geboky.js` (assíncrono, à parte) | 283.469 B | 63.925 B |
| **bB — total eventualmente baixado** | **581.477 B** | **151.535 B** |

Total gzip: 151.775 → 151.535 B (**−240 B, −0,16%**). O ganho real é de **parse/execução
e caminho crítico**, não de rede. Quem estiver em rede móvel ainda baixa os ~64 KB gzip
— depois da página ficar interativa, em paralelo, e sem bloquear a hidratação.

Soma de TODOS os `static/chunks/*.js` do build: 2.991.182 B raw / 880.211 B gzip (bA)
→ 2.991.942 B raw / 878.561 B gzip (bB), 69 → 70 arquivos. Coerente com "mesmo código,
outra fronteira de chunk".

### Prova de que o chunk virou assíncrono (não sumiu)

O chunk `2-3f1p4geboky.js` existe em bB e é referenciado pela tabela de chunks de
`2hgvr7x2sg3j3.js` (um dos 9 iniciais), mas **não** aparece no
`page_client-reference-manifest.js` da rota. O trecho minificado em
`34mvtpwon6hnf.js` (onde vive `useEnviarPedido`) confirma o agendamento:

```
("function"==typeof window.requestIdleCallback?window.requestIdleCallback:e=>window.setTimeout(e,0))
(()=>{Y??=e.A(508574).then(e=>{X=e.schemaPayloadPedido}).catch(()=>{})})
```

Disparo único (`Y??=`), falha silenciosa (`.catch(()=>{})`), fora de qualquer componente
ou hook React — exatamente o desenho B″ do plano.

## Findings

**Nenhum achado de performance — código dentro do orçamento.**

A mudança é uma melhora medida no caminho crítico da rota mais monetária do produto,
sem regressão de tráfego (−240 B gzip no total) e sem query, RTT ou payload novo.

### Não reaberto (já registrado, segue aberto)

- `buscarLojaPorSlug` roda 2× no checkout (`pedido/page.tsx`, `generateMetadata` + corpo),
  sem `React cache()` — GARGALO 1 de `2026-07-09-vitrine-checkout.md`.
- ViaCEP/Nominatim em série e 4 queries de catálogo em série (issues 158 e 159).

## Resumo

| Métrica | bA (`6dd491b`) | bB (`e0324ca`) | delta |
|---|---|---|---|
| JS inicial da rota (gzip) | 151.775 B | 87.610 B | **−64.165 B** |
| JS inicial da rota (raw) | 582.376 B | 298.008 B | −284.368 B |
| Total eventualmente baixado (gzip) | 151.775 B | 151.535 B | −240 B |
| chunks iniciais | 10 | 9 | −1 |

**Status:** critério 3 do plano atendido (≥ 55 KB gzip). Corrigido no ciclo.

**Baseline atualizado para comparação futura:** `/loja/[slug]/pedido` = 9 chunks
iniciais, 298.008 B raw / 87.610 B gzip, mais um chunk assíncrono de 283.469 B raw /
63.925 B gzip (Next 16.2.9, Turbopack, `e0324ca`).

**Cópias de build preservadas** (não removidas — remoção só com confirmação):
`/home/lenovo/github/.perf163/bA` e `/home/lenovo/github/.perf163/bB`.

## Verificação manual em produção (2026-09-13, `npx next start`)

Sem Playwright/MCP de browser (issue 176), o caminho degradado foi provado à mão
contra o build de produção, não contra o `next dev`. Método: DevTools → Network →
Request conditions → bloquear a URL exata do chunk, com `Disable cache` marcado.

**Padrão que funciona:** `http://localhost:<porta>/_next/static/chunks/2-3f1p4geboky.js`

**Armadilha (custou várias tentativas):** o painel novo do Chrome exige um
URLPattern válido — `*validacoes*` não parseia. E, pior, `*validacoes*` NUNCA
casa em produção: os nomes de chunk são hasheados e não contêm o caminho do
módulo. Em `next dev` o chunk se chama `src_lib_validacoes_pedido_ts_189eati._.js`,
em produção `2-3f1p4geboky.js`. Bloquear por nome legível só funciona em dev.

**Resultado com o chunk bloqueado (`1 affected`, status `(blocked:devtools)`,
initiator `turbopack-2-…`, 0.0 kB):** a página do checkout carregou normalmente,
o pedido `8D67E906` foi criado, a aba do WhatsApp abriu no gesto do clique e a
confirmação renderizou. A degradação funciona: o cliente perde o preview, o
servidor segue barrando.

**ATENÇÃO — falso positivo em `next dev`:** o MESMO bloqueio em `npm run dev`
derruba a página com `ChunkLoadError` em `pedido/page.tsx:105` (`<CheckoutWizard>`),
levantado pelo cliente RSC (`react-server-dom-turbopack-client.browser.development.js`),
NÃO pelo `import()` do hook — por isso o `.catch(() => {})` não o segura. Causa: em
dev o Turbopack registra o chunk dinâmico no grafo da página e o React o preloada.
Em produção o chunk está ausente do `page_client-reference-manifest.js` da rota
(verificado no build A/B acima), então ninguém o preloada. **É artefato de dev.**
Quem repetir este teste no `next dev` vai ver a página quebrar e concluir errado.

O initiator do chunk em produção é o runtime do Turbopack, não o documento —
confirmação no browser do que o A/B já mostrava: o chunk saiu do caminho inicial.
