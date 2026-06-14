# [088] UI painel — biblioteca de opcionais (CRUD categorias + itens)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 080, 084
**Spec:** specs/spec_opcionais.md

## Objetivo
Tela `/painel/produtos/opcionais` para o lojista manter a biblioteca: CRUD de categorias de opcional e de opcionais (nome, preço, ativo, ordem), com busca por nome.

## Escopo
- [ ] `ListaCategoriasOpcional` — nome, ordem, nº de itens, ações
- [ ] `FormCategoriaOpcional` (react-hook-form + `schemaCategoriaOpcional` de 084) — criar/editar/remover com confirmação
- [ ] `FormOpcional` (react-hook-form + `schemaOpcional`) — criar/editar; valida `preco >= 0` e categoria de opcional da própria loja
- [ ] `BuscaOpcional` — filtro por nome
- [ ] Toggle `ativo` por opcional
- [ ] Reordenar categorias/opcionais (atualiza `ordem`)
- [ ] Server Actions de CRUD com `loja_id` do lojista (escopo próprio); revalida que `categoria_opcional_id` é da mesma loja

## Fora de escopo
- Associação categoria-de-produto ⋈ categoria-de-opcional (089).
- Modal da vitrine (087).

## Reuso esperado
- `lib/validacoes/opcional.ts` (084).
- Padrão de Server Action de painel existente (ex.: `lib/actions/produto.ts`).
- shadcn/ui `Table`, `Dialog`, `Input`, `Switch`, `AlertDialog`, sonner `toast`.

## Segurança
- Escrita só do dono — RLS própria (080) + `loja_id` do lojista na action; `categoria_opcional_id` revalidado como da mesma loja.
- Opcional inativo some da vitrine e não pode ser pedido (RN-O5, garantido em 081/085).

## Critério de aceite
- [ ] Lojista cria/edita/remove categoria de opcional e opcional.
- [ ] `preco < 0` é bloqueado no form e na action.
- [ ] Toggle `ativo` reflete na vitrine.
- [ ] Busca filtra por nome.
