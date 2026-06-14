# [048] Página dashboard `/painel`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 026, 039
**Spec:** specs/spec_irango_mvp.md (Dashboard)

## Objetivo
Página inicial do painel com métricas do dia e tabela de pedidos recentes.

## Escopo
- [ ] Criar `src/app/(painel)/painel/page.tsx` (Server Component)
- [ ] CardMetrica: pedidos hoje, pendentes, total do dia (`buscarMetricasDoDia` 026)
- [ ] TabelaPedidosRecentes: 20 mais recentes (`buscarPedidosRecentes` 026)

## Fora de escopo
Detalhe/atualização de pedido (049). Guard (016).

## Reuso esperado
- Queries (026), TabelaPedidos (039), `formatarMoeda` (007), shadcn/ui `Card`

## Segurança
- Server Component; RLS garante só pedidos da própria loja (RN-02)

## Critério de aceite
- [ ] Métricas do dia corretas; 20 pedidos recentes listados; linha abre o detalhe
