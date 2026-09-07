# [173] ProdutoModal: quantidade não reseta ao reabrir o mesmo produto

**crítica:** NÃO
**Mundo:** vitrine pública
**Origem:** achado do `verificar` durante a issue 169 (observações por item)

## Objetivo

Zerar a quantidade ao reabrir o modal do mesmo produto, do jeito que já acontece
com a observação.

## Contexto

`src/components/vitrine/ProdutoModal.tsx`, função `confirmar()`: o comentário no
código já reconhece que o modal não remonta ao reabrir o mesmo produto (o `key`
do `SecaoCatalogo` não força remount) e por isso reseta `observacao` explicitamente
para não vazar pra próxima adição — mas **não reseta `quantidade`** nem os
opcionais escolhidos.

Reproduzido em verificação manual: adicionar 1 unidade com observação A; reabrir
o modal do mesmo produto pra adicionar observação B sem tocar em mais nada — a
seção de Quantidade já mostra `1` herdado da adição anterior, não `0`.

**Não é perda de dinheiro nem de dado** — o valor é recalculado no servidor e
cada linha do carrinho fica com o preço correto — mas é uma inconsistência de UX
que pode levar o cliente a adicionar quantidade a mais sem perceber.

## Escopo

- [ ] Resetar `quantidade` (e os opcionais escolhidos, se sofrerem do mesmo
      problema) no mesmo ponto onde `observacao` já é resetada em `confirmar()`.
- [ ] Teste cobrindo: adicionar com quantidade 2, reabrir o mesmo produto,
      confirmar que a seção de Quantidade inicia em 0/1 (o padrão de um produto
      nunca aberto antes), não em 2.

## Fora de escopo

- Mudar o comportamento de `key` do `SecaoCatalogo` (remontar o modal resolveria
  isso de outra forma, mas é mudança maior e não é o menor incremento aqui).
