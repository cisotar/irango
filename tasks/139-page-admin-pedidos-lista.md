# [139] Page admin: Pedidos (lista) — `/admin/assinantes/[lojaId]/pedidos`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 123, 130
**Spec:** specs/paridade-hub-admin-painel.md (rota 3)

## Objetivo
Lista de pedidos da loja-alvo com filtro por status (client-side), equivalente a `/painel/pedidos`, consumindo o `PedidosClient` compartilhado.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/pedidos/page.tsx` (Server Component) que carrega via `listarPedidosDaLoja(svc, lojaId)` e renderiza `<PedidosClient pedidos={...} basePedidos="/admin/assinantes/[lojaId]/pedidos" />`.

## Fora de escopo
Detalhe do pedido (140). Shell/nav (145). Loader (130).

## Reuso esperado
- `PedidosClient` + `TabelaPedidos` parametrizados por `basePedidos` (123).
- `listarPedidosDaLoja` (130).

## Segurança
- Leitura escopada por `lojaId`. Filtro é UX, nunca barreira; a lista já chega escopada do servidor.

## Critério de aceite
- [ ] Lista escopada à loja-alvo, filtro por status funciona, links vão ao detalhe admin.
- [ ] Nenhum markup copiado do painel — usa `PedidosClient`. Zero regressão no painel do lojista.
