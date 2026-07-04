## Plano Técnico

### Análise do Codebase
O que já existe e será reusado:
- `src/lib/auth/admin.ts` — `ehAdminSaaS(userId: string): boolean` (issue 147). Server-only, **síncrono**, **fail-safe** (env ausente/vazia → `false`, não lança). É exatamente o contrato que o callback precisa: recebe um `userId` já autoritativo e decide sem novo `getUser()`. **Reusar; não reimplementar** e **não** ler `SAAS_ADMIN_USER_ID` direto no route handler.
- `src/app/(auth)/auth/callback/route.ts` — handler `GET`. Já tem `sanitizarNext` (anti-open-redirect: só path interno, rejeita `//` e não-`/`) e já faz `if (data.user)` antes de `reconciliarPosConfirmacao`. O `data.user` vem de `exchangeCodeForSession(code)` — **fonte autoritativa** (derivada do cookie de sessão HttpOnly recém-setado), **nunca** de query param. `sanitizarNext` fica **INTACTO**.
- `src/app/(auth)/auth/callback/route.test.ts` — suíte de unidade já existente do handler. Mocka `@/lib/supabase/server` (`createClient` async → client com `exchangeCodeForSession`) e `@/lib/auth/reconciliarPosConfirmacao`. Helper `makeRequest(search)`. **Estender esta suíte**, seguindo o padrão de mock existente.
- `src/lib/auth/admin.test.ts` — mostra o padrão `vi.stubEnv("SAAS_ADMIN_USER_ID", ...)` / `vi.unstubAllEnvs()`.
- `vitest.config.ts` — já aliasa `server-only` para um módulo vazio, então importar `ehAdminSaaS` (que importa `server-only`) no teste funciona sem mock adicional.

O que precisa ser criado: **nada de novo**. A mudança é ~3 linhas no handler + novos casos de teste. Sem novo arquivo, sem novo helper, sem nova env, sem tabela/RLS/migration.

### Cenários
**Caminho Feliz:**
1. Usuário volta do provider com `?code=...` (sem `next`).
2. `exchangeCodeForSession(code)` troca o código por sessão e devolve `data.user` autoritativo.
3. `reconciliarPosConfirmacao(data.user)` roda (best-effort, inalterado).
4. Decisão do destino padrão: `data.user && ehAdminSaaS(data.user.id)` → `/admin`; senão → `/painel`.
5. `next` sanitizado, se presente, **tem prioridade absoluta** sobre o destino padrão (`next ?? destinoPadrao`).
6. Redirect para `${origin}${next ?? destinoPadrao}`.

**Casos de Borda:**
- `next` explícito válido (`/vitrine`, `/painel/pedidos`): respeitado para **qualquer** usuário — dono ou lojista — porque `next` é avaliado antes da decisão de identidade.
- `next` malicioso (`//evil.com`, `http://...`): `sanitizarNext` → `undefined` → cai na decisão padrão por identidade (dono→`/admin`, lojista→`/painel`). Nunca vaza para `Location`.
- `data.user` null (troca ok mas sem user): `data.user && ...` curto-circuita → não-admin → `/painel`; `reconciliar` não é chamado (guard já existente). Sem crash.
- `SAAS_ADMIN_USER_ID` ausente/vazia: `ehAdminSaaS` retorna `false` (fail-safe) → `/painel`. **Login de ninguém quebra** — inclusive o do próprio dono (degrada para `/painel`, não erro).
- Erro OAuth (`?error=`) ou sem `code`: caminhos existentes inalterados, retornam antes da decisão.
- `exchangeCodeForSession` com erro: retorno `/login?erro=auth` inalterado, antes da decisão.

**Tratamento de Erros:** `ehAdminSaaS` é fail-safe e não lança; nenhum novo `try/catch` é necessário no handler. Erros de OAuth/troca continuam com mensagem genérica ao usuário e `console.error` só no servidor (`seguranca.md` §14). Nenhum detalhe de identidade vai para a URL.

### Schema de Banco
Nenhuma tabela, coluna ou migration. A identidade do dono é a env `SAAS_ADMIN_USER_ID` (server-only), não um registro. **Sem RLS nova** — a autoridade de `/admin/*` é o guard `verificarAdminSaaS()` (fail-closed), não RLS (`seguranca.md` §7).

### Validação (zod)
Não se aplica: nenhum input de formulário é validado. O único "input" é `code`/`next`/`error` da query, já tratados (`next` por `sanitizarNext`; `code`/`error` pelos guards existentes).

### Recálculo no Servidor
Não há valor monetário. A invariante desta issue é de **controle de acesso/roteamento**, garantida 100% no servidor (Route Handler): a comparação de identidade usa `data.user.id` (autoritativo do `exchangeCodeForSession`) contra `SAAS_ADMIN_USER_ID` (server-only) via `ehAdminSaaS`. O cliente recebe apenas um redirect já decidido. **O redirect não concede autoridade** — a autoridade de `/admin` é reavaliada pelo guard fail-closed (issue 149).

### Mudança exata (poucas linhas)
Em `src/app/(auth)/auth/callback/route.ts`:
1. Adicionar import: `import { ehAdminSaaS } from "@/lib/auth/admin";`
2. Substituir a última linha
   ```ts
   return NextResponse.redirect(`${origin}${next ?? "/painel"}`);
   ```
   por
   ```ts
   const destinoPadrao = data.user && ehAdminSaaS(data.user.id) ? "/admin" : "/painel";
   return NextResponse.redirect(`${origin}${next ?? destinoPadrao}`);
   ```
`sanitizarNext` e todo o resto (erro OAuth, sem code, erro de troca, `reconciliarPosConfirmacao`) ficam **INTACTOS**.

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar** `src/app/(auth)/auth/callback/route.ts` — import + decisão do destino padrão (~3 linhas). Motivo: alvo da issue.
- **Modificar** `src/app/(auth)/auth/callback/route.test.ts` — adicionar casos de dono/lojista/env-ausente e ajustar `vi.stubEnv`/`unstubAllEnvs` no setup. Motivo: cobrir a nova decisão (fase RED antes do código).
- **NÃO tocar** `src/lib/auth/admin.ts` — `ehAdminSaaS` já pronto (147); só consumir.
- **NÃO tocar** `sanitizarNext` — anti-open-redirect preservado exatamente.
- **NÃO tocar** o fluxo de erro OAuth / sem-code / erro-de-troca.

### Dependências Externas
Nenhuma nova. Next.js App Router (Route Handler `GET`), `@supabase/ssr` (`exchangeCodeForSession`) e vitest já no projeto.

### Estratégia de Teste (mock)
Estender a suíte existente. O teste importa `GET` de `./route`; para exercitar a decisão de identidade usar a **env real** via `vi.stubEnv("SAAS_ADMIN_USER_ID", ...)` (não precisa mockar `@/lib/auth/admin`, pois `ehAdminSaaS` é síncrono e `server-only` já está aliasado no `vitest.config.ts`):
- **Dono sem next:** `vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id)` (`"uid-test"`), `?code=abc` → `Location` = `${ORIGIN}/admin`.
- **Lojista sem next:** `vi.stubEnv("SAAS_ADMIN_USER_ID", "outro-uid")` (ou não stubar), `?code=abc` → `${ORIGIN}/painel` (sem regressão).
- **next explícito respeitado p/ dono:** env = `fakeUser.id`, `?code=abc&next=/vitrine` → `${ORIGIN}/vitrine` (next vence sobre `/admin`).
- **next explícito respeitado p/ lojista:** já coberto pelos testes atuais de `next` (mantidos verdes).
- **env ausente → /painel:** `vi.stubEnv("SAAS_ADMIN_USER_ID", undefined)` (ou `""`), user = `fakeUser` (que seria o dono), `?code=abc` → `${ORIGIN}/painel` sem lançar (login não quebra).
- **next malicioso `//evil.com`:** com env = `fakeUser.id`, `?code=abc&next=//evil.com` → cai na decisão padrão (`/admin` para o dono, ou `/painel` para lojista); `Location` nunca contém `evil.com`. (O teste atual de `//evil.com` assume `/painel`; ajustar a env desse caso para um id ≠ user, ou atualizar a expectativa conforme a env escolhida.)
- Adicionar `vi.unstubAllEnvs()` no `afterEach` e garantir env limpa por caso.

### Ordem de Implementação (crítica — TDD red-first)
1. **RED (`/tdd`):** escrever/estender os casos em `route.test.ts` (dono→`/admin`, lojista→`/painel`, next vence, env ausente→`/painel`, `//evil`→decisão padrão). Rodar e confirmar VERMELHO (o handler ainda manda tudo para `/painel`).
2. **GREEN (`/execute`):** aplicar a mudança de ~3 linhas no `route.ts`. Rodar a suíte → VERDE.
3. `next build` (constraint do handler: exporta só `GET` async — mandato "Export 'use server'"/route handler; garantir que build passa).
4. Revisar/auditar: confirmar `sanitizarNext` intacto e `data.user.id` como única fonte de identidade (nunca query param).
