# [138] Page admin: Dashboard da loja-alvo — `/admin/assinantes/[lojaId]`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 122, 130
**Spec:** specs/paridade-hub-admin-painel.md (rota 2)

## Objetivo
Repurposar `[lojaId]/page.tsx` (hoje só redireciona) como o Dashboard equivalente ao `/painel`, consumindo o `DashboardLoja` compartilhado.

## Escopo
- [ ] Substituir o `redirect(...)` de `[lojaId]/page.tsx` por Server Component que carrega pedidos via `listarPedidosDaLoja(svc, lojaId)` e renderiza `<DashboardLoja pedidos={...} basePedidos="/admin/assinantes/[lojaId]/pedidos" />`.
- [ ] Escopo por `lojaId` da URL; sem cálculo monetário novo.

## Fora de escopo
Shell/nav (145). `DashboardLoja` (122). Loader (130).

## Reuso esperado
- `DashboardLoja` (122), `listarPedidosDaLoja` (130), `metricasPedidos` (121, via componente).

## Segurança
- Leitura escopada por `lojaId` sob `service_role`; o guard de admin já roda no layout. `total` já autoritativo; sem recálculo.

## Critério de aceite
- [ ] Dashboard admin exibe métricas + 20 recentes com links `/admin/assinantes/[lojaId]/pedidos/[id]`.
- [ ] Nenhum markup copiado do painel — usa `DashboardLoja`. Zero regressão no painel do lojista.
