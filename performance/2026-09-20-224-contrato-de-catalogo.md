# 2026-09-20 — issue 224 (contrato de catálogo) + o custo da view da 265

Escopo: vitrine pública `/loja/[slug]` na branch `feat/promocoes-nucleo-monetario`.
Pergunta que originou a auditoria: a troca da tabela `produtos` (policy
`produtos_leitura_publica`) pela view definer `public.vitrine_produtos`
(`security_barrier = true`, `desconto_vigente()` 5× por linha) pagou o preço?

## Contexto

Arquivos lidos por inteiro:

- `src/app/(publica)/loja/[slug]/page.tsx`
- `src/lib/utils/catalogoVitrine.ts`, `src/lib/utils/precoEfetivo.ts`
- `src/lib/utils/formatarMoeda.ts`, `src/lib/utils/arredondar.ts`
- `src/lib/supabase/queries/produtos.ts`
- `supabase/migrations/20260920124000_vitrine_produtos_view.sql`
- `supabase/migrations/20260920124500_views_publicas_security_barrier.sql`
- `supabase/migrations/20260614002000_rls_catalogo.sql` (`loja_esta_ativa`)
- `supabase/migrations/20260614010000_indexes.sql`

Baseline consultada: `performance/2026-09-16-vitrine-checkout-retorno-pedido.md`
(F1–F4 já aplicados; F5 parcialmente resolvido por esta issue; F6/F7 abertos).

Estado do cloud no momento da medição (`npx supabase migration list`):
`20260920124000` e `20260920124500` **aplicadas**; `20260920125000`
(`drop policy`, CONTRACT) ainda só-local — o que permitiu um A/B real
view × tabela no mesmo banco, com o mesmo dado.

## Medições

### 1. A/B contra o Supabase cloud — loja real `lanches-base`, 68 produtos

Requisições intercaladas (25 rodadas alternadas A/B, para não medir drift de
rede), anon, mesmas 14 colunas, `order=ordem.asc`:

| leitura | mediana | mínimo | bytes |
|---|---|---|---|
| `vitrine_produtos` (pós-265) | **40,6 ms** | 35,2 ms | 30.338 |
| `produtos` + policy antiga, 14 colunas | **38,9 ms** | 34,4 ms | 30.338 |
| `produtos?select=*` (pré-265) | 39,7 ms | 31,4 ms | **38.008** |

→ custo da view: **+1,7 ms na mediana (+0,8 ms no mínimo) em 68 linhas** — ~4 %
de uma query cujo termo dominante é o RTT (~35 ms).
→ ganho da projeção nomeada: **−7.670 B (−20 %)** no fio PostgREST→servidor.
Uma rodada anterior NÃO intercalada deu +16 ms; era drift de rede, e está
registrada aqui só para que ninguém repita a medição errada.

### 2. `EXPLAIN ANALYZE` em pglite — 6.000 produtos, 40 lojas, 150 por loja

Plano da view sob `anon`, mediana de 5 execuções (`timing off`):

```
Sort (Sort Key: p.ordem, quicksort 29kB)
  -> Bitmap Heap Scan on produtos p
       Recheck Cond: (loja_id = '...'::uuid)
       Filter: ((NOT oculto) AND loja_esta_ativa(loja_id))
       -> Bitmap Index Scan on produtos_loja_disponivel_ordem
            Index Cond: (loja_id = '...'::uuid)
```

| variante (150 linhas) | mediana |
|---|---|
| tabela + predicado da policy antiga | 1,31 ms |
| idem, sem `loja_esta_ativa` (dimensiona a função pré-existente) | 0,23 ms |
| view **sem** `security_barrier` | 4,56 ms |
| view **com** `security_barrier` (produção) | **5,63 ms** |
| view com `desconto_vigente` chamada 1× por linha (subselect) | 4,04 ms |
| view com `desconto_vigente` **sem `set search_path`** (inlinável) | **1,48 ms** |

`select proleakproof, procost, prosecdef from pg_proc`:
`uuid_eq` → leakproof, cost 1 · `loja_esta_ativa` → NÃO leakproof, cost 100,
secdef · `desconto_vigente` → NÃO leakproof, cost 100.

Leituras:

- **O `security_barrier` NÃO custou o índice.** `uuid_eq` é leakproof, então
  `loja_id = $1` continua descendo como *Index Cond*. O medo de varrer o
  catálogo de todas as lojas antes de filtrar o tenant não se materializou.
- O barrier em si custa ~1,1 ms/150 linhas (19 %) — é o menor dos três termos.
- O termo dominante é `desconto_vigente` **não ser inlinada**: `set search_path`
  preenche `proconfig`, e `inline_function()` recusa qualquer função com
  `proconfig`. Sem isso a view custaria 1,48 ms — praticamente a policy antiga.
  Reduzir de 5 chamadas para 1 recupera só 1,6 dos 4,2 ms: o problema é o
  *inlining*, não a contagem.

### 3. Payload

- RSC de `/loja/lanches-base` (`next start`, header `RSC: 1`): **72.477 B**;
  HTML **164.092 B**; TTFB quente 45–80 ms.
- Delta da 224 no payload RSC: **zero por construção.** O adaptador de
  `page.tsx:203-215` serializa os MESMOS 8 campos de antes (`disponivel:
  p.compravel` é o mesmo boolean); `precoEfetivo`, `seloDesconto`, `temDesconto`
  e `motivoNaoCompravel` morrem no servidor. Quem vai mexer nisso é a 225.
- JSON de 150 produtos em pglite: `select *` 97.344 B → 14 colunas da view
  81.294 B (−16,5 %).

### 4. CPU da projeção

`projetarProdutoVitrine` × 200 produtos: **0,051 ms** (mediana de 20, após
warmup). `formatarMoeda` e o formatador de percentual são `Intl` de módulo — não
há alocação por linha.

### 5. Não executado

- Lighthouse: Chrome existe (`/usr/bin/google-chrome`), mas LCP/INP/CLS da
  vitrine dependem de `tasks/205` (imagens `unoptimized`), que já é achado
  conhecido e não é da 224. Não medido nesta auditoria.
- `next build` roda verde; a tabela de rotas do Next 16 não imprime mais bytes
  por rota, e `catalogoVitrine.ts`/`precoEfetivo.ts` só têm importador servidor
  (`page.tsx`, `derivarBasesCupom.ts`) — zero delta de bundle cliente.

## Findings

### P1 — POLIMENTO — `set search_path` em `desconto_vigente` impede o inlining
`supabase/migrations/20260920124000_vitrine_produtos_view.sql:97-110`

Custo medido: +4,2 ms por 150 linhas em pglite; **+1,7 ms na mediana** contra o
cloud com 68 produtos (~4 % da query). Fix seria de uma linha (remover
`set search_path = public` da função, que não referencia nenhum objeto
não-qualificado — só `coalesce` e comparações de `boolean`/`timestamptz`), ou
escrever o predicado literal dentro da view.

**Recomendação: NÃO fazer agora.** O ganho está abaixo da variância de rede da
própria query, e as duas formas têm contrapartida: remover o `search_path`
contraria a regra de função-com-search_path do projeto (e acende o linter do
Supabase), e inlinar o predicado na view cria a segunda fonte do RN-03 que a
265 evitou de propósito. Fica registrado com número para que, se uma migration
futura tocar a função (244/245), a decisão seja tomada com medida — e para que a
frase "chamá-la cinco vezes por linha custa o mesmo que a policy que substitui"
do comentário da migration seja lida como o que ela é: ~4× o tempo de CPU da
policy, ~4 % do tempo da query.

### P2 — POLIMENTO — `_promocionais` é uma passada O(n) por um valor descartado
`src/app/(publica)/loja/[slug]/page.tsx:181`

```ts
const _promocionais = produtosVitrine.filter((p) => p.temDesconto);
```

Ninguém consome (233/234 vão consumir). Custo real: desprezível (a projeção
inteira de 200 produtos custa 0,051 ms). É dead code, não achado de performance
— fica aqui só porque foi visto. Encaminhado ao `revisar`.

### Não-achados (verificados, dentro do orçamento)

- **Índice de tenant: existe e é usado.** `produtos_loja_disponivel_ordem
  (loja_id, disponivel, ordem)` serve o `loja_id = $1` como *Index Cond* mesmo
  com `security_barrier`. Não falta índice.
- **O `Sort` sobreviveria a um índice `(loja_id, ordem)`?** Sim, sumiria — e o
  ganho é o quicksort de 29 kB / 143 linhas, sub-milissegundo. Não vale o índice
  a mais (escrita do painel paga por ele). **Não fazer.**
- **N+1: nenhum.** Uma query de produtos, uma de categorias (em `Promise.all`),
  uma de opcionais. Nenhum `await` dentro de `map`/loop.
- **Payload: a 265 reduziu**, a 224 não mexeu. Ver §3.
- **Dado vivo cacheado: não existe.** `disponivel`, gate de assinatura e a
  vigência da promoção são avaliados por request; a rota é `ƒ`, sem
  `revalidate`/`'use cache'`/`unstable_cache`. Contrato respeitado — e
  **cache do catálogo segue proibido**: com `desconto_fim` avaliado por request,
  qualquer ISR serve promoção expirada.

### Herdados, ainda abertos (não são achados desta auditoria)

- `tasks/205` — imagens de produto `unoptimized`, sem `sizes`: continua sendo o
  termo dominante do LCP da vitrine.
- F6 de 2026-09-16 — `ProdutoModal` estático no bundle
  (`src/components/vitrine/SecaoCatalogo.tsx:8`), sem `dynamic()`.
- 3º round-trip dos opcionais (`page.tsx:189`): depende de `categoriaIds`, que
  só existe depois do agrupamento. Já estava aceito em F4; `buscarOpcionais
  PorCategoriaDaLoja` também exige `categoriaIds`, então não há atalho pronto.

## Status

Nenhum fix aplicado (auditoria é diagnóstico). P1 e P2 são opcionais; nenhum
GARGALO e nenhum CUSTO. **A troca da tabela pela view pagou o preço:** +1,7 ms
de CPU de banco em troca de −7,7 kB no fio e da coluna sensível fora do alcance
do anon.
