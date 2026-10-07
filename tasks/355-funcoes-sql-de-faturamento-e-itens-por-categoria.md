# [355] Funções SQL de faturamento por dia e de itens por categoria, escopadas por loja

**crítica:** SIM (TDD red-first)
**Mundo:** infra (banco)
**Depende de:** [353] (lê `itens_pedido.categoria_*_snapshot`)
**Spec:** specs/relatorio-vendas.md — §4 Banco (behaviors "Funções financeiras de agregação" e "`anon` não executa
nenhuma função nova", parte financeira), Migration D; lado SQL dos behaviors de §2 "Alternar só concluídos", "Ver
bruto, descontos, líquido e frete", "Ver N pedidos com frete a combinar", "Ver itens mais vendidos por categoria";
fecha **RN-V01, RN-V02, RN-V03, RN-V04, RN-V05, RN-V06 (agrupamento SQL), RN-V10 (filtro SQL), RN-V13, RN-V15
(balde "Sem categoria"), RN-V16, RN-V21 (parte financeira)**

## Objetivo
Criar as duas funções de agregação autoritativas que o painel (client da sessão) e o admin (`service_role`) chamam:
faturamento por **dia local da loja** e itens vendidos por categoria congelada. Toda soma acontece em `numeric` no
banco, sobre valores já gravados pelo checkout.

## Escopo
- [ ] `vendas_por_dia(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos)`: uma linha por dia local
      (`(criado_em AT TIME ZONE lojas.timezone)::date`) com nº de pedidos, bruto (Σ `subtotal`), descontos
      (Σ `desconto`), líquido (Σ `greatest(0, subtotal − desconto)`), frete (Σ `taxa_entrega` não nulo) e nº de
      pedidos com frete a combinar (`taxa_entrega IS NULL`).
- [ ] `vendas_itens_por_categoria(…mesmos parâmetros…)`: por (categoria snapshot, item): quantidade e valor bruto da
      linha = `round(preco × qtd, 2) + Σ round(opcional.preco_snapshot × opcional.quantidade, 2)`, opcional somado
      **uma vez** por linha (fórmula de `totalDaLinha`). Categoria NULL = balde "Sem categoria".
- [ ] Conjunto de status **fixado no corpo**: padrão `confirmado, em_preparo, saiu_entrega, entregue`; com
      `p_so_concluidos` só `entregue`. Nenhum parâmetro de lista de status existe.
- [ ] Faixa obrigatória `[p_inicio, p_fim)` (nulo → `22023`); `p_tipo_entrega` ∈ `entrega | retirada | NULL` (fora →
      `22023`). Faixa servida por `pedidos(loja_id, criado_em DESC)`.
- [ ] `SECURITY INVOKER`, `search_path` fixo (molde D6 de `aplicar_frequencia_em_produtos`); `WHERE loja_id = p_loja_id`
      explícito; para autor não-`service_role`, reconferir `lojas.dono_id = auth.uid()` no corpo com
      `coalesce(auth.role(), '')` fail-closed (molde `20260918130000_rpc_ordem_t2_fail_closed.sql`).
- [ ] Grants: `REVOKE ALL … FROM public, anon`; `GRANT EXECUTE … TO authenticated, service_role`.
- [ ] Patch de `src/lib/database.types.ts` (`Functions`).

## Fora de escopo
- Rollup semana/ciclo, limites de período e wrappers TS (issue 357).
- Ranking de clientes (issue 356).
- Rateio do desconto por item/categoria (fora da v1).
- Reusar `listarPedidosDoDono`/`listarPedidosDaLoja` para agregar (proibido: sem limite de data).

## Reuso esperado
- `src/lib/utils/calcularTotal.ts:39-51` `totalDaLinha` — a fórmula SQL **espelha** esta; o teste de paridade compara
  as duas sobre a mesma fixture (não reescrever a fórmula em TS).
- `supabase/migrations/20260918130000_rpc_ordem_t2_fail_closed.sql` — reconferência de posse com
  `coalesce(auth.role(), '')`.
- `tests/helpers/pglite.ts` `createTestDb()`; fixtures de pedido de `tests/migrations/rpc_criar_pedido.test.ts`.
- Se o plano técnico extrair o conjunto de status do faturamento para um helper SQL interno, ele nasce **aqui** e a
  issue 356 o reusa (nunca redigitar a lista em duas funções).

## Segurança
- Valor monetário: só leitura de `subtotal`/`desconto`/`taxa_entrega`/`total` gravados (RN-V13); nada vem do cliente
  além de filtros validados.
- Escopo: a RLS de `pedidos` soma `pedidos_select_cliente` por OR — um lojista que também é cliente de outra loja
  veria os próprios pedidos alheios via `p_loja_id` estrangeiro. A reconferência de dono no corpo fecha isso.
- `anon` não executa; sem `SECURITY DEFINER`.

## Critério de aceite
- [ ] **RN-V01:** entregue 50, em_preparo 30, pendente 20, cancelado 40 → bruto padrão **80**.
- [ ] **RN-V02:** mesmo conjunto com `p_so_concluidos = true` → **50**.
- [ ] **RN-V03:** subtotal 100, desconto 10, frete 8, total 98 → bruto **100**, descontos **10**, líquido **90**,
      frete **8**.
- [ ] **RN-V04 (propriedade):** sobre a fixture inteira, Σ líquido + Σ frete = Σ `total` dos pedidos sem
      `frete_a_combinar` do mesmo conjunto (90 + 8 = 98 no caso acima).
- [ ] **RN-V05:** A (subtotal 50, frete 5, total 55) + B (subtotal 30, frete a combinar, total 30) → bruto 80,
      líquido 80, frete **5**, contador **1**; pedido com frete registrado depois (`frete_a_combinar` false) soma no
      frete.
- [ ] **RN-V06:** pedido em `2026-10-06T02:30Z`, loja `America/Sao_Paulo` → linha do dia **2026-10-05**; loja
      `America/Manaus` com pedido em `2026-10-06T03:30Z` → **2026-10-05**.
- [ ] **RN-V10:** entrega 60 + retirada 20 → `entrega` 60, `retirada` 20, NULL 80; `p_tipo_entrega = 'x'` → `22023`.
- [ ] **RN-V16:** X-Burger 20 × 2 + bacon 3 × 1 → linha **43** (não 46); pedido subtotal 43 com cupom −10 → item 43,
      bruto 43, líquido 33; Σ linhas do conjunto = bruto.
- [ ] **RN-V15:** item com snapshot NULL aparece no balde "Sem categoria"; caso "Coca" (353) aparece em "Bebidas" no
      período de março.
- [ ] Paridade: valor bruto da linha SQL = `totalDaLinha` TS na mesma fixture (com opcionais de quantidade > 1).
- [ ] **RN-V21:** `asUser` dono de X vê X; dono de X chamando com `p_loja_id = Y` (sendo ele **cliente** com pedidos em
      Y) → recusa `42501` com fragmento `sem posse da loja` (plano técnico D2; mais forte que "zero linhas"), nenhuma linha de Y; `asAnon` → erro de permissão (afirmar fragmento `permission denied`
      junto do SQLSTATE); `asService` vê a loja passada.
- [ ] `p_inicio`/`p_fim` nulos → `22023` com fragmento da mensagem.
- [ ] Teste vermelho com `FAIL` capturado (função inexistente) antes da migration; depois verde; tsc limpo.

## RED (tdd)

Arquivos (plano §8.3 e §8.4): `tests/migrations/vendas_funcoes_faturamento.test.ts` (T355-01..21) e
`tests/migrations/vendas_itens_por_categoria.test.ts` (T355-30..38).

```bash
npx vitest run tests/migrations/vendas_funcoes_faturamento.test.ts tests/migrations/vendas_itens_por_categoria.test.ts
```

```
 FAIL  … > T355-01 status_faturamento: false → 4 status; true → {entregue}; null → null
error: function public.status_faturamento(boolean) does not exist
 FAIL  … > T355-02..10, 13, 20
error: function public.vendas_por_dia(p_loja_id => uuid, p_inicio => timestamp with time zone, …) does not exist
 FAIL  … > T355-15 RN-V21: lojista-cliente pedindo a loja onde comprou → 42501 sem posse da loja
AssertionError: expected '42883' to be '42501' // Object.is equality
 FAIL  … > T355-21 ACL e segurança …
AssertionError: expected [] to deeply equal [ 'status_faturamento', …(3) ]
      Tests  20 failed | 1 passed (21)
 FAIL  … > T355-30..37 (itens por categoria)
error: column "categoria_id_snapshot" of relation "itens_pedido" does not exist
 FAIL  … > T355-38 RN-V21 …
AssertionError: expected '42883' to be '42501' // Object.is equality
      Tests  9 failed (9)
```

T355-14 passa já no RED de propósito: prova que a RLS sozinha entrega ao lojista-cliente os 2 pedidos dele
na loja alheia (vetor real que o T2 `sem posse da loja` fecha).
