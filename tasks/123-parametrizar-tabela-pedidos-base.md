# [123] Parametrizar `TabelaPedidos` e `PedidosClient` com `basePedidos`

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rotas 2 e 3)

## Objetivo
Permitir que os links de pedido apontem para o contexto correto (painel ou admin) via um prop `basePedidos`, sem duplicar a tabela.

## Escopo
- [ ] `TabelaPedidos`: adicionar prop opcional `basePedidos?: string` (default `"/painel/pedidos"`); os `href` de desktop e mobile passam a usar `${basePedidos}/${id}`.
- [ ] `PedidosClient`: aceitar `basePedidos?` e repassar a `TabelaPedidos` (default = comportamento atual).

## Fora de escopo
Pages admin de pedidos (139/140). Loader admin (130).

## Reuso esperado
- `TabelaPedidos` e `PedidosClient` existentes — só adicionar o prop com default.

## Segurança
- Apresentação/navegação. A lista já chega escopada por loja do servidor; o link não é barreira de segurança.

## Critério de aceite
- [ ] Sem `basePedidos`, links continuam `/painel/pedidos/[id]` (zero regressão no painel).
- [ ] Com `basePedidos="/admin/assinantes/[lojaId]/pedidos"`, links apontam ao contexto admin.
