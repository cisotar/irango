# [033] Server Action `atualizarStatusPedido` (máquina de estados)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 006, 026
**Spec:** specs/spec_irango_mvp.md (RN-08)

## Objetivo
Server Action que valida a transição de status permitida antes de atualizar o pedido — recusa saltos e reversões.

## Escopo
- [ ] Criar `src/lib/actions/status.ts` (`'use server'`) + util puro `src/lib/utils/transicaoStatus.ts`
- [ ] Máquina: `pendente → confirmado → em_preparo → saiu_entrega → entregue`; cancelar permitido de `pendente|confirmado|em_preparo`
- [ ] `transicaoPermitida(de, para): boolean` (util puro, testável)
- [ ] `atualizarStatusPedido(pedidoId, novoStatus)`: valida transição → UPDATE; recusa inválida com erro
- [ ] Escopado à loja do `auth.uid()` (RLS `pedidos_acesso_lojista`)

## Fora de escopo
UI dos botões contextuais (049). Listagem (026).

## Reuso esperado
- `transicaoPermitida` (util novo desta issue, reusado na UI para mostrar só ações válidas)
- `buscarPedidosDoLojista` (026)

## Segurança
- Transição validada no servidor — cliente não força salto arbitrário (RN-08)
- Lojista só altera pedido da própria loja (RN-02)

## Critério de aceite
- [ ] (crítica) Teste vermelho: `entregue → pendente` recusado; `pendente → entregue` (salto) recusado; `pendente → confirmado` aceito; cancelar de `saiu_entrega` recusado; lojista B não altera pedido de A
