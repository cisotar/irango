# [159] Paralelizar as 4 leituras independentes de `criarPedido`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding CUSTO da auditoria de performance da issue 125.
Registro: `performance/2026-09-06-criarpedido-whatsapphref.md`

## Problema

Em `src/lib/actions/pedido.ts` linhas 89, 96, 107 e 208, quatro leituras
independentes acontecem em round trips sequenciais:
`listarFormasPagamento`, `buscarProdutosPorIds`, `buscarOpcionaisPorIds` e
`listarZonasComTaxas`. Só `buscarOpcionaisPorCategoria` (linha 117) depende de
`produtos`.

## Escopo

- [ ] Agrupar as quatro numa onda `Promise.all`, mantendo a allowlist e as
      validações dependentes na onda seguinte.

## Ressalva explícita (avaliar antes de implementar)

Hoje o `return` antecipado da linha 90 evita as leituras seguintes quando a
forma de pagamento é inválida. Paralelizar troca essa economia no caminho de
ERRO por latência menor no caminho de SUCESSO. Medir antes de decidir: se o
caminho de erro for raro (esperado), a troca compensa.

## Critério de aceite

- [ ] Comportamento e validações idênticos ao atual, inclusive as rejeições.
- [ ] Sem regressão nos testes existentes de `criarPedido`.
- [ ] Decisão sobre a ressalva do `return` antecipado registrada na issue.
