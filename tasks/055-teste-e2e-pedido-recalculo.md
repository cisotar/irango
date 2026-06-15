# [055] Teste de ponta a ponta — pedido e recálculo no servidor

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 014, 035, 036, 037
**Spec:** specs/spec_irango_mvp.md (RN-04, RN-05, RN-06, RN-09)

## Objetivo
Teste de fluxo completo do pedido provando que o cliente não controla valores: payload adulterado é descartado, frete/cupom recalculados, loja fechada bloqueia, snapshot preservado.

## Escopo
- [ ] Teste do fluxo `criarPedido` ponta a ponta (vitrine → checkout → confirmação)
- [ ] Caso ataque: payload com `total: 0.01` salva total real recalculado
- [ ] Caso item indisponível / de outra loja → recusado
- [ ] Caso cupom revalidado + `usos_contagem` incrementado uma vez (sem condição de corrida)
- [ ] Caso loja fechada → recusado (RN-09)
- [ ] Snapshot de nome/preço preservado mesmo após editar o produto (RN-04)
- [ ] Confirmação acessível só com id+token corretos

## Fora de escopo
Testes de RLS puro (054).

## Reuso esperado
- `criarPedido` (014), queries (024-026), `npm test`

## Segurança
- Cobre o risco mais crítico do marketplace (seguranca.md §10) e a integridade do snapshot/cupom

## Critério de aceite
- [ ] (crítica) Todos os cenários de adulteração de valor falham (servidor recalcula); fluxo legítimo cria pedido e confirma por token
