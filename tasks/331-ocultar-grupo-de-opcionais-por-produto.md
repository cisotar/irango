# 331 — Ocultar por produto um grupo de opcionais herdado da categoria

crítica: SIM (RLS + valor do pedido: opcional oculto é recusado no servidor)

Plano completo (fonte do Desenho, Reuso, Risco por fatia e Arquivos): `plan/loop-ocultar-opcionais-por-produto.md`.

## Pedido

> hoje as categorias de opcionais são adicionadas às categorias de produtos como um todo. manter, mas acrescentar um toggle de visualização/ocultação por produto dentro das categorias de produtos. hoje, há pills nos cards dos produtos que mostram as categorias de opcionais associadas, tornar clicáveis para exibir ou ocultar em cada produto.

Ampliação: a escolha também na tela de opcionais (botão "Por produto" em cada grupo, listando os produtos da categoria) e no modal de edição do produto; vale também para o admin (reuso das mesmas telas). Uma única fonte de verdade.

Fora de escopo (descartado pelo usuário): adicionar grupo exclusivo a um produto e qualquer ordenação por produto. Os grupos visíveis seguem sempre a ordem da categoria.

## Decisões

- D1: ocultar também bloqueia no pedido. O servidor recusa e `revisarCarrinho` barra carrinho antigo.
- D3: o oculto persiste se o produto mudar de categoria e só tem efeito se a nova categoria tiver o grupo.

## Desenho

Tabela `public.produto_opcionais_ocultos (id, loja_id, produto_id, categoria_opcional_id, criado_em)`, `unique (produto_id, categoria_opcional_id)`, FKs compostas com `loja_id`. Linha existe = oculto. Sem UPDATE. Regra: `visiveis(produto) = grupos da categoria (na ordem da categoria) − ocultos(produto)`.

Camadas: util pura (`src/lib/utils/opcionais-do-produto.ts`), Server Action em lote por via (lojista e admin), queries, hook `useOcultacoesOpcionais`, componentes `PilulasOpcionaisDoProduto` e `ProdutosDoGrupoOpcional`. Detalhes, arquivos e reuso em `plan/loop-ocultar-opcionais-por-produto.md`.

## Risco por fatia

Ver `## Risco por fatia` do plano (F1 tabela/RLS, F2 action em lote, F3 pedido/revisarCarrinho, F4 vitrine, F5 fonte única de UI).

## Spec

Sem `Spec:` associado.
