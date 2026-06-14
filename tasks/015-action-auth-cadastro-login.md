# [015] Server Actions de auth (cadastro + criação de loja, login)

**crítica:** SIM (TDD red-first)
**Mundo:** auth
**Depende de:** 004, 019, 023
**Spec:** specs/spec_irango_mvp.md (Cadastro, Login, RN-01, RN-07)

## Objetivo
Server Actions de cadastro (signUp + criação automática da loja) e login, com validação zod no servidor e enforcement de "uma loja por dono".

## Escopo
- [ ] Criar `src/lib/actions/auth.ts` (`'use server'`)
- [ ] `cadastrar(email, senha, aceiteTermos)`: valida zod (email, senha 8+); `supabase.auth.signUp`; trata email duplicado ("Este email já está cadastrado")
- [ ] **DELTA LGPD** — cadastro exige aceite explícito (checkbox) de Termos de Uso + Política de Privacidade. Sem `aceiteTermos === true` → recusa server-side (não confiar no client; zod rejeita aceite ausente/falso). Ao criar a loja, gravar `consentimento_em = now()` e `consentimento_versao` (versão corrente dos termos — constante, ex.: `'2026-06-13'`). Páginas `/termos` e `/privacidade` e link no form: issue 062 (seguranca.md §20)
- [ ] Após signup: criar loja com `dono_id = auth.uid()`, `slug` sanitizado do email (parte antes do `@`, `[a-z0-9-]`), `nome` vazio
- [ ] **DELTA Hotmart** — ao criar a loja, definir trial (RN-A6): `assinatura_status` fica no default `'trial'` e gravar `assinatura_fim_periodo = now() + N dias` (N = 14, ver `modelo-negocio.md` §5). Demais campos `assinatura_*`/`hotmart_*` ficam null até o webhook. Disparar reconciliação de compra pré-cadastro (issue 059) por email igual.
- [ ] RN-01: antes de criar, `contarLojasDoDono` (023) > 0 → recusar
- [ ] Garantir slug único: se colidir, sufixar (ex: `-2`) até livre (usa `slugExiste` — 023)
- [ ] `entrar(email, senha)`: `signInWithPassword`; erro genérico "Email ou senha incorretos"
- [ ] Erros internos não vazam (seguranca.md §14)

## Fora de escopo
OAuth Google callback (route handler — 016 infra-auth), páginas de UI (034). Confirmação de email é config do painel Supabase (seguranca.md §17 — documentar, não codar).

## Reuso esperado
- `schema` de email/senha (validacoes); `contarLojasDoDono`, `slugExiste`, `sanitizarSlug` (023/019)
- `src/lib/supabase/server.ts`

## Segurança
- Validação zod no servidor além do client (seguranca.md §6)
- RN-01 forçado na action (RLS não conta linhas)
- Rate limit no login ~5/min por IP (seguranca.md §12)

## Critério de aceite
- [ ] (crítica) Teste vermelho: cadastro cria exatamente uma loja com slug derivado/único; segundo cadastro do mesmo dono não cria 2ª loja; senha < 8 chars rejeitada no servidor; email duplicado retorna mensagem amigável
- [ ] (crítica, DELTA LGPD) Teste vermelho: cadastro sem `aceiteTermos` (ausente ou `false`) é recusado no servidor e NÃO cria conta nem loja; cadastro com aceite grava `consentimento_em` (≈ now) e `consentimento_versao` na loja
