# [143] Middleware: remover `x-pathname` e corrigir comentário falso

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [142]
**Spec:** specs/desacoplar-authz-assinatura-route-group.md

## Objetivo
Remover de `src/lib/supabase/middleware.ts` a linha
`request.headers.set("x-pathname", request.nextUrl.pathname)` (já sem consumidor
após a [142]) e corrigir o comentário `:5-7` que a descreve. `updateSession` fica
só como refresh de cookie/sessão via `getUser`.

## Escopo
- [ ] Remover a chamada `request.headers.set("x-pathname", ...)`.
- [ ] Corrigir/remover o comentário aditivo (issue 016) que justificava o header.
- [ ] Garantir que `updateSession` permanece só refresh de sessão (nenhum `NextResponse.redirect`
  de authz introduzido; nenhuma dependência de `x-middleware-subrequest`).

## Fora de escopo
- Tocar `src/middleware.ts`, `manifest.webmanifest/route.ts` ou `NavPainel.tsx`.
- Mover qualquer autorização para o middleware (proibido — RN-05).

## Reuso esperado
- `src/middleware.cve-guard.test.ts` — já existente, trava authz-no-middleware; deve seguir verde.
- Nada novo de UI/lib.

## Segurança
- Elimina a última entrada de transporte que alimentava authz. A verdade da autorização deixa
  de ter qualquer input controlável pelo cliente.
- `cve-guard` garante que a remoção não abriu espaço para redirect de authz no middleware.

## Critério de aceite
- [ ] (RED-first) Teste/asserção `grep -rn "x-pathname" src/` → **zero** ocorrências (pode ser
  amarrado a um guard ou verificado no PR); vermelho antes da remoção, verde depois.
- [ ] `npx vitest run src/middleware.cve-guard.test.ts` → verde.
- [ ] Refresh de sessão/cookie continua funcionando (login/painel navegam normalmente).
