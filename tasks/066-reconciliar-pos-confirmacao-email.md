# 066 — Mover reconciliação de assinatura para o callback de confirmação de email

crítica: SIM

## Contexto

A issue 059 reconcilia assinaturas órfãs da Hotmart (eventos `loja_id NULL`)
no momento do cadastro (`src/lib/actions/auth.ts`). A auditoria encontrou um
vetor de roubo (FIX 2 ALTA): a reconciliação rodava ANTES da confirmação de
email, então um atacante podia cadastrar com o email EXATO da vítima e herdar
a assinatura órfã dela sem provar posse do email.

O **gate mínimo** já aplicado (FIX 2): só reconcilia se
`data.user.email_confirmed_at` estiver setado. Com "Confirm email" ON no painel
Supabase (seguranca.md §17), `email_confirmed_at` é `null` no cadastro — ou seja,
**a reconciliação efetivamente nunca roda no fluxo atual**. Isso fecha o vetor de
roubo, mas deixa a feature 059 sem gatilho real: o comprador legítimo confirma o
email e a assinatura órfã NUNCA é vinculada.

## Objetivo

Mover a reconciliação para o **gatilho de confirmação de email**, resolvendo a
ALTA na raiz (posse comprovada) E restaurando a feature para o comprador legítimo.

## Plano Técnico (a detalhar em `/plan`)

- Implementar o callback de confirmação de email (route handler de auth callback
  do Supabase `@supabase/ssr`, padrão `exchangeCodeForSession`).
- Após a sessão confirmada, com o `user.email_confirmed_at` agora setado e o
  email AUTENTICADO em mãos (RN-A1, não-forjável), chamar
  `reconciliarAssinatura(svc, emailAutenticado, lojaDoDono.id)` via service_role.
- Resolver a loja do dono pelo `user.id` (não pelo email do payload).
- Best-effort: falha de reconciliação não derruba a confirmação.
- Remover o gate condicional de `auth.ts` (`if email_confirmed_at`) quando o
  callback assumir o gatilho — ou mantê-lo como defesa-em-profundidade (decisão
  do plano).
- Idempotência: reconciliação já é idempotente (2ª chamada acha 0 órfãos). O
  callback pode rodar mais de uma vez (re-login pós-confirmação) sem efeito duplo.

## Critérios de aceite (TDD red-first — crítica)

- Comprador legítimo: compra na Hotmart → cadastra → confirma email → assinatura
  vinculada à loja dele e eventos saem de órfãos.
- Atacante com email da vítima sem confirmar: nunca dispara reconciliação.
- Reconciliação roda com o email AUTENTICADO da sessão, nunca de input do cliente.

## Dependências

- 059 (reconciliação) — implementada, com gate mínimo (FIX 2).
- Fluxo de confirmação de email do Supabase Auth.
