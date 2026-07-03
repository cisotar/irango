# [122] Extrair `DashboardLoja` compartilhado do inline de `painel/page.tsx`

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** 121, 123
**Spec:** specs/paridade-hub-admin-painel.md (rota 2, Princípio arquitetural)

## Objetivo
Transformar a UI inline do dashboard do lojista em UM componente compartilhado `DashboardLoja`, consumido pelo painel e (depois) pela page admin — sem cópia de markup.

## Escopo
- [ ] Criar `src/components/painel/DashboardLoja.tsx` que recebe `pedidos`/`metricas` (ou `pedidos` e calcula via util 121) + `basePedidos` e renderiza os 3 cards de métrica + `TabelaPedidos` + link "Ver todos".
- [ ] `basePedidos` parametriza o link "Ver todos" e é repassado a `TabelaPedidos` (default `/painel`).
- [ ] `painel/page.tsx` passa a renderizar `<DashboardLoja ... />` (nenhum markup de dashboard inline restante).

## Fora de escopo
A page admin (issue 138). Loader admin (issue 130).

## Reuso esperado
- `lib/utils/metricasPedidos.ts` (121).
- `TabelaPedidos` parametrizado por `basePedidos` (123).
- shadcn `Card`.

## Segurança
- Componente de apresentação. `total` já autoritativo/persistido; sem recálculo. Sem tabela tocada.

## Critério de aceite
- [ ] Componente compartilhado único; nenhum markup do dashboard duplicado entre painel e admin.
- [ ] Zero regressão no dashboard do lojista (mesmos cards, mesma tabela, mesmo link).
