# Auditoria de performance — issue 159 (paralelizar leituras de `criarPedido`)

**Data:** 2026-09-07 · **Escopo:** `tasks/159-paralelizar-leituras-independentes-criarpedido.md`
**Branch:** `perf/159-paralelizar-leituras-criarpedido`
**Motivo (atípico):** esta auditoria NÃO procura gargalo — mede se a mudança já
implementada **ganhou alguma coisa**. A issue 159 é o output do finding 3 de
`performance/2026-09-06-criarpedido-whatsapphref.md`. Os demais gates (90/90 testes,
`revisar`, `auditar`) provam que o comportamento é idêntico; nenhum deles prova que
ficou mais rápido.

## Contexto

Arquivos lidos (completos):

- `src/lib/actions/pedido.ts` (pós-mudança; diff `git diff main...HEAD -- src/lib/actions/pedido.ts`)
- `src/lib/supabase/queries/entregaPagamento.ts` (`listarZonasComTaxas`, `listarFormasPagamento`, `buscarCupomPorCodigo`)
- `src/lib/supabase/queries/produtos.ts` (`buscarProdutosPorIds`, `buscarOpcionaisPorIds`, `buscarOpcionaisPorCategoria`)
- `src/lib/actions/distanciaFrete.ts` (`distanciaDaLojaAoCep` → `buscarCoordsLoja` + Nominatim)
- `src/lib/supabase/service.ts`
- `src/lib/actions/pedido.test.ts` (testes `[159-C1]`, `[159-C1b]`, `[159-C5]`, `[159-C5b]`)
- `supabase/migrations/20260614000129_schema_inicial.sql`, `20260614007500_opcionais.sql`,
  `20260614010000_indexes.sql`, `20260906120000_itens_pedido_pedido_id_idx.sql`
- `performance/2026-09-06-criarpedido-whatsapphref.md`

## Medições

Lighthouse **não executado**: a mudança é 100% server-side, em Server Action de POST —
não altera bundle, HTML nem asset da vitrine. Core Web Vitals não são o instrumento aqui.
`criarPedido` completo **não foi medido contra o cloud** (escreveria pedido real em
produção — trava explícita do escopo). O que dá para medir sem escrever nada é o custo
de cada leitura da onda, e é isso que está abaixo.

### `EXPLAIN (ANALYZE, BUFFERS)` em pglite — as 5 leituras do trecho

Ambiente: pglite (cadeia completa de migrations via bootstrap de `tests/helpers/pglite.ts`),
dataset sintético, `ANALYZE` antes de medir, plano sob `service_role` (BYPASSRLS — a role
real do caminho de pedido, então nenhuma política RLS entra no custo).

Dataset A: **500 lojas** (2.000 formas de pagamento, 1.500 zonas/taxas, 6.000 bairros,
15.000 produtos, 10.000 opcionais, 2.500 associações).
Dataset B: **4.000 lojas** (16.000 / 12.000 / 48.000 / 120.000 / 80.000 / 20.000).

| Leitura | plano | 500 lojas | 4.000 lojas |
|---|---|---|---|
| `listarFormasPagamento` (`where loja_id=`) | **Seq Scan** em `formas_pagamento` | 0,283 ms | **2,863 ms** |
| `buscarProdutosPorIds` (`id in`) | Bitmap Index Scan `produtos_pkey` | 0,256 ms | 0,297 ms |
| `buscarOpcionaisPorIds` (`id in`) | Bitmap Index Scan `opcionais_pkey` | 0,033 ms | 0,035 ms |
| `listarZonasComTaxas` (embed 1:1 + 1:N) | index em `zonas_entrega`, mas **Seq Scan** em `taxas_entrega` por zona | 0,794 ms | **3,216 ms** |
| `buscarOpcionaisPorCategoria` (`categoria_id in` + embed) | Bitmap Index Scan `categoria_produto_opcionais_categoria_id_categoria_opcional_key` | 0,245 ms | 0,293 ms |

Trechos que importam (dataset B):

```
-- listarFormasPagamento
Seq Scan on formas_pagamento (actual time=0.064..2.740 rows=4)
  Rows Removed by Filter: 15996          <-- varre as formas de TODAS as lojas

-- listarZonasComTaxas, SubPlan da taxa (1:1)
->  Seq Scan on taxas_entrega t (actual time=0.019..0.937 rows=1 loops=3)
      Rows Removed by Filter: 11999      <-- uma varredura completa POR ZONA
```

Ambas escalam com o volume **global** (todas as lojas), não com o da loja: 10x mais lojas
→ ~10x o tempo. As outras três são servidas por índice e são planas.

## Verificações do §9 do plano

### 1. Os round trips do caminho de sucesso caíram? — **SIM**

Contagem no código (`src/lib/actions/pedido.ts`), trecho entre o gate de loja (:72) e o
cálculo de frete (:234), carrinho **com** opcionais e produtos com categoria:

| | entrega | retirada |
|---|---|---|
| antes (main, em série) | 5 (`formas`, `produtos`, `opcionaisPorIds`, `opcionaisPorCategoria`, `zonas`) | 4 (sem `zonas`) |
| depois (`Promise.all` :110-117 + `opcionaisPorCategoria` :140) | **2** | **2** |

Bate com a contagem do `executar`. Ressalva de honestidade — a contagem dele vale para o
carrinho **com** opcionais; `buscarOpcionaisPorIds` faz `if (ids.length === 0) return []`
(`produtos.ts:149`), sem I/O. Carrinho **sem** opcionais: entrega 4 → 2, retirada 3 → 2.
Economia real, portanto, entre **1 e 3 round trips** conforme o carrinho, nunca negativa.

### 2. Retirada não regrediu — **SIM**

`pedido.ts:114-116`: `dados.tipo_entrega === "retirada" ? Promise.resolve<ZonaVitrine[]>([])
: listarZonasComTaxas(...)`. O ternário é avaliado **antes** de o array chegar ao
`Promise.all` — em retirada a função nunca é invocada; `Promise.resolve([])` é microtask,
zero I/O. O ramo `else` (:240) consome `zonasPreCarregadas` e não relê. Retirada sai de 4
(ou 3) para 2. Travado por `[159-C1]` (`pedido.test.ts:1715`) com a contraprova `[159-C1b]`
(:1737, `toHaveBeenCalledTimes(1)` no ramo entrega).

### 3. Nenhum `await` dentro do corpo do `Promise.all` — **SIM**

`pedido.ts:110-117`: os quatro elementos são chamada direta ou ternário sobre chamada
direta. Nenhum `await`, nenhuma IIFE `async`, nenhum `for`/`map` com `await` dentro da onda.
As chaves de busca (`ids` :104, `opcionalIds` :105-109) são derivadas do payload já validado
pelo zod, sem I/O, **antes** da onda. A onda é genuinamente concorrente.

**Veredito das três: passa. A mudança tem motivo para existir.**

## Ordem de grandeza do ganho

Premissa explícita: o custo dominante de cada leitura é o **round trip HTTPS
app→PostgREST**, não a execução SQL (que as medições acima colocam em 0,03-3,2 ms).
O repositório não fixa região (`vercel.json` inexistente, sem `regions` em `next.config`),
então valem dois cenários:

| Cenário | RTT/leitura | ganho (2 RTT, caso típico) | ganho (3 RTT, pior caso favorável) |
|---|---|---|---|
| app e Supabase co-localizados | 8-20 ms | **16-40 ms** | 24-60 ms |
| app e Supabase em regiões distintas (ex.: Vercel us-east ↔ Supabase sa-east-1) | 120-160 ms | **240-320 ms** | 360-480 ms |

Resposta direta a "20 ms ou 200 ms": **dezenas de ms se app e banco estiverem na mesma
região; algumas centenas se não estiverem.** É ganho real e determinístico (não é cauda),
mas de segunda ordem diante do finding 2 da auditoria anterior.

Ressalva de rede, sem impacto no veredito: `fetch` do Node (undici) não negocia HTTP/2 por
padrão, então a onda abre até 4 conexões TCP/TLS concorrentes em vez de reusar uma. Elas
são simultâneas, logo o custo de handshake não se soma — mas em processo frio a onda paga
4 handshakes paralelos em vez de 1. Continua melhor que 5 RTT em série. Efeito colateral de
capacidade, não de latência: no mesmo throughput de checkout, o pico de conexões simultâneas
ao pool do PostgREST quadruplica. Só vira problema em instância Supabase pequena sob pico.

## O novo gargalo da onda

A latência da onda agora é a da leitura mais lenta, e as medições dizem quais são:

### 1. CUSTO — `formas_pagamento(loja_id)` sem índice

`supabase/migrations/20260614000129_schema_inicial.sql:125-130` — a FK
`formas_pagamento_loja_id_fkey` não tem índice de suporte. `listarFormasPagamento`
(`entregaPagamento.ts:66-76`) faz `select * where loja_id = ?` → **Seq Scan sobre as formas
de pagamento de todas as lojas**. 0,28 ms a 500 lojas, **2,86 ms a 4.000** — linear no
número global de lojas. Mesma classe do finding 1 de 2026-09-06 (`itens_pedido`), e o
critério do agente é explícito: busca por `loja_id` deve ser servida por índice B-tree.

**Fix:** `create index if not exists formas_pagamento_loja_id_idx on public.formas_pagamento (loja_id);`

### 2. CUSTO — `taxas_entrega(zona_id)` sem índice

`supabase/migrations/20260614000129_schema_inicial.sql:109-115` — FK sem índice. O embed
`taxa:taxas_entrega(...)` de `listarZonasComTaxas` (`entregaPagamento.ts:46`) resolve com
**um Seq Scan de `taxas_entrega` por zona da loja** (`loops=3`, `Rows Removed by Filter:
11999` a 4.000 lojas). `bairros_zona(zona_id)` e `zonas_entrega(loja_id)` já têm índice
(`20260614010000_indexes.sql:25,29`); só a taxa ficou descoberta. É hoje a **leitura mais
cara da onda** (3,2 ms a 4.000 lojas) e, por ser o máximo, é ela que define o piso da onda
no ramo entrega. Afeta também a vitrine pública (`/loja/[slug]` lê zonas no SSR do checkout).

**Fix:** `create index if not exists taxas_entrega_zona_id_idx on public.taxas_entrega (zona_id);`

**Nenhum dos dois é problema desta issue** — ambos preexistem à 159 e valiam o mesmo antes.
A 159 só os tornou visíveis: em série eles se somavam a três outros custos e não se
destacavam; em paralelo eles *são* o custo. Issue nova, não bloqueio do merge.

### 3. POLIMENTO — `buscarOpcionaisPorCategoria` é a segunda onda inteira, mesmo sem opcionais

`pedido.ts:133-140` — `categoriaIds` sai de `produtos`, não dos opcionais escolhidos, então
a allowlist é lida **em todo pedido cujos produtos tenham categoria**, inclusive quando o
carrinho não tem nenhum opcional. Ela só é usada em `permitidas` (:177-182), consumido
apenas dentro do laço `for (const escolhido of item.opcionais ?? [])` (:186-205) — que não
executa quando não há opcionais. Como é a única leitura depois da onda, eliminá-la nesse
caso levaria a profundidade de **2 para 1** justamente no carrinho mais comum.

**Fix:** `const allowlistPorCategoria = opcionalIds.length === 0 ? {} : await buscarOpcionaisPorCategoria(svc, categoriaIds);`
Trivial e sem mudança de semântica, mas fora do escopo declarado da 159 (a issue congelou os
args da RPC, não o número de leituras da segunda onda) — issue separada.

## Calibração contra a issue 158

`performance/2026-09-06-criarpedido-whatsapphref.md` §2 mede o dono real do p95 do checkout:
`reconciliarBairroCep` (ViaCEP, timeout 3 s) e `distanciaDaLojaAoCep` (Nominatim, timeout 5 s,
atrás de trava global de 1 req/s) em série em `pedido.ts:261-280` — pior caso somado **8 s**,
uma ordem de grandeza acima. A 159 economiza dezenas a poucas centenas de ms de RTT interno;
a 158 tira até ~4 s do pior caso e uma ida à internet pública do caminho crítico.

Depois da 159, a cadeia serial do ramo entrega ainda é: `loja` → **onda** →
`opcionaisPorCategoria` → **ViaCEP** → `buscarCoordsLoja` → **Nominatim** → `cupom` → RPC →
releitura. Nove hops, dos quais os dois externos concentram a cauda. **A 159 vale como
higiene de latência mediana; a 158 é a que move o p95.** Ordem de ataque correta é
158 primeiro; a 159 já está feita e não conflita com ela.

Nota para a 158, gratuita daqui: `distanciaDaLojaAoCep` embute `buscarCoordsLoja`, uma
leitura Supabase que depende só de `loja_id` e poderia entrar na mesma onda da 159 —
paralelizando um round trip interno junto com os dois externos.

## Findings

| # | Severidade | Local | Status |
|---|---|---|---|
| 1 | CUSTO | `formas_pagamento(loja_id)` sem índice (`schema_inicial.sql:125`) | issue separada (preexiste à 159) |
| 2 | CUSTO | `taxas_entrega(zona_id)` sem índice (`schema_inicial.sql:109`) | issue separada (preexiste à 159) |
| 3 | POLIMENTO | `buscarOpcionaisPorCategoria` lida sem opcionais no carrinho (`pedido.ts:140`) | issue separada |

Nenhum finding contra o diff da 159. As três verificações do §9 passam.

**Veredito: `ok: true`.** A mudança colapsa 3 (com opcionais) ou 2 (sem) round trips no
ramo entrega e 2 ou 1 no ramo retirada, não regride retirada, e não serializa a onda.
Ganho real, de segunda ordem. Não reverter.
