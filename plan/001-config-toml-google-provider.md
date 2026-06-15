## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado:**

- `supabase/config.toml` (linhas 322–335) — bloco `[auth.external.apple]` com `enabled = false`, `secret = "env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)"`, `redirect_uri = ""`, `skip_nonce_check = false`. **Este é o template exato** a copiar para o Google (mesma estrutura de chaves, mesma substituição por `env(...)`). Não inventar formato novo.
- `supabase/config.toml` (linha 294) — `auth_token = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"` — confirma o padrão `env(...)` já em uso no projeto para todo secret. Reuso de padrão, não de código.
- `supabase/config.toml` (linha 159) — `site_url = "http://127.0.0.1:3000"` (http, dev local). A allow-list de redirect deriva de `site_url` + `additional_redirect_urls`.
- `src/app/(auth)/auth/callback/route.ts` — Route Handler que recebe o retorno do OAuth. Confirma que o path interno de callback é **`/auth/callback`** e que em dev o `origin` é `http://127.0.0.1:3000`. **Não tocado nesta issue** (é a issue 003).
- `src/lib/auth/` — só contém `reconciliarPosConfirmacao.ts`. O helper `googleOAuth.ts` **ainda não existe** e **não é criado aqui** (é a issue 002).

**O que precisa ser criado/modificado:** apenas edição de `supabase/config.toml` e `.env.example`. Nenhum arquivo `.ts` novo, nenhuma migration, nenhum componente.

**Inventário de reuso (lib/):** não se aplica — esta issue é puramente config de infra. Nenhuma query, validação zod, util ou componente envolvido. Sem risco de duplicar algo de `lib/`.

### Cenários

**Caminho Feliz (objetivo desta issue — habilitar o teste local):**
1. Operador define `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` em `.env.local`.
2. `npx supabase start` (ou `restart`) lê o novo bloco `[auth.external.google]` e resolve as env vars.
3. Com as issues 002/003 implementadas, clicar "Entrar com Google" redireciona ao consent do Google e volta por `http://127.0.0.1:3000/auth/callback` (agora na allow-list).

**Casos de Borda:**
- **Env var ausente em dev:** `npx supabase start` falha ou loga que não resolveu `env(...)`. Esperado — o secret é responsabilidade do operador (`.env.local`), nunca commitado. Documentado no checklist manual.
- **Callback fora da allow-list:** se `additional_redirect_urls` não contiver exatamente `http://127.0.0.1:3000/auth/callback`, o Supabase rejeita o redirect pós-auth. Por isso a entrada atual (`https://127.0.0.1:3000`, https e sem path) **não basta** e precisa ser corrigida.
- **`skip_nonce_check`:** o comentário oficial do template Apple diz "Required for local sign in with Google auth". Manter `false` no commit (alinhado ao default do Apple e ao princípio de não relaxar segurança sem necessidade comprovada). Se o sign-in local quebrar por nonce, alternar para `true` é a única mudança — deixar comentário no bloco indicando isso. (A issue 001 do `tasks/` sugere `true`; o spec diz "só se necessário". Decisão do plano: **`false` por padrão, com comentário documentando o trade-off**, seguindo o spec, que é a fonte mais recente.)
- **Domínio de produção desconhecido:** o repo não tem o domínio Vercel fixado em env/config. A URL de prod na allow-list fica como **placeholder comentado** + item no checklist manual (a allow-list de prod real é gerenciada no Dashboard do cloud, não no `config.toml` local).

**Tratamento de Erros:** não há código de runtime nesta issue. Erros de OAuth em runtime são tratados nas issues 002 (helper) e 003 (callback → `?erro=google`, log genérico no servidor, `seguranca.md` §14).

### Schema de Banco

Nenhum. Esta issue **não toca dados**: sem tabela, sem coluna, sem migration em `supabase/migrations/`, sem RLS, sem regeneração de `types/supabase.ts`. `config.toml` é configuração do Supabase local, não schema de banco.

### Validação (zod)

Não se aplica — sem formulário e sem Server Action nesta issue.

### Recálculo no Servidor

Não se aplica — sem valor monetário (preço/frete/desconto/cupom/total). Confirmado pelo spec.

### Regra cliente ↔ servidor (mapeamento de invariantes)

| Invariante | Camada que garante |
|-----------|--------------------|
| `client_id`/`secret` do Google nunca chegam ao client | **Config + Server (Supabase Auth):** `env(...)` em `config.toml`, sem prefixo `NEXT_PUBLIC_` (`seguranca.md` §7). O client só conhece `provider: "google"`. |
| Redirect pós-OAuth só para URLs confiáveis | **Server (Supabase Auth):** valida o `redirectTo` contra `site_url` + `additional_redirect_urls`. Esta issue garante que `…/auth/callback` esteja na lista. |
| Secret não vaza no diff/commit | **Processo:** `config.toml` usa só `env(...)`; nenhum `.env*` staged (`seguranca.md` §7). |

Não há regra de valor/permissão de loja nesta issue (sem RLS, sem `dono_id`, sem Server Action). Enforcement server-side da credencial = o próprio Supabase Auth lendo env var.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `supabase/config.toml`:
  - Adicionar bloco `[auth.external.google]` **logo abaixo** do bloco `[auth.external.apple]` (após a linha 335), copiando a estrutura do Apple:
    ```toml
    [auth.external.google]
    enabled = true
    client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
    # DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead:
    secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
    redirect_uri = ""
    url = ""
    # Set to true ONLY if local sign in with Google fails on nonce check.
    skip_nonce_check = false
    email_optional = false
    ```
  - Corrigir `additional_redirect_urls` (linha 163) de `["https://127.0.0.1:3000"]` para incluir o callback local correto (http + path) e o placeholder de prod:
    ```toml
    additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback", "https://<dominio-vercel>/auth/callback"]
    ```
- `.env.example`: documentar as duas novas env vars (SERVER-ONLY, sem `NEXT_PUBLIC_`, valores reais nunca commitados), seguindo o estilo dos comentários do Hotmart/Upstash já presentes.

**NÃO tocar:**
- `[auth.external.apple]` — permanece `enabled = false` (fora de escopo).
- `src/app/(auth)/auth/callback/route.ts` — issue 003.
- `src/lib/auth/googleOAuth.ts` (a criar) — issue 002.
- `.env.local` — valores reais; nunca commitar.
- `types/supabase.ts`, `supabase/migrations/` — não há mudança de schema.
- Dashboard do Supabase cloud — operação manual, não código (ver checklist).

### Dependências Externas

- **Google OAuth 2.0** (Google Cloud Console) — credenciais Web Application. Redirect URI do cloud: `https://gdlegxatwylhkjcrusyk.supabase.co/auth/v1/callback`.
- **Supabase CLI** — `npx supabase` (nunca pnpm/`supabase` global). Doc: https://supabase.com/docs/guides/local-development/configuring-config-toml e https://supabase.com/docs/guides/auth/social-login/auth-google
- Nenhum pacote npm novo.

### Ordem de Implementação

Issue **não crítica** (sem dinheiro/RLS/permissão) → sem fase RED obrigatória. Validação é por `grep` no diff (critérios de aceite), não por teste automatizado.

1. Editar `supabase/config.toml`: adicionar bloco `[auth.external.google]` abaixo do Apple.
2. Editar `supabase/config.toml`: corrigir `additional_redirect_urls`.
3. Editar `.env.example`: documentar as duas env vars.
4. Verificar critérios de aceite via `grep` (bloco com `enabled = true` e `env(...)`; allow-list com o callback local; nenhum literal de client_id/secret no diff; nenhum `.env*` staged).

### Prerequisitos manuais (operação — fora deste repo, não são código)

Sem estes passos o login com Google **não funciona em produção**:
1. **Google Cloud Console:** criar credenciais OAuth 2.0 (Client ID + Secret), tipo "Web application".
2. **Redirect URI no Google Cloud Console:** `https://gdlegxatwylhkjcrusyk.supabase.co/auth/v1/callback`.
3. **Supabase Dashboard → Authentication → Providers → Google:** habilitar e colar Client ID + Secret.
4. **Vercel + Supabase secrets:** setar `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (e em `.env.local` para dev).
5. **Supabase Dashboard → URL Configuration:** confirmar URL de produção (Vercel) + `…/auth/callback` na allow-list de redirect (a allow-list de prod é gerenciada no Dashboard, não no `config.toml` local).
