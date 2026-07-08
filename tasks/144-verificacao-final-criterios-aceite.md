# [144] Verificação final + fechamento dos critérios de aceite

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [142], [143]
**Spec:** specs/desacoplar-authz-assinatura-route-group.md

## Objetivo
Amarrar a correção de ponta a ponta: confirmar que todos os critérios de aceite do
spec passam e que o comportamento observável do lojista é **idêntico** ao de hoje
(assinatura vencida bloqueia todo o resto e libera as duas telas isentas).

## Escopo
- [ ] Rodar e conferir os greps de invariante: `x-pathname` → zero; `ROTAS_EXCECAO_ASSINATURA` → zero.
- [ ] Suíte verde: `acessoPainel.test.ts` (duas funções puras), guard estrutural da [141],
  `middleware.cve-guard.test.ts`.
- [ ] `npx next build` sem colisão de rota e sem warning novo (route group não muda URL).
- [ ] Verificação manual (`verificar`): loja com assinatura vencida
  (a) é redirecionada de `/painel`, `/painel/produtos`, `/painel/pedidos`, `/painel/configuracoes/perfil`
  para `/painel/assinatura-bloqueada`; e
  (b) abre `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura` **sem** redirect (anti-loop).
  Loja com assinatura válida acessa tudo normalmente.
- [ ] Conferir os behaviors das seções "Páginas e Rotas" e "Critérios de Aceite" do spec como checklist.

## Fora de escopo
- Novas features ou mudança de UI/URL — só amarra e verifica o que 140–143 entregaram.

## Reuso esperado
- Testes já escritos em 140/141/142/143 — este consolida o caminho completo.
- Fluxo de `verificar` (painel autenticado) com loja de assinatura vencida/ativa no seed.

## Segurança
- Confirma a invariante posicional do gate e o anti-loop de ponta a ponta, sem entrada de transporte
  em authz. É a garantia final de que a higiene arquitetural fechou sem regressão de comportamento.

## Critério de aceite
- [ ] `grep -rn "x-pathname" src/` e `grep -rn "ROTAS_EXCECAO_ASSINATURA" src/` → zero.
- [ ] `npx vitest run` (suíte relevante) + `npx next build` verdes.
- [ ] Verificação manual dos dois caminhos (bloqueado / isento) concluída e idêntica ao comportamento atual.
