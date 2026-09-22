# [293] Drag-and-drop para ordenar produtos no painel

**crítica: SIM** — não por dinheiro, mas por autorização/RLS. TDD red-first obrigatório: teste
vermelho em `tests/migrations/` via pglite, antes de qualquer código de produção, com output
`FAIL` capturado e colado.

**Depende de:** PR 1 (edição inline de nome/preço + reposicionamento visual, mesclado). Roda no
mesmo `ProdutosClient.tsx`, mas em branch e PR separados por causa do deploy de migration.

## Origem

Pedido direto do usuário. Diagnóstico completo (terreno pronto, o achado que muda o plano,
molde exato) levantado pela sessão principal e conferido pelo agente `orquestrar`. Plano
completo em `plan/loop-refat-linha-de-produto.md` (fatia B, passos 9-15).

## O problema

Hoje o lojista não pode reordenar produtos dentro de uma categoria — só reordenar categorias
(botão "Reordenar categorias"). O terreno de UI já existe:

- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` já em `package.json`.
- `src/components/painel/ModoReordenar.tsx` é genérico e `ProdutosClient.tsx` já o importa —
  hoje ligado só à reordenação de categorias.
- `ReordenarCategorias.tsx`, `ReordenarItensDoGrupo.tsx`, `ReordenarOpcionaisDaCategoria.tsx`,
  `LinhaCategoriaReordenavel.tsx` são exemplos já construídos e testados do mesmo padrão.
- `src/lib/utils/reordenar.ts` (util puro) já existe, com teste.
- `reordenarProdutosAdmin` (`src/app/admin/assinantes/actions/admin-produtos.ts:277`) já
  existe do lado admin.

**O que falta é a Server Action do lojista — e ela não pode ser um clone do que existe do lado
admin.**

## O achado que muda a abordagem

`reordenarProdutosAdmin` escreve num `for` de UPDATEs sequenciais — **não é atômico**. As três
reordenações do caminho lojista (categorias, opcionais da categoria, itens do grupo de
opcional) são todas **RPCs Postgres atômicas**. O cabeçalho de
`supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql` documenta a
doutrina do projeto:

> PostgREST não faz update-many com valor DIFERENTE POR LINHA; `.upsert()` reescreveria a LINHA
> INTEIRA; N updates sequenciais não são atômicos.

E `reordenarCategorias` (`src/lib/actions/produto.ts:409`) documenta que um pre-check de posse
em JS seria TOCTOU — a prova de permutação completa precisa viver **dentro** da transação.

Logo: **`reordenarProdutosAdmin` é o outlier**, não o modelo a seguir (é o débito registrado em
`tasks/292`, fora de escopo aqui). Fazer certo para o lojista significa uma **migration nova**
com uma RPC `security invoker`, e isso implica `npx supabase db push` (irreversível,
autorização humana) + `npx supabase gen types`.

**Modelo exato a clonar:** `reordenar_opcionais_da_categoria`, não `reordenar_categorias` —
porque lá o escopo da permutação é o **par (loja, categoria pai)**, e é exatamente o caso dos
produtos: a lista de `/painel/produtos` é agrupada por categoria
(`src/lib/supabase/queries/produtos.ts:127-147`) e ordenada por `ordem` dentro do grupo. Não há
`unique` em `produtos(categoria_id, ordem)`; o índice existente
(`produtos_loja_disponivel_ordem` sobre `loja_id, disponivel, ordem`) é de leitura, não
invariante.

## Wrinkle a resolver no desenho da RPC (nomeado aqui para não virar surpresa)

Existe o grupo **"Sem categoria"** (`categoria_id IS NULL`). Um parâmetro `p_categoria_id uuid`
com `NULL` **não casa por `=`** — a contagem da permutação e o `WHERE` do UPDATE precisam usar
`IS NOT DISTINCT FROM`, senão reordenar esse grupo falha em silêncio (zero linhas afetadas
tratado como sucesso) ou levanta exceção de contagem por engano.

## Decisões de escopo (declaradas, não abertas a reinterpretação)

- **Reordenar produtos é um segundo modo**, irmão do `modoReordenar` de categorias, escopado a
  **uma categoria por vez** (o lojista entra no modo a partir do cabeçalho da categoria). Casa
  com a RPC parent-scoped e evita inventar semântica de ordem global que o schema não tem.
- `podeReordenar` do novo modo é `produtos da categoria >= 2`, espelhando o mesmo critério do
  modo de categorias.
- `reordenarProdutosAdmin` **não é reescrito nesta issue** — isso é `tasks/292`, correção não
  pedida pelo usuário para esta refat.
- Contrato `AcoesProdutosClient` ganha a chave `reordenarProdutos` nas duas variantes; a
  variante admin liga a chave nova à `reordenarProdutosAdmin` que já existe (não à RPC nova).

## Assinatura da RPC (contrato que o RED assume)

```sql
reordenar_produtos(p_loja_id uuid, p_categoria_id uuid, p_ids uuid[])
```

- `security invoker` (nunca `DEFINER` — ver por quê abaixo).
- `cardinality()` para contagem (nunca `array_length`, que trata array vazio como `NULL`).
- `coalesce` cobrindo `p_ids` NULL.
- Permutação completa do par `(loja_id, categoria_id)` com `IS NOT DISTINCT FROM` no grupo sem
  categoria.
- `ordem = ordinality - 1` derivada **no servidor** — o cliente manda só a sequência de ids,
  nunca valores de ordem nem `loja_id`.
- `row_count` conferido com `raise` que derruba a transação inteira se a contagem não bater.
- Mensagem de erro: `'reordenar_produtos: % ids, % linhas afetadas'` — fragmento literal que o
  teste afirma, com cardinalidades distintas entre lojas de teste, para não passar por
  acidente aritmético.
- Bloco de **rollback** no cabeçalho da migration, como as três RPCs irmãs.

## Por que `security invoker`, não `security definer`

A RPC é `security invoker` e `p_loja_id` é parâmetro escolhido pelo chamador. O cabeçalho da
RPC irmã (`20260917121000`) diz, sobre si mesma: sob `DEFINER`, "um lojista reescreveria a
ordem de OUTRA loja só trocando o argumento". Sob `invoker`, a RLS do chamador autenticado
decide quais linhas o UPDATE efetivamente alcança — se o lojista tentar `p_loja_id` de outra
loja, a RLS faz o UPDATE não ver nenhuma linha, `row_count` diverge do esperado, e a transação
é derrubada.

## Plano de teste (RED antes de qualquer SQL de produção)

Em `tests/migrations/reordenar-produtos.test.ts`, via `createTestDb()`:

(a) permutação válida grava `0..n-1` e devolve a contagem certa;
(b) id de **outra loja** na lista derruba a transação e **nada** é escrito em nenhuma das duas
    lojas — afirmando o **fragmento literal** da mensagem de erro, com cardinalidades
    **distintas** entre as duas lojas (não aceitar SQLSTATE ou boolean genérico como prova —
    trava de escopo passa por acidente aritmético);
(c) lista **incompleta** (subconjunto dos produtos da categoria) é recusada;
(d) id **duplicado** na lista é recusado;
(e) `p_ids` **vazio** e **NULL** são recusados;
(f) o grupo **`categoria_id IS NULL`** ("Sem categoria") reordena corretamente;
(g) sob `asUser` de outro dono (não o dono da loja), a RLS faz o UPDATE não ver a linha →
    `row_count` diverge → recusa.

Gate: `FAIL` colado + `git diff --stat` só com arquivo de teste antes de qualquer SQL.

**Honestidade sobre o primeiro vermelho:** com a função inexistente, o primeiro `FAIL` é
genérico e igual para todos os casos (`function reordenar_produtos does not exist`). O valor do
red-first aqui não é a granularidade do primeiro erro — é que o teste nasce desta
especificação, não de uma implementação já vista. Os casos se diferenciam conforme a RPC é
escrita, e é aí que (b), (f) e (g) provam o que realmente importa.

## Gate de deploy (irreversível, autorização humana obrigatória)

Depois do GREEN (SQL + cliente TypeScript, suíte e build verdes): pedir autorização explícita
para `npx supabase db push`. Depois, `npx supabase gen types typescript >
src/lib/database.types.ts`, commit dos tipos, e `npx supabase migration list` confirmando a
coluna **Remote preenchida** para a migration nova — sem isso, `PGRST204` em runtime com build
verde.
