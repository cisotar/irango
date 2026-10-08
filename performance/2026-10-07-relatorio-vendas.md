# Auditoria de performance: relatório de vendas (issues 353 a 358)

**Data:** 2026-10-07 · **Escopo:** relatório de vendas (painel `/painel/vendas` e hub admin `/admin/assinantes/[lojaId]/vendas`)
**Branch:** `feat/relatorio-vendas` · **Resultado:** `ok: true` (nenhum GARGALO; 1 CUSTO, 1 POLIMENTO)

## Contexto

Arquivos lidos (completos):

- Migrations: `20261007120000_itens_pedido_categoria_snapshot.sql`, `20261007121000_rpc_criar_pedido_categoria_snapshot.sql`,
  `20261007122000_itens_pedido_categoria_backfill.sql`, `20261007123000_lojas_dia_inicio_ciclo.sql`,
  `20261007124000_relatorio_vendas_funcoes.sql`, `20261007125000_ranking_clientes_fieis.sql`
- Políticas RLS de leitura em `pedidos`, `itens_pedido` e `itens_pedido_opcionais` (`20260614002500_rls_cupons_pedidos.sql`,
  `20260614007500_opcionais.sql`, `20261003120000_pedidos_cliente_id.sql`). Nenhuma foi redefinida depois.
- Índices: `references/schema.md` §3 + migrations (`pedidos_loja_criado_em`, `pedidos_loja_cliente_idx`,
  `itens_pedido_pedido_id_idx`, `itens_pedido_opcionais(item_pedido_id)`, `lojas_dono_unico`)
- `src/lib/vendas/{carregarRelatorioVendas,carregarRankingClientes,tipos}.ts`, `src/lib/supabase/queries/vendas.ts`
- `src/app/(painel)/painel/(bloqueavel)/vendas/page.tsx`, `src/app/admin/assinantes/[lojaId]/vendas/page.tsx`,
  `src/app/admin/assinantes/[lojaId]/carga-vendas.ts`
- `src/components/painel/RelatorioVendas.tsx`, `RankingClientesFieis.tsx`, `src/components/painel/vendas/*.tsx`
- `src/lib/utils/agregarVendas.ts` (tipos), `src/lib/validacoes/vendas.ts` (imports e padrões)
- `plan/tecnico-relatorio-vendas.md` §4 (D1)

## Medições

**Lighthouse não executado.** A rota é do painel autenticado, não da vitrine, e o dev server roda contra o cloud.
**`next build` não executado.** Outro agente (`testar`) estava editando o mesmo checkout. O bundle foi avaliado
por leitura do grafo de import (abaixo). Nada foi executado contra o cloud.

### Funções SQL em pglite (`EXPLAIN ANALYZE` e tempo de parede)

Ambiente: pglite com a cadeia completa de migrations (bootstrap de `tests/helpers/pglite.ts`, script em scratchpad,
nenhum teste do repo foi tocado) e `VACUUM ANALYZE` antes de medir. Mediana de 3 execuções. O pglite é WASM
single-thread: os números absolutos são 2 a 5 vezes piores que num Postgres nativo. O que vale aqui é a **razão** entre variantes.

Dataset: 2 lojas × 24.000 pedidos (60 por dia em 400 dias), 144.000 `itens_pedido`, 144.000 `itens_pedido_opcionais`,
500 clientes (60% dos pedidos com `cliente_id`). Mix de status: 4/6 faturáveis.
Janela de 366 dias da loja 1: 14.639 pedidos faturáveis e 43.917 itens.

| Chamada | sessão do lojista (`authenticated`) | `service_role` |
|---|---|---|
| `vendas_por_dia`, 366 d | 32 ms | 32 ms |
| `vendas_itens_por_categoria`, 366 d | **1.870 a 1.906 ms** | 260 a 269 ms |
| `vendas_itens_por_categoria`, 30 d (preset padrão `mes`) | 154 ms | 37 ms |
| `ranking_clientes_da_loja`, "desde o início", ordem `pedidos` / `total` | 40 / 38 ms | n/a |
| `pedidos_convidados_da_loja`, "desde o início" | 11 ms | n/a |
| SELECT de snapshot de categoria por item em `criar_pedido` | 0,05 ms | 0,05 ms |
| Backfill A2 (UPDATE em 144.000 itens, uma instrução) | 11,8 s | n/a |

Variantes de correção medidas para `vendas_itens_por_categoria`, 366 d, sessão do lojista:

| Variante | tempo |
|---|---|
| Atual (INVOKER + RLS) | 1.870 ms |
| Corpo sem a subquery de opcionais (só o custo da RLS de `itens_pedido`) | 657 ms |
| Opcionais por JOIN + GROUP BY em vez de subquery correlata | 2.114 ms (sem ganho: o custo é a RLS por linha) |
| Policies `itens_pedido_lojista` e `ipo_leitura_lojista` reescritas com `IN (…)` não correlacionado e `(select auth.uid())` | 733 ms |
| **`SECURITY DEFINER`** na função, mesmo corpo e mesma T2 | **259 ms** (30 d: 35 ms). A T2 continua recusando a loja alheia com `42501 vendas: sem posse da loja` |

Leitura do plano (sessão do lojista). Os pedidos saem por `Bitmap Index Scan on pedidos_loja_criado_em`, e a RLS de
`pedidos` é barata (`hashed SubPlan` sobre `lojas`, avaliado uma vez). O custo está nos itens:
- cada linha de `itens_pedido` avalia `EXISTS(itens_pedido_select_cliente) OR EXISTS(itens_pedido_lojista)`.
  São 2 Index Scans em `pedidos_pkey`, cada um com a RLS de `pedidos` aninhada, mais um `Seq Scan on lojas`
  com `auth.uid()` sem initplan (`loops=43917`);
- cada linha de `itens_pedido_opcionais` refaz a mesma cadeia um nível abaixo (`itens_pedido_pkey`, depois a RLS
  de `itens_pedido`, depois a RLS de `pedidos`, depois `lojas`), com `loops=43838`.

### Payload RSC / bundle

- Client Components novos: só `GraficoBarrasVendas` (estado da aba) e `CicloMensal` (formulário). Os demais
  (`RelatorioVendas`, `FiltrosVendas`, `ResumoFaturamento`, `ItensPorCategoria`, `BarrasVendas`,
  `RankingClientesFieis`) são Server Components.
- Dependências que eles puxam para o cliente (`@base-ui/react/toggle-group`, `sonner`, `zod`, `lucide-react`)
  já estão no bundle do painel por outros componentes. `package.json` não mudou na branch.
- `barras` serializado para `GraficoBarrasVendas` (366 + 53 + 13 barras, 8 campos cada): **60,2 KB brutos / 4,2 KB gzip**.
  Só com os 3 campos usados (`chave`, `rotulo`, `liquido`): 26,1 KB / 2,4 KB gzip.

## Findings

1. `supabase/migrations/20261007124000_relatorio_vendas_funcoes.sql:177-213`: **CUSTO**. A RLS por linha
   domina `vendas_itens_por_categoria` na sessão do lojista. Ela custa 7× a mesma consulta sem RLS: 1,9 s contra 0,26 s
   em pglite com 1 ano de uma loja de 60 pedidos/dia. Em Postgres nativo a estimativa é de 0,4 a 0,9 s. A
   causa são as policies de `itens_pedido` e `itens_pedido_opcionais`, com EXISTS correlato, RLS de `pedidos`
   aninhada e `auth.uid()` sem initplan. A RLS é redundante aqui, porque a T2 de `vendas_preparar_consulta`
   já provou a posse antes de qualquer leitura. O custo cresce linearmente com o volume e só aparece nos
   presets longos (`ano`, `personalizado` até 366 d). O preset padrão `mes` fica em 154 ms no pglite. Não está na
   vitrine nem no checkout. O admin (`service_role`) não é afetado.
   **Fix:** converter **só** `vendas_itens_por_categoria` para `SECURITY DEFINER`, mantendo `search_path = public, pg_temp`,
   a T2 no corpo e o `where p.loja_id = p_loja_id`. O molde é `ranking_clientes_da_loja` / `clientes_da_loja` /
   `reordenar_*` (215). Medido: 259 ms, com a T2 ainda recusando loja alheia. Isso reverte a decisão D1
   (`plan/tecnico-relatorio-vendas.md` §4: "DEFINER tira a RLS do lojista sem ganho"), e o ganho medido é de 7×.
   Por isso exige parecer do `auditar` e ajuste do T355-21 (`prosecdef = false`). Alternativa sem mexer em D1:
   reescrever as policies de leitura do lojista em `itens_pedido`/`itens_pedido_opcionais` com `IN (…)` não
   correlacionado e `(select auth.uid())`. Ganho de 2,5× (733 ms), mas mexe em RLS usada pelo painel inteiro e é
   escopo maior. **Status:** aberto. Pode virar issue. Não bloqueia o ciclo.
2. `src/components/painel/RelatorioVendas.tsx:83`: **POLIMENTO**. `GraficoBarrasVendas` recebe `BarraVendas`
   inteiro (8 campos), mas `BarrasVendas` só lê `chave`, `rotulo` e `liquido`. O excesso é de 34 KB brutos / 1,8 KB gzip no
   payload RSC com 366 dias. **Fix (trivial):** mapear para `{ chave, rotulo, liquido }` no Server Component
   antes de passar a prop. **Status:** opcional.

## OK (verificado, sem achado)

- `vendas_por_dia`: `pedidos_loja_criado_em` + filtro de status. 32 ms em 366 d e a RLS de `pedidos` não pesa.
- `ranking_clientes_da_loja` (DEFINER, sem RLS): `lojas_dono_unico` + `pedidos_loja_cliente_idx`, ordenação e
  corte no banco. `itens_top` é correlato só para as 20 linhas do corte, sobre o CTE `base` materializado.
  "Desde o início" com 24 mil pedidos fica em 40 ms. `pedidos_convidados_da_loja` fica em 11 ms.
- `criar_pedido`: o SELECT extra por item é lookup por PK em `produtos`/`categorias` (0,05 ms), dentro de um laço
  que já fazia um INSERT por item. Custo desprezível no checkout.
- Backfill A2: UPDATE único, idempotente, já aplicado no cloud (commit `31fda60`). Toma `ROW EXCLUSIVE` + `FOR NO KEY
  UPDATE` só nas linhas de `itens_pedido`: não bloqueia o INSERT do checkout nem o `KEY SHARE` da FK de
  `itens_pedido_opcionais`. As colunas novas são `ADD COLUMN` nullable / `NOT NULL DEFAULT` constante, só metadata.
- Loaders: `carregarRelatorioVendas` e `carregarRankingClientes` fazem `Promise.all` interno, e a página do painel
  dispara os dois em paralelo (4 RPCs em uma onda, depois de `buscarLojaDoDono`, que é necessário para o fuso). O
  admin é sequencial por exigência fail-closed (prova admin → loja → relatório). Sem waterfall evitável.
- Client Components restritos à interatividade real. Nenhuma dependência nova. A loja não é serializada inteira
  (só `dia_inicio_ciclo`/`timezone`).

## Fora do escopo de performance (encaminhar)

- `revisar`/`testar`: `vendas_itens_por_categoria` devolve uma linha por (categoria, nome do item) e o PostgREST
  corta em `max_rows = 1000` (`supabase/config.toml:18`; o default do cloud também é 1000). Com mais de 1000 nomes
  distintos no período, as linhas do fim (as categorias de menor valor e o balde "Sem categoria") somem em silêncio.
  É improvável no volume atual, mas não é detectado.
