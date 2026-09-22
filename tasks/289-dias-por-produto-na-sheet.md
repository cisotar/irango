# [289] Dias por produto na sheet de adicionar itens

**crítica: SIM** — escreve em `cardapio_produtos` escopado por `loja_id`, nos dois mundos. TDD
red-first e `auditar` obrigatórios.

**Mundo:** `/painel/cardapios/[cardapioId]` (sheet) e o gêmeo no hub admin.
**Depende de:** [287] e [288], entregues no PR #150 (aberto, ainda não mesclado).
**Plano:** `plan/loop-dias-por-produto-na-sheet.md`.

## Origem

Pedido do dono do SaaS, literal:

> "na sheet onde aparecem as categorias dos produtos para serem adicionadas aos cardápios, quando
> um produto selecionado, logo abaixo dele mostrar botões: D, S, T, Q, Q, S, S para seleção do dia
> em que devem aparecer naquele cardápio. se nenhum selecionado, mas escolher dias no rodapé
> marcado, os dias no rodapé da sheet se aplicam a todos os produtos acima selecionados."

Hoje `aplicarCardapioEmProdutos` (`src/lib/actions/cardapio.ts:119`) monta todas as linhas com o
mesmo `dias_semana`, porque `schemaLoteDeProdutosComDias` (`src/lib/validacoes/cardapio.ts:68`)
carrega um valor só para o lote inteiro. Adicionar dois produtos no mesmo gesto com agendas
diferentes é impossível, que é justamente o caso de uso que originou a feature.

## Forma do payload (decidida)

`schemaLoteDeProdutosComDias` ganha uma chave **aditiva e opcional**:

```
dias_por_produto?: Record<produto_id, number[]>
```

`produto_ids` e `dias_semana` continuam como estão. O servidor resolve por linha:
`normalizarDiasDoVinculo(dias_por_produto[id] ?? dias)`.

**Trava:** chave de `dias_por_produto` que não esteja em `produto_ids` é **recusada** com
`MSG_GENERICA_LOTE`, nunca ignorada em silêncio. Mapa que aceita id desconhecido é superfície de
escrita a mais para enumerar.

## Regra de fallback (do dono do produto, fechada)

Por produto. Produto com pílula própria marcada usa a dele. Produto sem pílula marcada herda o
valor do rodapé da sheet, que já tem o par "Todos os dias do cardápio" e "Escolher dias". A regra
mora em função pura de `escolhaDeDias.ts`, não num handler de clique: o projeto não tem jsdom e
regra em handler não é observável em teste.

## Escopo

- [ ] `src/components/painel/escolhaDeDias.ts` — a resolução pura "pílula do produto vence rodapé".
- [ ] `src/lib/validacoes/cardapio.ts` — o mapa opcional no schema, com a trava de id desconhecido.
- [ ] `src/lib/actions/cardapio.ts` — linha por produto em `aplicarCardapioEmProdutos`.
- [ ] `src/app/admin/assinantes/actions/admin-cardapios.ts` — a action irmã, em paridade.
- [ ] `src/components/painel/useLoteDeProdutos.tsx` — carregar o mapa até a action.
- [ ] `src/components/painel/SheetAdicionarItens.tsx` — `PilulasDeDias` sob o produto selecionado,
      reuso direto, sem variante nova.
- [ ] Testes: módulo puro, schema, e pglite nas duas actions.

## Fora de escopo

- **A barra de lote de `/painel/produtos` não muda.** Ela chama a mesma action e simplesmente não
  manda a chave nova. Nenhuma pílula por item aparece lá.
- **A RPC de categoria inteira não muda.** Ela expande dentro da transação e não recebe dias.
- Nenhuma migration: a coluna existe desde a [272] e já está no cloud.

## Critério de aceite

- [ ] Dois produtos adicionados no mesmo gesto gravam `dias_semana` diferentes.
- [ ] Produto sem pílula própria grava o valor do rodapé; rodapé em "todos os dias" grava `NULL`.
- [ ] `dias_por_produto` com id fora de `produto_ids` é recusado.
- [ ] Payload sem a chave nova continua válido e produz exatamente a linha de hoje.
- [ ] Cardápio de outra loja recusado nos dois mundos, afirmando o fragmento da mensagem junto com
      o SQLSTATE.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
