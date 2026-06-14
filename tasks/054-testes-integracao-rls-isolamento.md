# [054] Testes de integração — isolamento RLS entre lojas

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 004, 005, 006, 023, 024, 025, 026
**Spec:** specs/spec_irango_mvp.md (RN-02, RN-03)

## Objetivo
Suite de integração que prova o isolamento multitenant: lojista A nunca lê/escreve dados de B; público só vê o que deve.

## Escopo
- [ ] Criar testes (vitest) cobrindo cruzamento A↔B em: lojas, produtos, categorias, cupons, pedidos, zonas, formas de pagamento
- [ ] Anon: lê loja/produto ativos; NÃO lê cupom; NÃO faz SELECT de pedido; lê confirmação só por token correto
- [ ] Lojista A não vê pedidos/produtos/cupons de B

## Fora de escopo
Cálculos (já testados em 008/009/012/014). Testes de UI.

## Reuso esperado
- Queries (023-026), schema/RLS (004-006), `npm test` (vitest)

## Segurança
- Esta suite é a prova final de RN-02/RN-03 — bug aqui vaza dado entre lojas

## Critério de aceite
- [ ] (crítica) Todos os cenários de vazamento entre lojas falham (acesso negado) e os legítimos passam
