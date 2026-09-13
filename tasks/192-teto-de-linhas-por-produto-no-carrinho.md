# [192] Teto de linhas POR PRODUTO no carrinho

**crítica:** NÃO
**Mundo:** vitrine pública + fronteira de entrada do pedido
**Depende de:** 172 (teto global de linhas — já implementado, commit `5cda036`)
**Origem:** pergunta de produto durante o fechamento da 172, 2026-09-13

## Nada está quebrado hoje

Esta issue é **planejamento para o futuro, não correção de bug**. Nenhum
comportamento atual está errado e nada no código de hoje depende dela.

O teto global de 50 linhas (`MAX_ITENS_PEDIDO`) já está no lugar e funcionando
nas três camadas: `schemaPayloadPedido.itens` no servidor (gate autoritativo),
`adicionarItem` no `useCarrinho` (trava a criação da linha excedente) e o CTA do
`ProdutoModal` (avisa o cliente em vez de falhar calado). Nenhum cliente consegue
montar um carrinho não-submetível.

O que esta issue propõe é um **segundo teto, mais fino**, por produto. É
melhoria de UX e de proporcionalidade, não fechamento de brecha. Se for
priorizada como "nunca", nada degrada.

## Contexto

Desde a issue 168 a observação entra na chave de dedup da linha, então **um
único produto gera linhas ilimitadas**: 50 observações distintas do mesmo
X-Burguer consomem sozinhas o teto global inteiro.

Combinado com o teto de quantidade por linha que já existe
(`quantidade: z.number().int().min(1).max(99)`), um pedido válido hoje pode
chegar a 50 linhas × 99 unidades = 4.950 unidades. Todas do mesmo produto, se o
cliente quiser.

Não é vetor de ataque — o valor é recalculado no servidor a partir do banco e o
rate limit já cobre o abuso de volume. É desproporção operacional: um pedido
assim chega na cozinha do lojista sem nenhum aviso de que é anômalo.

## Pergunta de produto a responder ANTES de implementar

**O teto por produto é um número fixo igual para todo o cardápio, ou o lojista
define um valor por produto no painel?**

A resposta muda a ordem de grandeza do trabalho:

### Opção A — número fixo no código (barato)

Mesma forma da 172, que já deixou a estrutura pronta:

- `MAX_LINHAS_POR_PRODUTO` em `src/lib/constants/pedido.ts`, ao lado de
  `MAX_ITENS_PEDIDO` e `LIMITE_OBSERVACAO`. ⚠️ O arquivo **não pode ganhar
  import** (issue 163: zod fora do bundle público).
- `adicionarItem` (`src/hooks/useCarrinho.ts`) conta as linhas do mesmo
  `produtoId` antes de criar a nova. Incrementar linha existente continua livre,
  como no teto global.
- `ProdutoModal` ganha a segunda condição e uma mensagem própria — o cliente
  precisa entender que o limite é *daquele produto*, não do carrinho.
- `src/lib/validacoes/pedido.ts` ganha um `superRefine` agrupando `itens` por
  `produto_id`. **Este é o gate autoritativo**: o cliente não pode ser a única
  trava (mandato 1, `seguranca.md` §10).

~4 arquivos + testes. Sem migration, sem RLS. Por tocar o schema do pedido, vai
de `/fluxo`, não de `/fix`.

### Opção B — configurável pelo lojista (caro)

Outra natureza de trabalho, não só um número diferente:

- Migration com coluna nova (deploy no cloud é irreversível — exige autorização
  humana explícita).
- Campo no painel do lojista + propagação até a query da vitrine.
- **O gate do servidor passa a precisar ler o banco para validar.** Hoje
  `schemaPayloadPedido` é zod puro, sem I/O — essa é a parte cara, porque muda a
  forma da validação, não só o valor comparado.

`/fluxo` completo com o agente `migrar`.

## Antes de escolher A ou B: vale confirmar o problema

Teto global e teto por produto resolvem coisas diferentes. O global protege o
servidor (cardinalidade do array, CWE-770). O por-produto protegeria contra o
quê, exatamente?

Se o caso real for "cliente confuso empilhando observações sem perceber", o
remédio mais barato pode não ser um teto: o `ProdutoModal` mostrar as linhas já
criadas daquele produto ao reabrir resolveria a confusão sem limitar ninguém —
e é quase o mesmo terreno da issue 173 (o modal não remonta ao reabrir o mesmo
produto).

Só faz sentido implementar depois que um caso concreto aparecer.

## Escopo

- [ ] Responder a pergunta de produto acima (A, B, ou "não é teto, é feedback na
      UI").
- [ ] Implementar a opção escolhida, com o gate autoritativo no servidor em
      qualquer uma delas.
- [ ] Teste: N linhas do mesmo produto + tentativa da N+1ª → carrinho não cria a
      linha e o cliente é avisado; payload com N+1 linhas do mesmo `produto_id`
      é rejeitado pelo `schemaPayloadPedido`.

## Fora de escopo

- Mudar o teto GLOBAL de 50 (decisão de produto à parte, já registrada como fora
  de escopo na 172).
- Mudar o teto de quantidade por linha (99).
