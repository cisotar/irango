# Spec: Bugfix — "Entrar com Google" retorna 400 "Unsupported provider"

**Versão:** 0.1.0 | **Atualizado:** 2026-06-15

## Visão Geral

Ao clicar em "Entrar com Google" em `/cadastro` ou `/login`, o browser navega para o endpoint Supabase Auth e recebe um **400 JSON bruto**:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

O usuário fica preso numa página técnica do Supabase, sem caminho de volta. O `if (error)` no JS do client nunca executa, porque `signInWithOAuth` faz o browser **navegar** para a URL do Supabase antes de qualquer tratamento — o 400 acontece no servidor do Supabase, fora do alcance do `try/catch` do client.

**Causa raiz (três camadas):**

1. **Produção/cloud:** o provedor Google não está habilitado no projeto Supabase cloud (`gdlegxatwylhkjcrusyk`). Habilitar é **ação manual** no Dashboard — não há fix de código que o resolva.
2. **Dev local:** `supabase/config.toml` não tem bloco `[auth.external.google]` → o fluxo OAuth também quebra localmente, impedindo teste.
3. **UX/resiliência:** quando o Supabase rejeita o provider, redireciona com `?error=` (ou retorna JSON), e o callback `auth/callback/route.ts` só trata o caso `code` ausente — não trata `error`/`error_description`. Mesmo após habilitar o Google, qualquer falha futura de OAuth (consent negado, provider caído) mostraria JSON bruto.

**Mundo:** auth (`/login`, `/cadastro`, `/auth/callback`). Não toca vitrine pública nem painel.

**Criticidade:** NÃO crítica — não envolve valor monetário, RLS, permissão de loja nem dado sensível de outra loja. É configuração de autenticação + resiliência de UX. (Segue valendo a regra geral: secret OAuth nunca no client — ver Segurança.)

## Atores Envolvidos

- **iRango (SaaS / operador):** executa os prerequisitos manuais (habilitar Google no Dashboard Supabase, criar credenciais no Google Cloud Console, configurar redirect URI, setar env vars no Vercel). Sem isso, nenhum fix de código faz o login com Google funcionar em produção.
- **Lojista (novo ou existente):** clica "Entrar com Google" em `/cadastro` ou `/login` e espera ou autenticar, ou voltar para uma tela amigável de erro — nunca JSON bruto.
- **Cliente final:** não afetado (vitrine não tem login).

## Páginas e Rotas

### Login — `/login`
**Mundo:** auth
**Descrição:** o lojista entra com email/senha ou com Google. O botão "Entrar com Google" hoje chama uma cópia local de `entrarComGoogle()`.

**Componentes:** (reuso — nenhum componente novo)
- `Card`, `Button`, `Input`, `Label`, `Separator` (shadcn/ui) — já em uso
- `toast` (sonner) — já em uso para erro

**Behaviors:**
- [ ] Clicar "Entrar com Google" — dispara `entrarComGoogle()` importado do helper compartilhado `src/lib/auth/googleOAuth.ts` (não mais função inline duplicada). Garantido em: cliente (UX) — apenas inicia o redirect; a autenticação real é do Supabase + callback no servidor.
- [ ] Voltar do OAuth com erro — se o callback redirecionar para `/login?erro=google`, exibir mensagem amigável ("Não foi possível entrar com o Google. Tente novamente ou use email e senha."). Garantido em: cliente (UX) lê o query param; a decisão de redirecionar é do servidor (callback route).

---

### Cadastro — `/cadastro`
**Mundo:** auth
**Descrição:** o novo lojista cria conta com email/senha+aceite de termos, ou com Google. Contém hoje uma **segunda cópia idêntica** de `entrarComGoogle()` (drift garantido se uma for alterada).

**Componentes:** (reuso — nenhum componente novo)
- `Card`, `Button`, `Input`, `Label`, `Checkbox`, `Separator` (shadcn/ui) — já em uso

**Behaviors:**
- [ ] Clicar "Entrar com Google" — dispara o **mesmo** `entrarComGoogle()` do helper compartilhado (elimina a duplicata). Garantido em: cliente (UX).
- [ ] Voltar do OAuth com erro — mesmo tratamento de `/login?erro=google` (mensagem amigável). Garantido em: cliente (UX) lê o param; servidor decide o redirect.

> Nota: o cadastro via Google **não** passa pela Server Action `cadastrar`. A criação da loja para usuários OAuth ocorre no callback via auto-cura `garantir_loja_do_dono` / guard do painel (ver `seguranca.md` §17). Esta spec não altera esse fluxo — apenas garante que o callback não quebre antes de chegar lá.

---

### Callback OAuth — `/auth/callback`
**Mundo:** auth (Route Handler server-side)
**Descrição:** troca o `code` por sessão e redireciona. Hoje trata só `code` ausente; precisa tratar o caso de o Supabase redirecionar com `error`/`error_description`.

**Componentes:** Route Handler (`route.ts`) — sem UI.

**Behaviors:**
- [ ] Receber `?error=` do Supabase — detectar `error`/`error_description` nos query params **antes** de tentar `exchangeCodeForSession`; logar genérico no servidor (`console.error`, sem PII — `seguranca.md` §14/§21) e redirecionar para `/login?erro=google`. Garantido em: Server (Route Handler). Não é valor/permissão — é roteamento de erro de auth.
- [ ] Receber `code` válido — comportamento atual mantido (troca por sessão, reconcilia assinatura best-effort via `reconciliarPosConfirmacao`, redireciona para `next ?? /painel`). Garantido em: Server (cookies HttpOnly setados pelo `@supabase/ssr`).
- [ ] Receber sem `code` e sem `error` — comportamento atual mantido (`/login?erro=auth`). Garantido em: Server.

## Modelos de Dados

**Nenhuma mudança de schema.** Nenhuma tabela nova, nenhuma coluna nova, nenhuma migration de banco, nenhuma política RLS nova.

O único arquivo "de schema/config" tocado é `supabase/config.toml` (config do Supabase **local**, não migration de banco):

- Adicionar bloco `[auth.external.google]`:
  ```toml
  [auth.external.google]
  enabled = true
  client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
  secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
  # skip_nonce_check = true só se necessário para sign-in local com Google
  ```
  Segue o padrão já presente em `[auth.external.apple]` (substituição por env var, nunca secret literal).
- Atualizar `additional_redirect_urls` em `[auth]` para incluir a URL de produção (Vercel) e o callback local, ex.:
  ```toml
  additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback", "https://<dominio-vercel>/auth/callback"]
  ```

Tipos gerados (`types/supabase.ts`) não mudam.

## Regras de Negócio

| Regra | Camada onde é garantida |
|-------|------------------------|
| O secret OAuth do Google **nunca** chega ao client. `client_id`/`secret` resolvidos por env var no servidor do Supabase; o client só conhece `provider: "google"` e o `redirectTo`. | Server (Supabase Auth) + config (env var, sem `NEXT_PUBLIC_`) |
| `entrarComGoogle()` existe em **um único lugar** (`src/lib/auth/googleOAuth.ts`), importado por login e cadastro — sem drift. | Cliente (helper compartilhado) |
| Erro de OAuth nunca expõe JSON bruto ao usuário — sempre cai em tela amigável. | Server (callback redireciona) + Cliente (lê `?erro=google`) |
| `redirectTo` do `signInWithOAuth` deve apontar para um path interno (`${window.location.origin}/auth/callback`). O Supabase só redireciona para URLs na allow-list (`site_url` + `additional_redirect_urls`). | Cliente (monta a URL) + Supabase (valida contra allow-list) |
| Anti open-redirect no `next` do callback (`sanitizarNext`) — comportamento atual preservado. | Server (Route Handler) |

Não há recálculo de valor monetário envolvido — esta feature não toca dinheiro, cupom, frete nem pedido.

## Segurança (obrigatório)

- **Dado sensível entra/sai?** O secret do Google OAuth (`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`). Fica **só no servidor** — em `config.toml` como referência `env(...)` (nunca literal), e nos valores reais em `.env.local` (dev) / Dashboard Vercel + Supabase (prod). Nenhum prefixo `NEXT_PUBLIC_` (`seguranca.md` §7). PII de usuário (email do Google) é tratada pelo Supabase Auth; logs do callback usam mensagem genérica sem PII (`seguranca.md` §14/§21).
- **Algum valor monetário?** Não. Nenhum recálculo de servidor necessário.
- **Tabela nova?** Não. Nenhuma política RLS nova.
- **API externa com key?** Sim — Google OAuth. A credencial vive no Supabase Auth (servidor), nunca no client. O client só inicia o fluxo com `provider: "google"`. Conforme `seguranca.md` §9 (toda chamada com key passa pelo servidor) e `architecture.md` §5 (Auth = Supabase, email/senha + Google OAuth).
- **Não commitar secret:** `config.toml` usa `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` / `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`. Verificar checklist de commit (`seguranca.md` §7): nenhum `.env*` staged, nenhuma key hardcoded.
- **Mensagem genérica no erro:** o callback loga detalhe no servidor e redireciona com `?erro=google` — não vaza `error_description` do provider para a URL final do usuário.

## Prerequisitos manuais (NÃO são código — documentar e executar fora do repo)

Sem estes passos, o fix de código **não** faz o login com Google funcionar em produção. Devem constar na issue como checklist de operação:

1. **Google Cloud Console:** criar projeto/credenciais OAuth 2.0 (Client ID + Client Secret), tipo "Web application".
2. **Redirect URI no Google Cloud Console:** adicionar `https://gdlegxatwylhkjcrusyk.supabase.co/auth/v1/callback`.
3. **Supabase Dashboard → Authentication → Providers → Google:** habilitar o provider e colar Client ID + Secret.
4. **Vercel → Environment Variables / Supabase secrets:** setar `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (e em `.env.local` para dev).
5. **Supabase Dashboard → URL Configuration:** confirmar que a URL de produção (Vercel) e `…/auth/callback` estão na allow-list de redirect.

## Fora do Escopo (v1)

- Outros provedores OAuth (Apple, GitHub, Facebook etc.) — Apple já está como `enabled = false` no config; não habilitar nesta issue.
- Mudança no fluxo de criação de loja para usuários OAuth — a auto-cura (`garantir_loja_do_dono` / guard do painel, `seguranca.md` §17) já cobre isso; não alterar aqui.
- Vínculo/linking de conta email+senha com a mesma identidade Google (`enable_manual_linking` permanece `false`).
- Tela de erro dedicada (`/erro-auth`) — reusar o param `?erro=google` nas telas existentes; página própria é refinamento futuro.
- Captcha em auth (`[auth.captcha]`) — fora do escopo deste bugfix.
- Rate limiting específico para OAuth — Supabase Auth já tem `sign_in_sign_ups` no `config.toml`; não adicionar camada própria aqui (não é Server Action do iRango).
