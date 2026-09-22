# [292] `reordenarProdutosAdmin` escreve por `for` de UPDATEs, sem atomicidade

**crítica: NÃO** — não é dinheiro nem RLS quebrada (o escopo por `loja_id` continua valendo).
É falha de consistência: uma falha no meio do loop deixa parte dos produtos reordenados e
parte não, sem forma de o admin saber qual parte. TDD red-first não é obrigatório para
corrigir, mas a regressão que prova o bug atual (e o fix) deve nascer vermelha, já que mexe em
escrita de produção.

**Depende de:** nada diretamente, mas fica **mais visível** depois da issue 293 (drag-and-drop
para o lojista), porque aquela introduz a RPC atômica `reordenar_produtos` que deveria ser o
modelo aqui também.

## Origem

Achado do agente `orquestrar` ao planejar a issue 293. Confirmado em
`supabase/migrations/`: as três reordenações do caminho **lojista** (categorias, opcionais da
categoria, itens do grupo de opcional) são todas RPCs Postgres atômicas. O cabeçalho da
migration `20260917121000_rpc_reordenar_opcionais_da_categoria.sql` documenta a doutrina do
projeto:

> PostgREST não faz update-many com valor DIFERENTE POR LINHA; `.upsert()` reescreveria a LINHA
> INTEIRA; N updates sequenciais não são atômicos.

## O problema

`reordenarProdutosAdmin` (`src/app/admin/assinantes/actions/admin-produtos.ts:277-306`) é o
único dos quatro fluxos de reordenação do projeto que **não** segue essa doutrina: ele itera
`ordem` num `for` e faz um `escopo.atualizar("produtos", o.id, { ordem: o.ordem })` por
iteração. Se a conexão cair ou um UPDATE falhar no meio do loop, os produtos já processados
ficam com a `ordem` nova e os restantes com a antiga — estado misto, sem transação para
reverter.

Isso diverge das três RPCs irmãs e do padrão que a issue 293 estabelece para o lojista
(`reordenar_produtos`, `security invoker`, permutação completa verificada dentro da transação).

## Correção proposta

Depois que a issue 293 estiver mesclada e a RPC `reordenar_produtos` existir no banco, trocar o
corpo de `reordenarProdutosAdmin` para chamar a mesma RPC via `service_role` (que já é
`security invoker` — funciona igual para admin, só troca o client), em vez do `for` de UPDATEs.
Teste de regressão: falha simulada no meio de uma reordenação de N>1 produtos não deve deixar
nenhum produto com `ordem` alterada.

**Não tocado pela refat de `plan/loop-refat-linha-de-produto.md`** — reescrever
`reordenarProdutosAdmin` ali seria correção não pedida pelo usuário, que já rejeitou mudança
fora de escopo uma vez nesta mesma tela.
