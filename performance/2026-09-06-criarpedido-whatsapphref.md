# Auditoria de performance — issue 125 (`criarPedido` devolve `whatsappHref`)

**Data:** 2026-09-06 · **Escopo:** `tasks/125-criarpedido-retorna-whatsapphref.md`
**Motivo:** a issue adiciona uma leitura extra (`buscarPedidoPorToken`) no caminho
crítico do checkout público (`criarPedido`), mobile-first, sem auth.

## Contexto

Arquivos lidos (completos):

- `src/lib/actions/pedido.ts` (diff da 125: +29/-2, bloco `(9) whatsappHref`, linhas 346-366)
- `src/lib/supabase/queries/pedidos.ts` (`buscarPedidoPorToken`, `SELECT_PEDIDO_COM_ITENS`)
- `src/lib/supabase/queries/lojas.ts` (`buscarLojaParaPedido`)
- `src/lib/utils/whatsappPedido.ts` (`montarLinkWhatsappPedido`)
- `src/lib/utils/reconciliarBairroCep.ts`, `src/lib/actions/distanciaFrete.ts`
- `src/components/vitrine/checkout/useEnviarPedido.ts` (único caller client)
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx`
- `supabase/migrations/20260614000129_schema_inicial.sql`,
  `20260614007500_opcionais.sql`, `20260614009500_rpc_criar_pedido_idempotencia.sql`,
  `20260614010000_indexes.sql`
- `references/schema.md`, `references/architecture.md`

## Medições

Ambiente: Supabase local (postgres 17.6), dataset sintético de **50.000 pedidos /
150.000 `itens_pedido` / 150.000 `itens_pedido_opcionais`** em uma loja, após `ANALYZE`.
Query medida = shape que o PostgREST gera para
`select=*,itens_pedido(*,itens_pedido_opcionais(*))&id=eq.…&token_acesso=eq.…`
(o `SELECT_PEDIDO_COM_ITENS` de `buscarPedidoPorToken`).

### `EXPLAIN (ANALYZE, BUFFERS)` — antes do fix

```
Index Scan using pedidos_pkey on pedidos p (actual time=11.251..11.254 rows=1)
  Buffers: shared hit=1420
  SubPlan 2
    ->  Aggregate (actual time=11.203..11.204 rows=1)
          ->  Seq Scan on itens_pedido ip (actual time=0.030..10.956 rows=3)
                Filter: (pedido_id = p.id)
                Rows Removed by Filter: 149997          <-- varre a tabela inteira
                Buffers: shared hit=1402
          SubPlan 1
            ->  Index Scan using itens_pedido_opcionais_item_pedido_id_idx (loops=3)
Execution Time: 11.445 ms
```

### `EXPLAIN (ANALYZE, BUFFERS)` — depois do fix (índice em `itens_pedido(pedido_id)`)

```
Index Scan using pedidos_pkey on pedidos p
  Buffers: shared hit=18 read=3
  SubPlan 2
    ->  Bitmap Heap Scan on itens_pedido ip (actual time=0.020..0.023 rows=3)
          ->  Bitmap Index Scan on itens_pedido_pedido_id_idx (rows=3)
Execution Time: 0.157 ms
```

**11,445 ms → 0,157 ms (~73x). Buffers 1420 → 21.**

### Ponta a ponta via PostgREST (12 amostras, `curl -w time_total`, ms)

| | mín | mediana | p95 |
|---|---|---|---|
| sem índice | 11,5 | 12,5 | 16,7 |
| com índice | 1,5 | 2,4 | 5,7 |

### Payload

- Resposta de `buscarPedidoPorToken` (pedido de 3 itens c/ opcionais): **1.673 bytes**.
- `whatsappHref` acrescentado ao retorno da Server Action: ~600-700 bytes
  (mensagem `encodeURIComponent`). Uma resposta por pedido, comprimida na rede.
  Dentro do orçamento.

### Bundle do cliente

`VERIFY_DIST_DIR=.next-acelerar npm run build` — **exit 0**, "Compiled successfully in
81s", 23/23 páginas geradas, tabela de rotas idêntica (nenhuma rota nova; `/loja/[slug]`
e `/loja/[slug]/confirmacao` seguem `ƒ` dinâmicas). O Next 16.2 desta versão não emite a
coluna "First Load JS" por rota, então o veredito de bundle é pelo **grafo de imports**,
não por número inventado: `src/lib/actions/pedido.ts` é `"use server"`;
`src/lib/utils/whatsappPedido.ts` é importado **apenas** por módulos de servidor
(a própria action e `confirmacao/page.tsx`, que é Server Component). O único caller
client (`useEnviarPedido.ts`) apenas recebe um campo a mais no objeto de retorno —
**zero byte novo no bundle do cliente**. Confirmado.

(Build rodado com `distDir` isolado — havia `next dev --turbopack` de outros agentes
escrevendo em `.next/` em paralelo; builds concorrentes sobre o mesmo dist se matam.
`.next-acelerar` removido ao fim.)

## Findings

### 1. GARGALO — `itens_pedido(pedido_id)` sem índice

`supabase/migrations/20260614000129_schema_inicial.sql:156` — a FK
`itens_pedido_pedido_id_fkey` nunca teve índice de suporte (o Postgres não cria um
automaticamente). Todo embed `itens_pedido(*)` de `SELECT_PEDIDO_COM_ITENS` resolvia
com **Seq Scan sobre a tabela `itens_pedido` inteira** — todas as lojas, todos os
pedidos, custo crescendo linearmente com o volume global. A tabela-neta
`itens_pedido_opcionais` já tinha o índice equivalente (20260614007500); só o nível
do meio estava descoberto.

**Por que a 125 torna isso urgente:** ela põe essa leitura no caminho crítico do
checkout, e `lojas.whatsapp_envio_automatico` tem `default true`
(`20260704120000_lojas_whatsapp_envio_automatico.sql:38`) — a maioria das lojas passa
a pagar a varredura em **cada pedido criado**.

**Impacto medido:** 11,4 ms → 0,16 ms de execução; 12,5 ms → 2,4 ms ponta a ponta,
a 150k itens. A 1,5M itens seria ~10x pior antes do fix e igual depois.

**Status: CORRIGIDO NO CICLO.** `supabase/migrations/20260906120000_itens_pedido_pedido_id_idx.sql`
(`create index if not exists itens_pedido_pedido_id_idx on public.itens_pedido (pedido_id)`).
Cadeia de migrations verificada com `supabase db reset` (aplica limpo, índice presente).
Registrado em `references/schema.md` §3. Beneficia também `listarPedidosDoDono`
(painel), `buscarPedidoDoDono`, `listarPedidosDaLoja`/`buscarPedidoDaLoja` (hub admin)
e a página de confirmação — todos usam a mesma projeção.

### 2. CUSTO — I/O externa serializada no ramo `entrega` (fora do diff da 125)

`src/lib/actions/pedido.ts:229-248` — `reconciliarBairroCep` (fetch ViaCEP, timeout 3s)
e `distanciaDaLojaAoCep` (`buscarCoordsLoja` + `geocodificarEndereco` → Nominatim,
timeout 5s, atrás de trava global de 1 req/s) rodam **em sequência**, e ambos só
dependem de `endereco.cep` — são independentes entre si. Nenhum resultado alimenta o
outro (`enderecoAutoritativo` só combina os dois no final).

Esse é o verdadeiro dono do p95 do checkout: duas idas à internet pública em série,
com pior caso somado de 8s, contra os ~2 ms da releitura da 125.

**Fix sugerido:** `Promise.all([reconciliarBairroCep(...), distanciaDaLojaAoCep(...)])`.
Ambas são fail-closed com try/catch total e nunca lançam, então a semântica se
preserva. Ganho: um dos dois RTT externos some do caminho crítico.

**Status: ISSUE SEPARADA** (fora do escopo da 125, mexe no cálculo de frete —
caminho monetário, exige teste próprio).

### 3. CUSTO — leituras de catálogo serializadas em `criarPedido` (fora do diff da 125)

`src/lib/actions/pedido.ts:89, 96, 107, 208` — `listarFormasPagamento`,
`buscarProdutosPorIds`, `buscarOpcionaisPorIds` e `listarZonasComTaxas` são quatro
round trips **sequenciais** ao Supabase que não dependem uns dos outros (só
`buscarOpcionaisPorCategoria`, linha 117, depende de `produtos`). Em rede real são
~4x o RTT app→Supabase em série.

**Fix sugerido:** uma onda `Promise.all` com as quatro, mantendo
`buscarOpcionaisPorCategoria` na onda seguinte. Cuidado: hoje o `return` antecipado de
forma de pagamento inválida (linha 90) evita as leituras seguintes; paralelizar troca
essa economia do caminho de erro por latência menor no caminho de sucesso — troca boa,
mas é decisão explícita.

**Status: ISSUE SEPARADA.**

## Vereditos pedidos

**A guarda antes do I/O funciona?** Sim — `loja.whatsapp_envio_automatico === true &&
loja.whatsapp` (linha 356) é avaliado antes do `await`, e nenhuma loja com a flag
desligada paga a query. Mas o `default true` da coluna significa que a guarda **não
protege o p95 agregado**: a maioria paga. Por isso o fix que importava era o índice,
não a guarda.

**`buscarPedidoPorToken` faz N+1?** Não. É **uma** requisição PostgREST → **uma**
instrução SQL. O `SubPlan 1` com `loops=3` é subplano correlacionado dentro da mesma
instrução, servido por índice (0,06 ms para 3 itens) — não é N+1 de aplicação.

**Vale estender a RPC `criar_pedido` para devolver o pedido completo?** **Não agora.**
Com o índice aplicado, a releitura custa 0,16 ms de banco; o que sobra é **um** RTT
app→Supabase (~2 ms local, 5-25 ms em produção). Em troca, mexer na RPC exige
`DROP`+`CREATE` da função (a migration 20260614009500 documenta por que aridade nova
não pode virar overload), mudar `returns table` para carregar o pedido + itens +
opcionais em JSONB, e reescrever os testes da única transação atômica que garante
dinheiro e trava de cupom. Risco alto no caminho monetário por um ganho que é ~1/10
do que os findings 2 e 3 rendem sem tocar em SQL transacional. **Manter como
otimização futura**; reavaliar só se a medição de produção mostrar o RTT ao Supabase
dominando o checkout depois que 2 e 3 estiverem feitos.

**Dá para paralelizar a releitura?** Não a releitura em si — ela é causalmente
posterior à RPC (precisa do `pedido_id`/`token_acesso` gravados, e o ponto da issue é
justamente ler o estado autoritativo pós-transação). O que é paralelizável está
*antes* dela: findings 2 e 3.

**Bundle do cliente:** zero. Ver §Medições.

## Resumo

| # | Severidade | Local | Status |
|---|---|---|---|
| 1 | GARGALO | `itens_pedido(pedido_id)` sem índice | corrigido no ciclo (migration 20260906120000) |
| 2 | CUSTO | ViaCEP + Nominatim em série (`pedido.ts:229-248`) | issue separada |
| 3 | CUSTO | 4 queries de catálogo em série (`pedido.ts:89-208`) | issue separada |

A releitura introduzida pela issue 125, **com o índice aplicado**, custa ~2 ms ponta a
ponta e está dentro do orçamento do checkout. Sem o índice, não estaria.
