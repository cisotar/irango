# [140] Page admin: Pedido detalhe + status — `/admin/assinantes/[lojaId]/pedidos/[id]`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 125, 130, 133
**Spec:** specs/paridade-hub-admin-painel.md (rota 4)

## Objetivo
Detalhe do pedido da loja-alvo consumindo o `DetalhePedido` compartilhado, com a mudança de status via action admin injetada. As barreiras críticas (leitura escopada, transição, cross-loja) vivem em 130 e 133.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/pedidos/[id]/page.tsx` (Server Component) que carrega via `buscarPedidoDaLoja(svc, lojaId, id)` (`notFound()` se null) e renderiza `<DetalhePedido pedido={...} basePedidos="/admin/assinantes/[lojaId]/pedidos" acaoStatus={...} />`.
- [ ] Criar wrapper client mínimo (ou passar action já ligada) que injeta `atualizarStatusPedidoAdmin` com `lojaId`/`id` fixados em closure no `AcoesStatus`.

## Fora de escopo
`DetalhePedido` (125). `AcoesStatus` param (124). Action admin (133). Loader (130).

## Reuso esperado
- `DetalhePedido` (125), `buscarPedidoDaLoja` (130), `atualizarStatusPedidoAdmin` (133).

## Segurança
- Leitura escopada por `lojaId`+`id` sob `service_role` (PII autorizada; guard de admin no layout). A autoridade da transição e o escopo cross-loja da escrita estão na Server Action (133) — a page só fia; `lojaId` da URL é revalidado na action.

## Critério de aceite
- [ ] Detalhe exibe dados/itens/PII e transições válidas; mudar status chama `atualizarStatusPedidoAdmin`.
- [ ] Nenhum markup copiado do painel — usa `DetalhePedido`. Zero regressão no painel do lojista.
