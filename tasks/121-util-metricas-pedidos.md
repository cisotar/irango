# [121] Extrair `calcularMetricasDoDia` + `chaveDia` para `lib/utils/metricasPedidos.ts`

**crítica:** NÃO
**Mundo:** infra (util compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 2)

## Objetivo
Extrair a lógica de métricas do dia hoje inline em `painel/page.tsx` para um utilitário puro reusável pelo Dashboard do lojista e pelo Dashboard admin, sem duplicar cálculo.

## Escopo
- [ ] Criar `src/lib/utils/metricasPedidos.ts` exportando `calcularMetricasDoDia(pedidos): Metricas` e `chaveDia(data): string` (fuso America/Sao_Paulo), portados 1:1 de `painel/page.tsx`.
- [ ] Exportar o tipo `Metricas` (`pedidosHoje`, `pendentes`, `totalDoDia`).
- [ ] `painel/page.tsx` passa a importar do util (remover as funções locais).

## Fora de escopo
Extração do componente `DashboardLoja` (issue 122). Qualquer mudança de regra de cálculo.

## Reuso esperado
- Lógica já existente em `painel/page.tsx` — mover, não reescrever.
- `PedidoComItens` de `lib/supabase/queries/pedidos.ts`.

## Segurança
- Sem valor monetário novo: `total` já é o valor autoritativo persistido; o util só soma persistidos. Nenhum recálculo de preço. Sem I/O, sem tabela tocada.

## Critério de aceite
- [ ] `metricasPedidos.ts` puro (sem I/O), testável isolado.
- [ ] `painel/page.tsx` compila e renderiza métricas idênticas (zero regressão no painel do lojista).
