## Plano Técnico

### Análise do Codebase

O que já existe e será REUSADO (nada novo a criar fora do wiring):

- `src/app/(publica)/loja/[slug]/page.tsx` — já tem `generateMetadata({ params })` async (linhas 50-63) que faz `await params`, abre `createClient()` e busca `buscarLojaPorSlug(db, slug)`. **Estender este bloco**, não criar novo arquivo. Não existe `layout.tsx` na pasta `loja/[slug]/` — confirmado por `ls`. Criar um layout só para metadata seria duplicar o I/O (segunda chamada a `buscarLojaPorSlug`) sem ganho. **Decisão: estender o `generateMetadata` de `page.tsx`.**
- `src/app/(publica)/loja/[slug]/manifest.webmanifest/route.ts` — Route Handler da issue 002, já entregue. Responde em `/loja/<slug>/manifest.webmanifest`. O href do `<link rel="manifest">` aponta EXATAMENTE para essa URL. O handler já resolve `theme_color`/`icons` do banco; o `<link>` só precisa apontar para ele.
- `src/lib/validacoes/loja.ts` → `schemaTema` — já importado e usado em `resolverTema()` no `page.tsx`. Reusável para extrair `tema.primaria` no metadata (mesmo schema, mesma fonte de verdade `#RRGGBB`).
- `src/lib/utils/manifest.ts` → `THEME_PADRAO = "#332616"` — constante de fallback de tema já existente. **Reusar** em vez de hardcodar a cor no `page.tsx`. O `theme-color` do viewport deve usar `THEME_PADRAO` de `manifest.ts` (fonte única) OU o `tema.primaria` da loja.
- `buscarLojaPorSlug(db, slug)` (`src/lib/supabase/queries/lojas.ts`) — query já em `lib/supabase/queries/`, lê a view `vitrine_lojas` (anon, RLS via `ativo = true`). Reusada; nada inline.
- `public/icons/apple-touch-icon.png` — asset estático já presente. Referenciado por `icons.apple`.

O que precisa ser CRIADO: nada. Só edição do `generateMetadata` existente + um export novo `generateViewport` no mesmo arquivo.

### Decisão de API (Next.js 16 — confirmado na doc oficial)

1. **`manifest`** — `metadata.manifest` injeta `<link rel="manifest" href="...">` automaticamente. `return { ..., manifest: \`/loja/${slug}/manifest.webmanifest\` }` com o slug REAL resolvido (não placeholder literal).
2. **`themeColor` é DEPRECADO em `metadata` desde Next 13.2** — não usar `metadata.themeColor`. O `theme-color` vai num export separado `generateViewport`, tipo `Viewport`, campo `themeColor`. Como depende do tema da loja (dinâmico por slug), usar `export async function generateViewport({ params })`.
3. **`apple-touch-icon`** — via `metadata.icons.apple`: `icons: { apple: "/icons/apple-touch-icon.png" }` → `<link rel="apple-touch-icon" ...>`.
4. **`generateMetadata` + `generateViewport` + default async component coexistem** no mesmo Server Component. Restrição: não exportar `metadata` (objeto) E `generateMetadata` no mesmo segmento — aqui só há `generateMetadata`.

### Cenários

**Caminho Feliz:**
1. App Router renderiza `/loja/<slug>` no SSR.
2. `generateMetadata` resolve `slug`, busca a loja, retorna `{ title, description, manifest, icons: { apple } }`.
3. `generateViewport` retorna `{ themeColor: tema.primaria ?? THEME_PADRAO }`.
4. `<head>` sai com `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color">`.
5. Navegador busca o manifest (handler 002) → prompt de instalação nativo.

**Casos de Borda:**
- **Loja inexistente/inativa:** `buscarLojaPorSlug` → null. `generateMetadata` já trata (title "Loja não encontrada"); nesse ramo **não** injetar `manifest`. Não chamar `notFound()` no metadata.
- **Tema ausente/malformado:** `schemaTema.safeParse` falha → `theme-color` usa `THEME_PADRAO`.
- **Falha de rede/banco:** envolver a busca em try/catch, degradar para metadata mínimo (`title: "iRango"`, sem manifest), `console.error("[metadataVitrine]", e)` — nunca vazar detalhe (§14).

**Tratamento de Erros:** falha → metadata mínimo + `console.error`. `<link rel="manifest">` só com loja ativa.

### Schema de Banco

Nenhuma alteração. Consome `nome`/`slug`/`tema` de `vitrine_lojas`. Sem migration, sem RLS nova.

### Validação (zod)

Reuso de `schemaTema` para extrair `tema.primaria`. Nenhum schema novo — sem input de cliente.

### Recálculo no Servidor

N/A — sem valor monetário. Metadata gerada SSR via anon + RLS (`vitrine_lojas`).

### Regra cliente ↔ servidor

| Invariante | Camada |
|-----------|--------|
| Manifest só de loja ativa | RLS — `vitrine_lojas` filtra `ativo = true`; href aponta para handler 002 que reaplica o filtro |
| `theme-color` da loja | Server (SSR) — lido do banco, validado por `schemaTema` |
| Sem dado sensível | Server — só colunas públicas da view |

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/app/(publica)/loja/[slug]/page.tsx` — (a) estender `generateMetadata`: `manifest` + `icons.apple` no caminho feliz; try/catch para degradação. (b) adicionar `export async function generateViewport({ params }): Promise<Viewport>` com `themeColor`. Importar `type { Viewport }` de `next` e `THEME_PADRAO` de `@/lib/utils/manifest`.

**NÃO criar:** `layout.tsx` na pasta `loja/[slug]/` — duplicaria I/O.

**NÃO tocar:** `manifest.webmanifest/route.ts` (002); `src/app/layout.tsx` (metadata raiz do SaaS).

### Dependências Externas

Nenhuma. Metadata/Viewport API do Next.js 16.2. Docs: generate-metadata e generate-viewport.

### Ordem de Implementação

Issue NÃO crítica — não exige TDD red-first.
1. Importar `Viewport` e `THEME_PADRAO`.
2. Estender retorno do `generateMetadata` (manifest + icons.apple) + try/catch.
3. Adicionar `generateViewport` com `themeColor`.
4. `next build` (sem warning de `themeColor` depreciado) + inspeção do HTML SSR de loja ativa do seed.
