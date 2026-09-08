## Plano Técnico

### Análise do Codebase

O que já existe e será **reusado** (nada a criar fora do `route.ts`):

- `src/lib/supabase/server.ts` → `createClient()` — client SSR **anon** (`@supabase/ssr`, lê cookies). É o mesmo client usado por `page.tsx`/`generateMetadata` da vitrine. Reusar; não criar client novo nem ler `process.env` no handler.
- `src/lib/supabase/queries/lojas.ts` → `buscarLojaPorSlug(client, slug)` — já lê a **view `vitrine_lojas`** (anon, filtra `ativo = true` por design), `.maybeSingle()`, retorna `LojaPublica | null`. **Fonte única** de leitura por slug. Reusar; NUNCA `.from('lojas')`/`.from('vitrine_lojas')` inline.
- Tipo `LojaPublica` (`Tables<"vitrine_lojas">`) — exportado da mesma query. Todas as colunas são `… | null` (é uma view): `nome`, `slug`, `tema`, `logo_url` precisam de guarda de null.
- `src/lib/validacoes/loja.ts` → `schemaTema` (zod `.strict()`, `primaria`/`fundo`/`destaque` em `#RRGGBB`). Já é o schema canônico usado em `page.tsx` para validar o `tema` (Json) antes de injetar. **Reusar** para extrair `theme_color`/`background_color` com segurança (defesa contra cor malformada vinda do banco).
- `public/icons/vitrine-192.png` e `vitrine-512.png` (issue 001) — já presentes. Fallback de ícone.
- Padrão de Route Handler GET: `src/app/(auth)/auth/callback/route.ts` e `src/app/api/webhooks/hotmart/route.ts` — assinatura `export async function GET(...)`, retorno `Response`/`NextResponse`, `console.error` para detalhe e mensagem genérica ao usuário (§14).

**O que precisa ser criado** (e por que não dá pra reusar): apenas
`src/app/(publica)/loja/[slug]/manifest.webmanifest/route.ts`. Não existe handler de manifest hoje; a rota é específica desta issue. **Não** criar util de truncamento (RN-5 / "Fora de escopo": truncamento trivial inline) nem util de tema (já existe `schemaTema`).

> Nota: **não há `layout.tsx`** sob `(publica)/loja/[slug]/` — o `<link rel="manifest">` fica para a issue 004 (fora de escopo aqui). A pasta `manifest.webmanifest/` é irmã de `page.tsx`.

### Roteamento Next.js 16

- App Router trata `manifest.webmanifest` como **segmento de rota literal** (tem `.`, mas como é o nome de uma pasta com `route.ts`, o Next casa a URL exata). Caminho do arquivo: `src/app/(publica)/loja/[slug]/manifest.webmanifest/route.ts` → URL `/loja/:slug/manifest.webmanifest` (o grupo `(publica)` não entra na URL).
- Em Next 16, o 2º argumento do handler traz `params` como **Promise**:
  ```ts
  export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> },
  ): Promise<Response> {
    const { slug } = await params;
  }
  ```
- `export const runtime = "nodejs"` (Supabase SSR + cookies exigem Node, não Edge).
- Handler é dinâmico por natureza (lê banco por cookie/slug); não marcar como estático.

### Estrutura do arquivo `route.ts`

1. Imports: `notFound` de `next/navigation`; `createClient` de `@/lib/supabase/server`; `buscarLojaPorSlug` de `@/lib/supabase/queries/lojas`; `schemaTema` de `@/lib/validacoes/loja`.
2. `export const runtime = "nodejs";`
3. Constantes locais: `THEME_PADRAO`/`FUNDO_PADRAO` (tokens iRango `#332616` / `#f5f0e6`, espelhando `TEMA_PADRAO` de `page.tsx`) e os caminhos de ícone fallback `/icons/vitrine-192.png` e `/icons/vitrine-512.png`.
4. `GET`:
   - `const { slug } = await params;`
   - `const db = await createClient();`
   - `const loja = await buscarLojaPorSlug(db, slug);`
   - `if (!loja || !loja.nome || !loja.slug) notFound();` — slug/nome null da view = loja inutilizável → 404.
   - Resolver tema: `const tema = schemaTema.safeParse(loja.tema); const theme_color = tema.success ? tema.data.primaria : THEME_PADRAO; const background_color = tema.success ? tema.data.fundo : FUNDO_PADRAO;`
   - Resolver ícones: `const icones = montarIcones(loja.logo_url);` (helper local) — ver validação `https://` abaixo.
   - Montar objeto `manifest` (tipo abaixo) com `start_url`/`scope`/`id` = `` `/loja/${loja.slug}` ``.
   - `return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json" } });`
   - `try/catch` em volta da leitura: erro do PostgREST → `console.error("[manifestVitrine]", error)` + `notFound()` ou `Response` 500 genérico (sem vazar detalhe, §14). Preferir deixar o erro propagar para o error boundary só se não vazar; usar 500 genérico explícito é mais seguro.

### Tipo do manifest (objeto a serializar)

```ts
type WebManifestIcon = { src: string; sizes: string; type: string };
type WebManifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  id: string;
  display: "standalone";
  theme_color: string;
  background_color: string;
  icons: WebManifestIcon[];
};
```

- `name` = `loja.nome`.
- `short_name` = `loja.nome.length > 12 ? loja.nome.slice(0, 12) : loja.nome` — **sim, `slice(0, 12)`** (RN-5, truncamento trivial inline; sem reticências, sem util novo). `slice` é seguro para o caso comum; trunca por UTF-16 code unit (aceitável para v1).
- `display: "standalone"`, literal.

### Validação `https://` do `logo_url` (defesa em profundidade — RN-3 / §15)

Helper local `montarIcones(logoUrl: string | null): WebManifestIcon[]`:
- Se `logoUrl` é truthy **e** `logoUrl.startsWith("https://")` → dois ícones com `src: logoUrl`, `sizes: "192x192"` e `"512x512"`, `type` derivado (usar `"image/png"` como padrão; o navegador re-deriva pelo conteúdo — não bloquear). A mesma `logo_url` serve aos dois tamanhos (v1 não redimensiona — spec "Fora do Escopo").
- Caso contrário (null, vazio, `http:`, `javascript:`, data URI) → fallback `/icons/vitrine-192.png` + `/icons/vitrine-512.png`, `type: "image/png"`.
- O CHECK no banco (`logo_url LIKE 'https://%'`) já garante isso na escrita; a checagem no handler é **defesa em profundidade**, não confiança no cliente — `logo_url` vem do banco (lojista), tratado como não confiável (§15).

### Cenários

**Caminho feliz:** navegador pede `/loja/pizzaria-da-vovo/manifest.webmanifest` → `createClient` (anon) → `buscarLojaPorSlug` retorna a loja ativa → tema válido → `logo_url https://` → `Response` 200 JSON com `Content-Type: application/manifest+json`, ícones na `logo_url`.

**Casos de borda:**
- Slug inexistente → `buscarLojaPorSlug` retorna `null` → `notFound()` (404).
- Loja inativa → a view `vitrine_lojas` já filtra `ativo = true` → não retorna linha → `null` → `notFound()` (404). (RN-1, garantido na view, não no handler.)
- `loja.nome`/`loja.slug` null (linha da view com colunas nulas) → `notFound()`.
- `logo_url` null → ícones de fallback `/icons/vitrine-{192,512}.png`.
- `logo_url` com `http://`/`javascript:`/`data:` (improvável pelo CHECK, mas defesa) → fallback.
- `tema` null/malformado → cores padrão iRango (via `schemaTema.safeParse`).
- `nome` > 12 chars → `short_name` truncado em 12; `name` completo.
- Falha de rede/PostgREST → `console.error` com prefixo `[manifestVitrine]`, resposta genérica (500 ou error boundary), sem detalhe ao cliente.

**Tratamento de erros (§14):** detalhe do `error` só em `console.error` no servidor; ao cliente, 404 (loja inexistente/inativa) ou resposta genérica sem corpo sensível. Nunca serializar o `error` do PostgREST na resposta.

### Schema de Banco

**Nenhuma migration, tabela, coluna ou RLS nova.** Consome campos já existentes na view `vitrine_lojas` (`nome`, `slug`, `tema`, `logo_url`). Acesso reusa a view anon já em produção.

### Validação (zod)

Reusa `schemaTema` de `src/lib/validacoes/loja.ts` (mesmo schema do `page.tsx`) para extrair `theme_color`/`background_color`. Sem schema novo — não há input do cliente a validar (o `slug` vem da URL e é usado só como filtro de `.eq('slug', …)` parametrizado pelo PostgREST, sem concatenação SQL).

### Regra cliente ↔ servidor

| Invariante | Camada que garante |
|-----------|--------------------|
| Só dados públicos da loja (RN-1) | **View `vitrine_lojas`** (anon, projeção pública, filtra `ativo = true`) — handler nunca lê `lojas` |
| Loja inativa/inexistente → 404 | **Server (Route Handler)** `notFound()` + view (não retorna linha inativa) |
| `logo_url` só `https://` (RN-3) | **CHECK no banco** + validação de protocolo no handler (defesa em profundidade, §15) |
| Fallback de ícone (RN-4) | **Server (Route Handler)** |
| `short_name` ≤ 12 (RN-5) | **Server (Route Handler)** inline |

Sem valor monetário → sem recálculo de servidor. Sem `service_role` (anon basta — menor privilégio).

### Recálculo no Servidor

N/A — feature sem valor monetário (preço/frete/desconto/total). §10 de `seguranca.md` não se aplica.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/(publica)/loja/[slug]/manifest.webmanifest/route.ts` — único arquivo novo (motivo: handler de manifest não existe).

**NÃO modificar:**
- `src/lib/supabase/queries/lojas.ts` — `buscarLojaPorSlug` já serve como está.
- `src/lib/supabase/server.ts` — `createClient` anon já serve.
- `src/lib/validacoes/loja.ts` — `schemaTema` já serve.
- `page.tsx` da vitrine / qualquer layout — `<link rel="manifest">` é issue 004.
- `public/icons/*` — já entregues pela issue 001.
- `components/ui/*` — não se edita à mão (shadcn). (não aplicável aqui de qualquer forma.)

### Dependências Externas

Nenhuma nova. Usa `next` (App Router Route Handler, `notFound`), `@supabase/ssr` (via `createClient` existente), `zod` (via `schemaTema` existente). Padrão de manifest: spec W3C Web App Manifest + `Content-Type: application/manifest+json`.

### Ordem de Implementação

Issue **não crítica** (`crítica: NÃO` — sem dinheiro/RLS/auth/cupom/token). Sem fase RED obrigatória; teste de behavior é opcional/recomendado, não bloqueante.

1. Criar `route.ts` com `runtime = "nodejs"`, `GET`, leitura via `buscarLojaPorSlug` (anon), `notFound()` para `null`.
2. Montar o objeto manifest (name/short_name truncado, start_url/scope/id, display, theme_color/background_color via `schemaTema`).
3. Helper `montarIcones` com validação `https://` e fallback.
4. Responder `JSON.stringify` + `Content-Type: application/manifest+json`.
5. `next build` (verificar que o segmento `manifest.webmanifest` casa e o handler compila) e teste manual dos 4 critérios de aceite.
