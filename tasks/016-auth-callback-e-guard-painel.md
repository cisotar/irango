# [016] Callback OAuth + guard de auth do painel

**crítica:** SIM (TDD red-first)
**Mundo:** auth
**Depende de:** 015
**Spec:** specs/spec_irango_mvp.md (Cadastro, Login, Dashboard — guard duplo)

## Objetivo
Route handler `/auth/callback` (padrão `@supabase/ssr`) e guard server-side do painel (`layout.tsx`) que redireciona para `/login` sem sessão e bloqueia lojista com assinatura não-ativa fora da carência. Ajustar `middleware.ts` para redirecionar autenticados de `/`, `/login`, `/cadastro` → `/painel`.

## Escopo
- [ ] Criar `src/app/(auth)/auth/callback/route.ts` — troca code por sessão e redireciona
- [ ] Criar `src/app/(painel)/painel/layout.tsx` — `getUser()` server-side; sem sessão → `redirect('/login')`
- [ ] Ajustar `src/middleware.ts`: usuário autenticado em `/`, `/login`, `/cadastro` → `/painel`; rota de painel sem sessão → `/login`
- [ ] (opcional, seguranca.md §17) checar `email_confirmed_at` no guard
- [ ] **DELTA Hotmart** — guard lê `assinatura_status` + `assinatura_fim_periodo` da loja do lojista e decide acesso via util pura `assinaturaPermiteAcesso` (issue 056, RN-A4): `ativa` ou `trial` válido → libera; `inadimplente`/`cancelada` dentro da carência (`now() <= assinatura_fim_periodo`) → libera com banner de aviso; `suspensa` (imediato), ou `inadimplente`/`cancelada`/`trial` fora da carência → `redirect('/painel/assinatura-bloqueada')`. **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO** (Adendo "Ajuste — Guard do Painel")
- [ ] **DELTA Hotmart** — exceção de rota: `/painel/configuracoes/assinatura` e `/painel/assinatura-bloqueada` permanecem acessíveis mesmo com assinatura inválida (lojista precisa poder reativar)

## Fora de escopo
Server Actions de auth (015). UI das páginas (034).

## Reuso esperado
- `src/lib/supabase/{server,middleware}.ts` (já existem)
- `@supabase/ssr` (padrão oficial)
- **DELTA Hotmart** — `assinaturaPermiteAcesso` (056) — reusar, não recriar a regra de carência no guard

## Segurança
- Guard duplo: middleware + layout server-side (seguranca.md §4) — defesa em profundidade
- Vitrine pública não passa pelo guard
- **DELTA Hotmart** — decisão de bloqueio sempre server-side; nunca confiar em flag de client (RN-A4)

## Critério de aceite
- [ ] (crítica) Teste/verificação: acesso a `/painel` sem sessão redireciona a `/login`; usuário logado em `/login` vai a `/painel`; callback estabelece sessão
- [ ] (crítica, DELTA Hotmart) Teste vermelho: loja `ativa` acessa `/painel`; `trial` válido acessa; `inadimplente` dentro da carência acessa (com banner); `suspensa` → redirect `/painel/assinatura-bloqueada`; `cancelada` fora da carência → redirect; `trial` expirado → redirect; `/painel/configuracoes/assinatura` e `/painel/assinatura-bloqueada` seguem acessíveis com assinatura inválida
