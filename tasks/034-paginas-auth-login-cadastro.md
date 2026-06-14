# [034] Páginas de auth: login e cadastro

**crítica:** NÃO
**Mundo:** auth
**Depende de:** 015, 016
**Spec:** specs/spec_irango_mvp.md (Cadastro, Login)

## Objetivo
Páginas `/login` e `/cadastro` com forms email/senha e botão Google OAuth, ligadas às Server Actions de auth.

## Escopo
- [ ] Criar `src/app/(auth)/login/page.tsx` (FormLogin + BotaoGoogle)
- [ ] Criar `src/app/(auth)/cadastro/page.tsx` (FormCadastro + BotaoGoogle)
- [ ] react-hook-form + zod (email, senha 8+) no client
- [ ] Submeter para `entrar`/`cadastrar` (015); toasts de sucesso/erro via sonner
- [ ] Cadastro bem-sucedido → `/painel/configuracoes/perfil` com toast "Loja criada! Configure seu perfil."
- [ ] BotaoGoogle → `signInWithOAuth({ provider: 'google' })`

## Fora de escopo
Server Actions e RN-01 (015). Guard/callback (016).

## Reuso esperado
- Actions `entrar`/`cadastrar` (015), schemas de auth, shadcn/ui `Form`/`Input`/`Button`, sonner

## Segurança
- Validação é só UX; a autoritativa está na action (seguranca.md §6)

## Critério de aceite
- [ ] Cadastro com email/senha cria conta + loja e redireciona ao perfil
- [ ] Login válido vai a `/painel`; inválido mostra "Email ou senha incorretos"
- [ ] Email duplicado mostra mensagem amigável
