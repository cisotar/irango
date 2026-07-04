# [148] Decisão de redirect pós-login: dono do SaaS → `/admin`

**crítica:** SIM (TDD red-first)
**Mundo:** auth
**Depende de:** 147
**Spec:** specs/hub-selecao-admin-saas.md

## Objetivo
Ajustar `src/app/(auth)/auth/callback/route.ts` para que, após trocar `code` por sessão, o destino padrão do dono do SaaS seja `/admin` (o hub) em vez de `/painel`. Lojista comum e `next` explícito permanecem inalterados.

## Escopo
- [ ] Substituir o destino padrão fixo `next ?? "/painel"` pela decisão:
  1. `next` explícito e sanitizado presente → respeitá-lo (prioridade máxima, inalterado).
  2. Senão, se `ehAdminSaaS(data.user.id)` → `/admin`.
  3. Senão → `/painel`.
- [ ] Usar `data.user.id` do `exchangeCodeForSession` (já autoritativo) — não fazer novo `getUser()`.
- [ ] Consumir `ehAdminSaaS()` da issue 147; não ler `SAAS_ADMIN_USER_ID` diretamente no route handler.
- [ ] Preservar `sanitizarNext` exatamente como está (só path interno; rejeita `//` e não-`/`).
- [ ] Manter a chamada `reconciliarPosConfirmacao(data.user)` e o tratamento de erro OAuth existentes.

## Fora de escopo
- Criar a page `/admin` (issue 149) — o redirect pode apontar para `/admin` mesmo antes dela existir; o guard reavalia a autoridade lá.
- Alterar `sanitizarNext` ou o fluxo de erro de login.
- Múltiplos admins / RBAC.

## Reuso esperado
- `src/lib/auth/admin.ts` — `ehAdminSaaS()` (issue 147).
- `sanitizarNext` (já no próprio arquivo) — reusar, não reescrever.

## Segurança
- Decisão 100% no servidor (Route Handler); cliente recebe redirect já decidido.
- Destinos padrão (`/admin`, `/painel`) são literais internos fixos, não derivados de input.
- **Fail-safe:** env ausente → `ehAdminSaaS` retorna `false` → cai em `/painel`; login de ninguém quebra.
- Anti-open-redirect intacto: só o `next` explícito passa por `sanitizarNext`; os literais não.
- O redirect não concede autoridade — a autoridade de `/admin` é reavaliada pelo guard fail-closed (issue 149).
- Nenhuma tabela tocada → nenhuma RLS.

## Critério de aceite
- [ ] Login do dono (sem `next`) → `/admin`.
- [ ] Login de lojista comum (sem `next`) → `/painel` (sem regressão).
- [ ] Login com `next` interno válido → respeita o `next` para qualquer usuário.
- [ ] `next` malicioso (`//evil`, `http://...`) → rejeitado, cai no destino padrão por identidade.
- [ ] `SAAS_ADMIN_USER_ID` ausente/vazia → login não quebra, cai em `/painel`.
- [ ] `next build` roda sem erro (route handler exporta só `GET` async).
- [ ] (crítica) teste vermelho escrito antes da implementação, depois verde.
