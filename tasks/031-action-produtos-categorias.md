# [031] Server Actions de produtos e categorias

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 005, 018, 020, 024
**Spec:** specs/spec_irango_mvp.md (Produtos, Categorias)

## Objetivo
Server Actions de CRUD de produtos e categorias, com validação zod no servidor e escopo à loja do lojista.

## Escopo
- [ ] Criar `src/lib/actions/produto.ts` e `src/lib/actions/categoria.ts` (`'use server'`)
- [ ] Produto: `salvarProduto` (create/update, valida `schemaProduto`, integra `foto_url` de 018), `alternarDisponibilidade`, `removerProduto`, `reordenarProdutos`
- [ ] Categoria: `salvarCategoria`, `removerCategoria` (produtos ficam `categoria_id = NULL`), `reordenarCategorias`
- [ ] Todas escopadas à loja do `auth.uid()` (RLS `produtos_escrita_propria`/`categorias_escrita_propria`)
- [ ] `revalidatePath` do painel e da vitrine

## Fora de escopo
Upload de foto (018). UI (043, 044).

## Reuso esperado
- `schemaProduto`/`schemaCategoria` (020), `uploadFotoProduto` (018), `buscarLojaDoDono` (023)

## Segurança
- Validação `preco >= 0` no servidor (RN-11/§6); escrita só na própria loja (RN-02)
- Toggle de disponibilidade afeta visibilidade pública (RLS filtra `disponivel = true`)

## Critério de aceite
- [ ] (crítica) Teste vermelho: lojista B não cria/edita produto na loja de A; `preco = -1` rejeitado; remover categoria deixa produtos com `categoria_id NULL`
