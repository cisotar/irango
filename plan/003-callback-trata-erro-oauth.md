## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:

- `src/app/(auth)/auth/callback/route.ts` — Route Handler `GET`. Já lê `searchParams`, já tem `sanitizarNext()` (anti open-redirect), já loga genérico via `console.error("[authCallback]", …)` e já redireciona. **Reuso total** — só se adiciona um bloco antes do check de `code` ausente. `sanitizarNext` permanece intacto (restrição da issue).
- `src/app/(auth)/login/page.tsx` — `'use client'`. Já tem o bloco visual de erro `role="alert"` (linhas 69-76): `<div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">⚠ {msg}</div>`. **Esse padrão é a fonte do alerta** — replicar para a mensagem do Google, sem reinventar estilo. Estado `erroCredencial` já existe e segue como está (não confundir os dois).
- `src/app/(auth)/cadastro/page.tsx` — `'use client'`. Hoje **não** tem bloco `role="alert"` (só usa `toast`). Vai ganhar o mesmo bloco visual replicado de `/login`.
- `src/lib/auth/googleOAuth.ts` — helper compartilhado `entrarComGoogle()` (já extraído na issue 002). Não muda nesta issue, mas é o ponto que inicia o fluxo que termina no callback.
- Tokens Tailwind (`destructive`, `texto-muted`, `primaria`) e componentes shadcn (`Card`, `Button`, etc.) — reuso, sem componente novo.

O que precisa ser criado: **nada de lib/util novo.** Não há máscara, validação, query Supabase nem regra de valor. A mudança é (1) roteamento de erro no Route Handler e (2) leitura de um query param + render condicional de um alerta nas duas páginas.

### Decisão de arquitetura — como ler `?erro=google` no cliente

`/login` e `/cadastro` são `'use client'`. No Next.js 16 (App Router), ler query param dentro de um Client Component exige `useSearchParams()`, que **obriga um boundary `<Suspense>`** no componente que o usa — sem ele o `next build` falha com erro de prerender (`useSearchParams() should be wrapped in a suspense boundary`). Não existe nenhum uso atual de `useSearchParams`/`Suspense` no `src/` (grep confirmou), então não há padrão estabelecido a seguir.

**Escolha (menor atrito, sem gotcha de build): Server Component wrapper passando prop.**

- Renomear a lógica de cada página para um componente cliente (ex.: `LoginForm` / `CadastroForm`) — pode ficar no mesmo arquivo ou em arquivo irmão.
- O `page.tsx` vira um Server Component `async` que lê `searchParams` (prop nativa da page, em Next 16 é `Promise<{...}>` — usar `await`) e passa `erroOAuth={params.erro === "google"}` (boolean) para o componente cliente.
- O componente cliente recebe a prop e renderiza o alerta condicionalmente. Sem `useSearchParams`, sem `<Suspense>`, sem novo bundle de runtime.

Alternativa rejeitada: `useSearchParams` + `<Suspense>` em cada página — funciona, mas adiciona boundary e mantém a página inteira como client só para ler um param que o servidor já tem. O wrapper server-side é mais idiomático no App Router e evita o erro de prerender.

> Observação para o `executar`: como hoje o arquivo inteiro é `'use client'` com `export default function LoginPage()`, o caminho mais limpo é extrair o corpo para `LoginForm` (client) e deixar `page.tsx` como server wrapper. Manter o texto/markup idêntico — só muda quem lê o param.

### Cenários

**Caminho Feliz (callback OK):** usuário autentica no Google → Supabase redireciona para `/auth/callback?code=…` → não há `error` → segue o fluxo atual: `exchangeCodeForSession` + `reconciliarPosConfirmacao` (best-effort) + redirect para `next ?? /painel`. **Inalterado.**

**Caminho de erro de OAuth:** Supabase redireciona para `/auth/callback?error=access_denied&error_description=…` (consent negado, provider desabilitado, provider caído) → o novo bloco detecta `error` **antes** de qualquer `exchangeCodeForSession` → `console.error("[authCallback] oauth", error)` (só o `error`, nunca `error_description` cru — §14/§21) → redireciona `${origin}/login?erro=google` → `/login` lê o param e mostra "Não foi possível entrar com o Google. Tente novamente ou use email e senha."

**Casos de Borda:**
- `?error=` presente **e** `?code=` presente (raro): `error` tem precedência — o bloco roda primeiro e nunca tenta a troca de código. Correto.
- Sem `code` e sem `error`: mantém `/login?erro=auth` (genérico) — comportamento atual preservado.
- `exchangeCodeForSession` falha mesmo com `code` válido: mantém o `console.error("[authCallback]", error)` + `/login?erro=auth` atual — não é erro de OAuth, é erro de troca; não vira `erro=google`.
- Página acessada sem nenhum param (`/login` direto): `erroOAuth = false`, nenhum alerta. Sem regressão.
- Param com valor inesperado (`/login?erro=qualquercoisa`): só `erro=google` dispara o alerta do Google; `erro=auth` continua governado pelo fluxo de credencial existente (não faz parte desta issue criar alerta para `auth` se ainda não existir — verificar no `executar` se `/login` já trata `erro=auth`; se não tratar, está fora de escopo).
- Falha de rede no próprio redirect: fora do controle do app (é navegação do browser).

**Tratamento de Erros:** usuário vê só a mensagem amigável fixa; o detalhe (`error` string do Supabase) fica em `console.error` no servidor, sem `error_description` e sem PII (§14/§21). Nenhum JSON bruto chega ao usuário — o objetivo central da issue.

### Schema de Banco

**Nenhuma mudança.** Sem tabela, sem coluna, sem migration, sem RLS. (Confirmado na spec §"Modelos de Dados".) O único arquivo de config tocável seria `supabase/config.toml` (bloco `[auth.external.google]`), mas isso é prerequisito/escopo da issue 001 — **não desta issue**.

### Validação (zod)

Não se aplica. Não há formulário novo nem payload de Server Action nesta mudança. O param `?erro=google` é lido como string literal e comparado (`=== "google"`) — não justifica schema zod.

### Recálculo no Servidor

Não se aplica. **Nenhum valor monetário, cupom, frete ou total.** Issue puramente de roteamento de erro de auth + UX.

### Mapa cliente ↔ servidor (regra obrigatória)

| Invariante | Camada que garante |
|-----------|--------------------|
| Decidir que houve erro de OAuth e para onde redirecionar | **Server** (Route Handler `auth/callback/route.ts`) — o cliente nunca decide isso |
| Não vazar `error_description`/JSON bruto ao usuário | **Server** (loga genérico, redireciona com param genérico `erro=google`) |
| Exibir a mensagem amigável | **Cliente** (UX) — lê o param já sanitizado pelo servidor; é só apresentação, sem decisão de segurança |
| Anti open-redirect no `next` | **Server** (`sanitizarNext`, preservado) |

Não há regra de valor/permissão — logo não há RLS nem Server Action de valor a planejar. O enforcement relevante (não expor erro bruto) está 100% no servidor.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/app/(auth)/auth/callback/route.ts` — adicionar, logo após `const next = …` e **antes** do `if (!code)`:
  ```ts
  const erroOAuth = searchParams.get("error");
  if (erroOAuth) {
    console.error("[authCallback] oauth", erroOAuth); // sem error_description (§14/§21)
    return NextResponse.redirect(`${origin}/login?erro=google`);
  }
  ```
  Nada mais muda. `sanitizarNext` intacto.
- `src/app/(auth)/login/page.tsx` — extrair corpo para componente cliente `LoginForm`; `page.tsx` vira Server Component `async` que lê `searchParams`, passa `erroOAuth: boolean`. Replicar o bloco `role="alert"` para a mensagem do Google quando `erroOAuth`.
- `src/app/(auth)/cadastro/page.tsx` — mesmo padrão: server wrapper + `CadastroForm` cliente + bloco `role="alert"` (novo aqui) com a mesma mensagem.

**NÃO tocar:**
- `src/lib/auth/googleOAuth.ts` — helper já correto; mexer reabriria o drift que a issue 002 fechou.
- `src/app/(auth)/layout.tsx` — não precisa.
- `components/ui/*` (shadcn) — nunca editar à mão.
- `supabase/config.toml`, qualquer migration, `types/supabase.ts` — fora do escopo (issue 001 / nenhuma mudança de schema).

### Dependências Externas

Nenhuma nova. Tudo já no `package.json`: Next 16.2.9 (App Router, `searchParams` como `Promise`), React, shadcn/ui, sonner. Docs de referência: Next.js App Router — `searchParams` em Page (Server Component) e a regra do `useSearchParams`/`Suspense` (motivo da decisão de arquitetura acima).

### Ordem de Implementação

Issue **NÃO crítica** (sem dinheiro/RLS/permissão) → não exige TDD red-first; testes automatizados são a issue 004 (fora de escopo).

1. **Callback primeiro** (`route.ts`) — é a origem do `?erro=google`; sem ele as páginas não teriam o que ler. Mudança mínima e isolada.
2. **`/login`** — refator para server wrapper + `LoginForm` + alerta. É a fonte do bloco `role="alert"` a replicar.
3. **`/cadastro`** — replicar o mesmo padrão de `/login`.
4. **Verificação manual** (`/verificar`): acessar `/login?erro=google` e `/cadastro?erro=google` e confirmar o alerta; simular `?error=access_denied` no callback e confirmar redirect para `/login?erro=google` sem tentar a troca de código; confirmar que `code` válido e o caso sem-`code`-sem-`error` seguem inalterados; rodar `next build` para garantir que o refator server/client não quebrou o prerender.
