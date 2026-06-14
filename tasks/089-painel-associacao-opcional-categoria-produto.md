# [089] UI painel — associar categorias de opcional a categorias de produto

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 080, 084, 088
**Spec:** specs/spec_opcionais.md

## Objetivo
Interface para o lojista vincular, por categoria de produto, quais categorias de opcional aparecem (herança), gravando/removendo linhas em `categoria_produto_opcionais`.

## Escopo
- [ ] `AssociacaoOpcionaisPorCategoria` — para cada categoria de PRODUTO, checkboxes das categorias de OPCIONAL da loja
- [ ] Server Action grava/remove linhas em `categoria_produto_opcionais` (`schemaAssociacaoCategoriaOpcional` de 084)
- [ ] Revalida que `categoria_id` E `categoria_opcional_id` pertencem à loja do lojista (RN-O8, anti-cross-tenant)
- [ ] Estado vazio: categoria de produto sem nenhum opcional associado → produtos dela ficam "sem opcionais"

## Fora de escopo
- Override por produto individual (fora do MVP).
- CRUD de itens/categorias (088).

## Reuso esperado
- `lib/validacoes/opcional.ts` (`schemaAssociacaoCategoriaOpcional`, 084).
- Categorias de produto já existentes (`categorias`).
- shadcn/ui `Table`/`Checkbox`, sonner `toast`.

## Segurança
- RN-O8: a action revalida ownership das DUAS pontas (categoria de produto e categoria de opcional) contra a loja do lojista; RLS própria (080) reforça.
- Nenhum valor monetário; é só associação.

## Critério de aceite
- [ ] Lojista associa/desassocia categorias de opcional por categoria de produto.
- [ ] Tentativa de associar categoria de outra loja é recusada pela action.
- [ ] A associação reflete nos opcionais exibidos no modal da vitrine (081/087).
