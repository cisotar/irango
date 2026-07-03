# [129] Adicionar `salvarAssociacaoOpcionais?` ao contrato `acoes` do `ProdutosClient`

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 7)

## Objetivo
Permitir que o cardápio admin injete a variante admin de `salvarAssociacaoOpcionais` no rodapé de opcionais do produto, hoje importada direto do lojista.

## Escopo
- [ ] `ProdutosClient`: adicionar `salvarAssociacaoOpcionais?` ao objeto `acoes?`; no ponto de uso (rodapé de opcionais por categoria) usar `acoes?.salvarAssociacaoOpcionais ?? salvarAssociacaoOpcionais` (import lojista como default).

## Fora de escopo
Fiação real dos dados de opcionais no cardápio admin (143). Action admin (135).

## Reuso esperado
- `salvarAssociacaoOpcionais` de `lib/actions/opcional.ts` (default).
- Contrato `acoes?` já existente no `ProdutosClient`.

## Segurança
- Orquestração. Associação categoria⋈opcional é escrita revalidada no servidor (posse das duas pontas). Este prop só troca a action; a barreira permanece na Server Action.

## Critério de aceite
- [ ] Sem a action injetada, comportamento idêntico ao atual (zero regressão no painel).
- [ ] Com `acoes.salvarAssociacaoOpcionais` injetada, a associação no cardápio chama a action fornecida.
