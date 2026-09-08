# [177] Categoria sem produto vira cabeçalho solto na vitrine pública

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** achado incidental da verificação da issue 175 (2026-09-08). Não foi
introduzido por ela.

## Problema

`buscarCategorias` (`src/lib/supabase/queries/categorias.ts`) devolve TODAS as
categorias da loja, inclusive as que não têm nenhum produto. A vitrine pública
renderiza o cabeçalho da categoria mesmo quando não há nada abaixo dele, então o
cliente final vê uma seção vazia no meio do cardápio.

Comportamento antigo. O painel do lojista já se protegia disso por conta própria:
`ProdutosClient.tsx:130` filtra `grupos.filter((g) => g.produtos.length > 0)`. A
vitrine não tem filtro equivalente.

## Por que virou visível agora

Até a issue 175, a ordem das categorias era a ordem de cadastro e o lojista não
tinha como mexer nela. Uma categoria vazia tendia a ficar no fim da lista, onde
incomoda pouco.

Com a reordenação, o lojista **posiciona deliberadamente** qualquer categoria em
qualquer lugar — e a categoria recém-criada, que é justamente a que ele quer
posicionar, nasce vazia. O caminho mais natural da feature nova (criar categoria,
promovê-la para o topo, depois cadastrar os produtos) produz exatamente um
cabeçalho solto no topo do cardápio.

Confirmado na verificação da 175: a loja de teste mostrou
`Entradas → Vazia → Pratos → Sobremesas` na vitrine anon, com "Vazia" sem nenhum
produto abaixo.

## Decisão a tomar

Não é óbvio qual é o certo — por isso é issue e não fix direto:

- **Esconder na vitrine.** Filtrar categoria sem produto visível. Simples, mas
  precisa considerar o que conta como "visível": produto `oculto` e produto
  `esgotado` são eixos distintos (RN-6 / issue 089). Categoria cujos produtos
  estão todos ocultos deve sumir; e se estiverem todos esgotados?
- **Mostrar com estado vazio.** Cabeçalho mais um "em breve" ou equivalente.
  Pode ser intencional para o lojista que quer anunciar uma seção que vem aí.
- **Avisar no painel.** Deixar a vitrine como está e sinalizar ao lojista, no
  modo reordenar, que aquela categoria não vai aparecer / vai aparecer vazia.

A terceira opção conversa melhor com a 175, que já rotula `0 produtos` no modo
reordenar.

## Escopo

- [ ] Decidir entre as três saídas (ou outra), considerando `oculto` x `esgotado`.
- [ ] Implementar na camada certa: se for esconder, decidir se o filtro fica na
      query (`buscarCategorias` / `agruparCatalogo`) ou na renderização — a query
      é compartilhada com o painel, que precisa das vazias para o modo reordenar.
- [ ] Teste cobrindo categoria com zero produtos, categoria só com produto
      oculto, e categoria só com produto esgotado.

## Critério de aceite

- [ ] O cardápio do cliente final não tem seção que não leva a lugar nenhum, ou
      tem um estado vazio deliberado e legível.
- [ ] O modo reordenar do painel continua enxergando as categorias vazias — a
      issue 175 depende disso (`ProdutosClient.tsx:130` e o contrato em
      `mockups/reordenar-categorias-painel.md`).

## Relacionada

- Issue 175 — tornou o caso alcançável e documenta por que o painel precisa
  enxergar categoria vazia.
