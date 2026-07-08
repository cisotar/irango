# [141] Teste estrutural anti-loop (filesystem, padrão cve-guard)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** —
**Spec:** specs/desacoplar-authz-assinatura-route-group.md

## Objetivo
Travar por filesystem a invariante RN-03: as telas isentas do paywall
(`assinatura-bloqueada/page.tsx`, `configuracoes/assinatura/page.tsx`) **nunca**
podem ficar sob o route group `(bloqueavel)/`, senão o gate as bloquearia e viraria
deadlock. Guard-test no padrão `middleware.cve-guard.test.ts` (trava de regressão).

## Escopo
- [ ] Novo teste (ex.: `src/app/(painel)/painel/route-group.guard.test.ts`) que percorre o
  filesystem e **falha** se `assinatura-bloqueada/page.tsx` OU `configuracoes/assinatura/page.tsx`
  estiverem em qualquer caminho contendo `(bloqueavel)`.
- [ ] O teste também documenta (comentário) por que a isenção é posicional e não por string.
- [ ] Pode ir cedo: hoje passa trivialmente (não existe `(bloqueavel)` ainda) — é a armadilha
  que trava a regressão quando a [142] criar o grupo e mover as páginas.

## Fora de escopo
- Criar o route group ou mover páginas (é a [142]).
- Testar redirect de layout (unitário/integração fica na [142]).
- Verificar posição das páginas *gated* (o teste foca só nas duas isentas — a garantia positiva
  do grupo é coberta pelos testes de comportamento da [142]).

## Reuso esperado
- Padrão de `src/middleware.cve-guard.test.ts` (`readFileSync`/`node:fs`, guard estrutural).
- `node:path` / `glob` já disponíveis no toolchain de teste.

## Segurança
- É o coração da correção: garante que a isenção do paywall seja por **posição na árvore**,
  imune a header forjado. Sem esta trava, um refactor futuro poderia reintroduzir o deadlock
  ou (pior) mover a tela de assinatura para dentro do gate.

## Critério de aceite
- [ ] Teste presente e verde no estado atual (trap).
- [ ] Simular a regressão (mover mentalmente/temporariamente uma das telas para sob `(bloqueavel)`)
  torna o teste vermelho — confirmado ao menos com um caso sintético no PR.
- [ ] `npx vitest run` inclui o novo guard e passa.
