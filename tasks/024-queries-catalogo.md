# [024] Queries de catálogo (produtos, categorias)

**crítica:** NÃO
**Mundo:** infra
**Depende de:** 005, 017
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Queries reusáveis de produtos e categorias para vitrine e painel.

## Escopo
- [ ] Criar `src/lib/supabase/queries/produtos.ts`
- [ ] `buscarCatalogoPublico(lojaId)` — categorias ordenadas + produtos disponíveis agrupados (produtos sem categoria em "Outros")
- [ ] `buscarProdutosDoLojista(client, lojaId)` — todos, com categoria aninhada
- [ ] `buscarProdutosPorIds(ids)` — para recálculo de pedido (preço real do banco)
- [ ] Criar `src/lib/supabase/queries/categorias.ts`: `buscarCategorias(lojaId)`

## Fora de escopo
Mutations (031). RLS já garante isolamento (005).

## Reuso esperado
- `src/lib/supabase/{server,client}.ts`; tipos (017)

## Segurança
- `buscarProdutosPorIds` é insumo do recálculo autoritativo — retorna `preco`, `disponivel`, `loja_id` reais (seguranca.md §10)

## Critério de aceite
- [ ] `buscarCatalogoPublico` retorna só produtos disponíveis, agrupados e ordenados
- [ ] Produtos sem categoria aparecem em "Outros" no fim
