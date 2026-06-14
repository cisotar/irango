# [044] Página de produtos + categorias `/painel/produtos`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 024, 031, 043
**Spec:** specs/spec_irango_mvp.md (Produtos, Categorias)

## Objetivo
Página de gestão de catálogo: lista de produtos, CRUD via dialog, e seção/aba de categorias.

## Escopo
- [ ] Criar `src/app/(painel)/painel/produtos/page.tsx`
- [ ] TabelaProdutos (043) + abrir FormProduto em dialog para criar/editar
- [ ] Ações: criar/editar/remover/toggle/reordenar via actions (031)
- [ ] Seção/aba de categorias com ListaCategorias + FormCategoria (dialog)
- [ ] CRUD de categorias via actions (031)

## Fora de escopo
Server Actions (031), componentes de form (043).

## Reuso esperado
- `buscarProdutosDoLojista`/`buscarCategorias` (024), actions (031), componentes (043), shadcn/ui `Dialog`/`Tabs`

## Segurança
- Mutations via Server Action com validação no servidor (RN-02/§6)

## Critério de aceite
- [ ] Criar/editar/remover produto reflete na lista; toggle some/aparece na vitrine; categorias gerenciáveis
