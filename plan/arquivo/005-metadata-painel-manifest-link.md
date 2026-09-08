## Plano Técnico

### Análise do Codebase

O que já existe e será REUSADO:

- `src/app/(painel)/painel/layout.tsx` — Server Component que JÁ é async (`export default async function PainelLayout`) e contém o guard de auth (sessão + loja + `decidirAcessoPainel`). É exatamente o lugar do wiring (spec §Wiring: "layout do painel, já atrás do guard de auth").
- `src/app/(painel)/painel/manifest.webmanifest/route.ts` — Route Handler da issue 003, já entregue. Responde em `/painel/manifest.webmanifest` (href estático). Manifest nomeado pela loja do dono autenticado, escopado por sessão/RLS.
- `src/lib/utils/manifest.ts` → `THEME_PADRAO = "#332616"` — constante já existente, igual à cor do sidebar do painel. **Reusar** em vez de hardcodar.
- `public/icons/apple-touch-icon.png` — asset estático já presente.

O que precisa ser CRIADO: nada. Só adicionar dois exports (`metadata` + `viewport`) no `layout.tsx` existente.

### Q3: pode exportar `metadata` de um Server Component com default async?

**Sim.** Doc Next 16.2: `metadata`/`generateMetadata` são suportados em Server Components e coexistem com o default export async. Única restrição: não exportar `metadata` (objeto) E `generateMetadata` (função) no mesmo segmento. `PainelLayout` é Server Component (sem `'use client'`), já async, com guard — adicionar `export const metadata` ao lado do default é válido; o redirect/notFound do componente não afeta a resolução de metadata.

### Decisão de API (Next.js 16 — confirmado na doc oficial)

1. **`manifest`** — `metadata.manifest = "/painel/manifest.webmanifest"` → `<link rel="manifest" ...>`. **href ESTÁTICO** (não depende de slug/loja; conteúdo sensível resolvido por sessão DENTRO do handler 003). Por ser estático, usar `export const metadata: Metadata` (objeto), **não** `generateMetadata`.
2. **`themeColor` DEPRECADO em `metadata` desde Next 13.2** — vai no export `viewport`, tipo `Viewport`. Painel tem **cor FIXA** (`#332616` = `THEME_PADRAO`); layout NÃO embute dado de loja. **`export const viewport: Viewport = { themeColor: THEME_PADRAO }`** estático. (Q4: cor FIXA, não dinâmica.)
3. **`apple-touch-icon`** — `metadata.icons.apple = "/icons/apple-touch-icon.png"`. (Q5: sim, via `icons.apple`.)

### Cenários

**Caminho Feliz:**
1. Lojista autenticado acessa `/painel`; guard passa (`ok`); layout renderiza.
2. Next resolve `metadata` estático → `<link rel="manifest">` + `<link rel="apple-touch-icon">`.
3. `viewport` estático → `<meta name="theme-color" content="#332616">`.
4. Navegador busca `/painel/manifest.webmanifest`; handler 003 (sessão) responde nomeado pela loja → prompt de instalação.

**Casos de Borda:**
- **Sem sessão / guard redireciona:** componente faz `redirect(...)` antes de renderizar; a página de destino tem seu próprio metadata. `<link rel="manifest">` só aparece no ramo `ok`. Isolamento do manifest é do handler 003 (401 sem sessão).
- **Loja órfão (auto-cura):** `redirect("/painel")` → re-render cai em `ok`, metadata normal.
- **Falha de I/O no guard:** `catch` → `redirect("/login?erro=sessao")`; metadata não renderiza.

**Tratamento de Erros:** metadata estático (sem I/O) → sem erro a tratar. Auth tratada pelo guard existente (fail-closed, §14).

### Schema de Banco

Nenhuma alteração. Layout NÃO lê dado de loja para o metadata (href estático). Sem migration, sem RLS nova.

### Validação (zod)

N/A — sem input de cliente, href constante literal.

### Recálculo no Servidor

N/A — sem valor monetário.

### Regra cliente ↔ servidor

| Invariante | Camada |
|-----------|--------|
| Manifest do painel só do dono autenticado | Server — handler 003 deriva a loja da SESSÃO (`buscarLojaDoDono` + RLS), nunca de query string |
| `<link>` não vaza loja | Server — href constante `/painel/manifest.webmanifest`, sem `loja_id`/`slug` |
| Sem sessão → sem manifest | Server — handler 003 responde 401 sem dado de loja |

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/app/(painel)/painel/layout.tsx` — adicionar `import type { Metadata, Viewport } from "next"`, `import { THEME_PADRAO } from "@/lib/utils/manifest"`, e dois exports estáticos:
  - `export const metadata: Metadata = { manifest: "/painel/manifest.webmanifest", icons: { apple: "/icons/apple-touch-icon.png" } }`
  - `export const viewport: Viewport = { themeColor: THEME_PADRAO }`

  Default async `PainelLayout` e guard ficam INTOCADOS.

**NÃO tocar:** `manifest.webmanifest/route.ts` (003); `src/app/layout.tsx`; lógica do guard.

### Dependências Externas

Nenhuma. Metadata/Viewport API do Next.js 16.2. Docs: generate-metadata e generate-viewport.

### Ordem de Implementação

Issue NÃO crítica — não exige TDD red-first.
1. Adicionar imports (`Metadata`, `Viewport`, `THEME_PADRAO`).
2. Adicionar os dois exports estáticos.
3. `next build` (confirma coexistência com default async, sem warning de `themeColor`) + inspeção do HTML SSR de `/painel` logado.
