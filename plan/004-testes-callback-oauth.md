## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:
- `src/app/api/webhooks/hotmart/route.test.ts` — **modelo direto** de teste de unidade de Route Handler: mocka os colaboradores de I/O com `vi.mock(...)` + `vi.fn()`, importa o handler (`import { POST } from "./route"`), chama com um `Request`/`NextRequest` real e assere sobre o `Response` retornado. O teste do callback segue exatamente esse esqueleto, trocando `POST` por `GET`.
- `src/lib/auth/reconciliarPosConfirmacao.test.ts` — padrão de mock de módulo (`vi.mock("@/lib/...", () => ({ fn: (...a) => spy(...a) }))`), `beforeEach(() => vi.clearAllMocks())`, silenciar `console.error` com `vi.spyOn`. O teste do callback reusa esse padrão para mockar `@/lib/supabase/server` e `@/lib/auth/reconciliarPosConfirmacao`.
- `src/lib/actions/auth.test.ts` (linhas 42-44) — padrão exato de mock do client de servidor: `vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(serverClient) }))`. `createClient` do callback é `async`, então o mock retorna `Promise.resolve(...)`.
- `vitest.config.ts` — runner único do projeto (`environment: "node"`, `globals: true`). **Confirmado por smoke test**: `next/server` importa e `NextResponse.redirect(url)` funciona sob node, com `res.headers.get("location")` retornando a URL — não precisa de jsdom nem de config nova.
- `src/app/(auth)/auth/callback/route.ts` — código sob teste (já implementado). A função `sanitizarNext` é privada (não exportada); será exercitada **indiretamente** via `?next=` no request (não exportar só para o teste — evita alterar a superfície do módulo de produção).
- `src/lib/auth/googleOAuth.ts` — helper sob teste; mocka `@/lib/supabase/client` (`createClient`, **síncrono**, sem `await`) e `sonner` (`toast.error`).

O que precisa ser criado (nada de produção; só testes):
- `src/app/(auth)/auth/callback/route.test.ts` — colocalizado, igual ao webhook.
- `src/lib/auth/googleOAuth.test.ts` — colocalizado, ao lado do `reconciliarPosConfirmacao.test.ts`.

Nenhuma lib nova, nenhum util novo, nenhum helper de teste compartilhado — o padrão de mock inline por arquivo é o que o projeto já usa em 66 arquivos.

### Cenários

**Caminho Feliz (callback com `code` válido):**
1. Request `GET /auth/callback?code=abc` (sem `error`, sem `next`).
2. `createClient()` (mock) → client cujo `auth.exchangeCodeForSession` resolve `{ data: { user }, error: null }`.
3. Handler chama `exchangeCodeForSession("abc")` e depois `reconciliarPosConfirmacao(user)` (mockado).
4. Retorna redirect 307/308 com `location` = `${origin}/painel`.
5. Assertivas: `exchangeCodeForSession` chamado 1x com `"abc"`; `reconciliarPosConfirmacao` chamado 1x com o `user`; `location` termina em `/painel`.

**Caminho Feliz (helper `entrarComGoogle`):**
1. `createClient()` (mock) → `auth.signInWithOAuth` resolve `{ error: null }`.
2. Assertiva: `signInWithOAuth` chamado com `{ provider: "google", options: { redirectTo: <termina em /auth/callback> } }`; `toast.error` **não** chamado.
3. `window.location.origin` precisa existir — definir `globalThis.window` com `{ location: { origin: "https://app.local" } }` no teste (env node não tem `window`).

**Casos de Borda (callback):**
- `?error=access_denied&error_description=...` → redirect `location` = `${origin}/login?erro=google`; `exchangeCodeForSession` **não** chamado; `error_description` **não** aparece em `location` (assertiva explícita: `expect(location).not.toContain("error_description")` e `not.toContain("access_denied")`). Este caso falharia contra o código antigo — comprova a cobertura do bug (critério de aceite).
- sem `code` e sem `error` → redirect `location` = `${origin}/login?erro=auth`; `exchangeCodeForSession` **não** chamado.
- `code` presente mas `exchangeCodeForSession` resolve `{ error: <obj> }` → redirect `${origin}/login?erro=auth`; `reconciliarPosConfirmacao` **não** chamado.
- `code` válido mas `data.user` ausente (`null`) → ainda redireciona `/painel`; `reconciliarPosConfirmacao` **não** chamado (cobre o `if (data.user)`).
- `?code=abc&next=//evil.com` (open-redirect) → `location` = `${origin}/painel` (next rejeitado pelo `sanitizarNext`); assertiva `not.toContain("evil.com")`.
- `?code=abc&next=/painel/pedidos` (interno válido) → `location` = `${origin}/painel/pedidos`.

**Casos de Borda (helper):**
- `signInWithOAuth` resolve `{ error: <obj> }` → `toast.error` chamado 1x com a mensagem amigável; `console.error` chamado (silenciado no teste).

**Tratamento de Erros:**
- Verificado nos testes que o usuário só recebe `?erro=google` / `?erro=auth` (mensagem genérica, `seguranca.md` §14) e que detalhe (`error`, `error_description`) nunca vaza para a URL de redirect. `console.error` é silenciado via `vi.spyOn(console, "error").mockImplementation(() => {})` para não poluir o output.

### Schema de Banco
Não se aplica — issue de teste de roteamento de auth. Sem tabela, sem migration, sem RLS.

### Validação (zod)
Não se aplica — o callback não valida payload com zod; valida presença de `code`/`error` (querystring) e sanitiza `next` por allow-list de path interno. Nenhum schema novo.

### Recálculo no Servidor
Não se aplica — sem valor monetário.

### Regra cliente ↔ servidor (mapeamento de invariantes)
Os testes apenas **verificam** invariantes server-side já implementadas; não introduzem regra nova:
- **Anti open-redirect** (`sanitizarNext`): garantido no Route Handler (servidor). Teste prova que `//evil.com` é rejeitado.
- **Não vazar detalhe de erro** (§14): garantido no servidor (só `?erro=...` no redirect, `error` no `console.error`). Teste prova que `error_description` não chega na URL.
- **Troca de `code` por sessão**: `exchangeCodeForSession` seta cookies httpOnly no servidor; o teste verifica a orquestração (chamada + ordem condicional), não o efeito de cookie.
O helper `entrarComGoogle` é client-side por natureza (inicia o fluxo OAuth no browser) — não carrega regra de valor/permissão; a posse do email só vira verdade no callback (servidor), já coberto por `reconciliarPosConfirmacao.test.ts`.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/(auth)/auth/callback/route.test.ts` — testes do `GET` do callback (6 casos acima). Mocks: `@/lib/supabase/server` (createClient async), `@/lib/auth/reconciliarPosConfirmacao`. Usa `NextRequest` (ou `new Request(url)` — `GET` aceita `NextRequest`; construir via `new NextRequest("https://app.local/auth/callback?...")`).
- `src/lib/auth/googleOAuth.test.ts` — testes do helper (2 casos). Mocks: `@/lib/supabase/client` (createClient síncrono), `sonner` (toast.error). Stub de `window.location.origin`.

**NÃO tocar (produção):**
- `src/app/(auth)/auth/callback/route.ts` — não exportar `sanitizarNext` só para teste (exercitada via `?next=`); comportamento já correto.
- `src/lib/auth/googleOAuth.ts` — sob teste, sem mudança.
- `src/app/(auth)/login/LoginForm.tsx` e `cadastro/CadastroForm.tsx` — exibição do `?erro=` está fora de escopo (issue diz "testes de UI visual fora de escopo"); a leitura do erro já é exercida indiretamente pelas asserções de `location`.
- `vitest.config.ts` — nenhuma mudança (smoke test confirmou `next/server` sob node).
- `components/ui/` (shadcn) — não editar à mão.

### Dependências Externas
Nenhuma nova. Reusa:
- `vitest` 4.1.8 (já instalado) — runner.
- `next/server` (já dep do projeto) — `NextRequest`/`NextResponse`, importável sob node (confirmado).
- `sonner` (já dep) — mockado, não executado.
Doc relevante: Next.js App Router Route Handlers (https://nextjs.org/docs/app/building-your-application/routing/route-handlers); Supabase SSR `exchangeCodeForSession` (https://supabase.com/docs/guides/auth/server-side/nextjs).

### Ordem de Implementação
Issue **não crítica** (sem dinheiro/RLS/token) → não exige fase RED separada do `tdd`; é cobertura de código já implementado (escopo do `testar`). Mesmo assim, para honrar o critério de aceite "o teste do `?error=` falharia contra o código antigo", a ordem é:

1. `src/app/(auth)/auth/callback/route.test.ts` — começar pelo caso `?error=` (o que comprova o bug coberto), depois os demais casos do callback. Rodar `npx vitest run src/app/\(auth\)/auth/callback/route.test.ts` e confirmar verde.
2. `src/lib/auth/googleOAuth.test.ts` — sucesso + erro/toast. Rodar isolado e confirmar verde.
3. `npx vitest run` completo — garantir que os 1091 testes existentes continuam passando + os novos (sem regressão, sem flake).

Nota de verificação do critério de aceite (opcional, não commitar): para provar que o caso `?error=` pegaria a regressão, reverter mentalmente/temporariamente o bloco `if (erroOAuth)` do `route.ts` e confirmar que o teste fica vermelho — depois restaurar.
