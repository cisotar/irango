# [140] Split das funções puras: `decidirAcessoBase` + `decidirAssinatura`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** —
**Spec:** specs/desacoplar-authz-assinatura-route-group.md

## Objetivo
Extrair de `decidirAcessoPainel` duas funções puras independentes em
`acessoPainel.ts`: `decidirAcessoBase` (sessão/email/loja, sem rota, sem
assinatura) e `decidirAssinatura` (só assinatura, loja NON-NULL, sem rota,
sem `headers()`), preparando o desacoplamento da árvore de rotas.

## Escopo
- [ ] `decidirAcessoBase(user, loja): "ok" | "login" | "confirmar-email" | "onboarding"`
  — precedência fixa: user null → `login`; sem `email_confirmed_at` → `confirmar-email`;
  loja null → `onboarding`; senão `ok`.
- [ ] `decidirAssinatura(loja: LojaCompleta, agora: Date): "ok" | "assinatura-bloqueada"`
  — `assinaturaLibera(loja, agora) ? "ok" : "assinatura-bloqueada"`. Sem parâmetro `rota`.
- [ ] Manter `assinaturaLibera` (helper interno fail-closed) como está — `decidirAssinatura`
  o reusa; não recriar a regra de carência.
- [ ] Reescrever `acessoPainel.test.ts` para cobrir as DUAS funções puras (todos os ramos
  de precedência + fail-closed de assinatura: status fora do union, `fim` null, `suspensa`,
  carência inclusiva).
- [ ] Manter `decidirAcessoPainel` temporariamente, recomposto sobre as duas novas funções
  (comportamento idêntico), para não quebrar o consumidor `painel/layout.tsx` neste passo.

## Fora de escopo
- **Deletar** `decidirAcessoPainel` e `ROTAS_EXCECAO_ASSINATURA` — acontece na [142], quando
  o último consumidor (layout pai) migra. Deletar antes quebraria o build (`use-server`/import).
- Qualquer edição de layout, criação de route group ou mudança no middleware.
- Tocar `assinatura.ts` / `assinaturaPermiteAcesso`.

## Reuso esperado
- `assinaturaLibera` interno + `assinaturaPermiteAcesso` (`@/lib/utils/assinatura.ts`) — reuso,
  não recriar a carência.
- Tipos `User` (@supabase/supabase-js) e `LojaCompleta` (`@/lib/supabase/queries/lojas`).

## Segurança
- Ambas as funções permanecem **puras**: sem I/O, sem `Date.now()` (`agora` injetado),
  **sem `headers()`** (restrição dura RN-06). `decidirAssinatura` não recebe input de transporte.
- Postura fail-closed preservada: dúvida sobre assinatura → bloqueia.
- Nenhuma tabela/RLS tocada (refator de função pura).

## Critério de aceite
- [ ] (RED-first) Testes das duas funções escritos e vermelhos antes da implementação, depois verdes.
- [ ] `npx vitest run src/lib/utils/acessoPainel.test.ts` → verde.
- [ ] `decidirAssinatura` tem assinatura `(loja, agora)` — sem `rota`, sem `headers()`.
- [ ] `decidirAcessoPainel` continua verde (recomposto) e o build não quebra.
