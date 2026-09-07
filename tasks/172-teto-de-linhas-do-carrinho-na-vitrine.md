# [172] Carrinho: bloquear adição ao atingir o teto de 50 linhas

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 168 (observação na chave de dedup)
**Origem:** achado BAIXA do `auditar` no commit `0b9f6aa` (issue 168)

## Objetivo

Impedir que o carrinho entre num estado não-submetível sem nada na UI explicando.

## Contexto

Antes da issue 168 o número de linhas do carrinho era limitado pelas combinações
produto × opcionais do cardápio. Com a observação na chave de dedup, **um único
produto gera linhas ilimitadas**: 51 observações distintas viram 51 linhas.

`schemaPayloadPedido.itens` tem `.max(50)` (`src/lib/validacoes/pedido.ts:82`),
então o servidor rejeita o pedido inteiro com mensagem genérica — o cliente
monta um carrinho grande, tenta finalizar e não descobre o motivo. É auto-DoS,
sem benefício para atacante, mas é degradação nova introduzida pela 168.

## Escopo

- [ ] Extrair o `50` do zod para `src/lib/constants/pedido.ts` como
      `MAX_ITENS_PEDIDO`, ao lado de `LIMITE_OBSERVACAO` — o arquivo é a fonte
      única e **não pode ganhar import** (issue 163: zod no bundle público).
- [ ] `src/lib/validacoes/pedido.ts` passa a usar a constante no lugar do literal.
- [ ] `src/hooks/useCarrinho.ts`: `adicionarItem` não cria linha nova quando já
      há `MAX_ITENS_PEDIDO` linhas. Incrementar a quantidade de uma linha
      **existente** continua permitido (não cria linha).
- [ ] UI: o CTA "Adicionar ao carrinho" do `ProdutoModal` informa o teto quando
      atingido, em vez de falhar em silêncio.
- [ ] Teste: 50 linhas + tentativa de criar a 51ª → carrinho permanece com 50 e
      o item não é perdido silenciosamente; e o payload de 50 linhas passa no
      `schemaPayloadPedido.safeParse`.

## Fora de escopo

- Mudar o teto de 50 (é decisão de produto, não desta issue).
- Qualquer limite por loja ou configurável pelo lojista.
