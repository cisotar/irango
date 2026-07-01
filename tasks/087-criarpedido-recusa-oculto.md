# [087] `criarPedido`: recusar produto `oculto = true` no recálculo autoritativo

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública (Server Action autoritativa)
**Depende de:** [084]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Somar `|| produto.oculto` à condição de recusa de item em `criarPedido`, para que produto oculto (ou esgotado) nunca vire pedido mesmo com `produto_id` forjado no payload (RN-5, ponto de segurança central da spec).

## Escopo
- [ ] `src/lib/actions/pedido.ts` (~linha 140): a condição hoje `!produto.disponivel || produto.loja_id !== dados.loja_id` passa a incluir `|| produto.oculto === true`.
- [ ] Item oculto/esgotado/de outra loja → recusa o PEDIDO INTEIRO com erro genérico (mesmo padrão atual).

## Fora de escopo
- UI da vitrine (o botão desabilitado é preview; a verdade é o servidor).
- Query pública (086) e actions do painel (085).

## Reuso esperado
- `src/lib/actions/pedido.ts` — estender a condição de recusa já existente; `buscarProdutosPorIds` já traz `oculto` (`select("*")`), nenhuma query nova.
- `ERRO_GENERICO` existente (não vazar detalhe ao cliente, `seguranca.md §14`).

## Segurança
- Dinheiro/integridade do pedido: um cliente pode ver "esgotado" e forjar `produto_id` de item oculto no payload → o servidor DEVE recusar. Recálculo autoritativo é obrigatório (não confiar no cliente).
- Recusa antes de chamar a RPC `criar_pedido` (mesmo fluxo do item de outra loja).

## Critério de aceite
- [ ] Teste RED: payload com `produto_id` de produto `oculto = true` → `criarPedido` retorna erro e NÃO cria pedido.
- [ ] Payload com produto `disponivel = false` → continua recusado (comportamento preexistente preservado).
- [ ] Payload com produto disponível/não-oculto da loja correta → cria pedido normalmente.
