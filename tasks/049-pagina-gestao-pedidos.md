# [049] Página gestão de pedidos `/painel/pedidos`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 026, 033, 039
**Spec:** specs/spec_irango_mvp.md (Pedidos, RN-08)

## Objetivo
Lista de pedidos com filtro por status, detalhe do pedido e botões de transição de status contextuais (só ações válidas).

## Escopo
- [ ] Criar `src/app/(painel)/painel/pedidos/page.tsx` (lista + FiltroPorStatus) e `.../pedidos/[id]/page.tsx` (detalhe)
- [ ] Listagem com `buscarPedidosDoLojista` (026), filtro por status
- [ ] Detalhe: itens (snapshot), endereço, forma de pagamento, observações
- [ ] Botões de ação contextuais por status (usar `transicaoPermitida` de 033 para exibir só ações válidas)
- [ ] Ações chamam `atualizarStatusPedido` (033) com toast

## Fora de escopo
Validação de transição (já no servidor — 033).

## Reuso esperado
- `buscarPedidosDoLojista` (026), `atualizarStatusPedido`/`transicaoPermitida` (033), TabelaPedidos (039), shadcn/ui `Tabs`/`Select`/`Drawer`

## Segurança
- Transição validada no servidor (RN-08); UI nunca mostra ação inválida, mas o servidor é a barreira
- RLS isola pedidos por loja (RN-02)

## Critério de aceite
- [ ] (crítica) Verificação: botões refletem o status atual; tentativa de transição inválida (forçada) é recusada pelo servidor; filtro por status funciona; detalhe usa snapshot de nome/preço
