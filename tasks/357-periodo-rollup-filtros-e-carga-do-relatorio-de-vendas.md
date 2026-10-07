# [357] Período no fuso da loja, rollup semana/ciclo, zod dos filtros, queries e loaders do relatório

**crítica:** SIM (TDD red-first)
**Mundo:** painel + admin (servidor, sem UI)
**Depende de:** [354] (coluna `dia_inicio_ciclo` e `src/lib/validacoes/vendas.ts`), [355] (funções financeiras),
[356] (função do ranking)
**Spec:** specs/relatorio-vendas.md — §2 behaviors "Escolher o período por preset", "Escolher um intervalo
personalizado", "Filtrar por tipo de entrega" (zod), "Ver o gráfico… Diário/Semanal/Mensal" (rollup), "Ver o
intervalo explícito do ciclo atual"; §2.1 "Escolher o período do ranking"; §3 behaviors "Ver a parte financeira…" e
"Filtrar período, tipo de entrega e só concluídos com as mesmas regras" (loader); fecha **RN-V06 (limites em TS),
RN-V07, RN-V09, RN-V10 (allowlist zod), RN-V11, RN-V12, RN-V18, RN-V21 (loader admin)** e a parte de log da
**RN-V23**

## Objetivo
Toda a lógica de servidor entre a URL e o SQL: transformar `searchParams` validados em janelas `[início, fim)` no fuso
da loja, chamar as funções do banco por wrappers tipados, fazer o rollup dia → semana ISO / ciclo e entregar os dados
prontos às pages do painel e do admin — uma única montagem compartilhada, sem cópia entre mundos.

## Escopo
- [ ] `src/lib/utils/periodoVendas.ts` (+ teste ao lado), puro, com `agora` injetado: presets `hoje`, `semana` (ISO,
      segunda a domingo), `mes` (ciclo atual), `mes_anterior` (ciclo anterior), `ano` (civil), `personalizado`
      (de/até locais inclusivos); ciclo a partir de `dia_inicio_ciclo`; períodos do ranking (semana, mês = ciclo atual,
      ano, desde o início → início nulo). Saída em instantes `[início, fim)` via `instanteNoFuso`, "hoje" via
      `diaNoFuso`, e o rótulo do intervalo do ciclo ("05/out a 04/nov").
- [ ] `src/lib/utils/agregarVendas.ts` (+ teste ao lado), puro: rollup das linhas diárias em semana ISO e em ciclo,
      somando com `arredondar`; totais do período derivados das mesmas linhas.
- [ ] `src/lib/validacoes/vendas.ts` (arquivo criado na 354): schemas dos filtros globais (preset, de, até,
      `tipo_entrega ∈ entrega | retirada | ambos`, `so_concluidos` booleano) e do período/ordem do ranking (parâmetros
      próprios na URL). Parâmetro inválido → preset padrão **"este mês"** + sinal de aviso discreto, nunca exceção.
- [ ] `src/lib/supabase/queries/vendas.ts`: wrappers tipados por `Database["public"]["Functions"]` de
      `vendas_por_dia`, `vendas_itens_por_categoria` e `ranking_clientes_da_loja` (`ambos` → `p_tipo_entrega` NULL).
- [ ] Montagem compartilhada (nome e local definidos pelo plano técnico) que recebe client + loja (id, timezone,
      `dia_inicio_ciclo`) + filtros validados e devolve resumo, barras das três granularidades, itens por categoria e
      o intervalo do ciclo. Erro de banco: logado no servidor, devolvido como falha genérica (sem detalhe).
- [ ] Loader admin `src/app/admin/assinantes/[lojaId]/carga-vendas.ts` (+ teste), molde `carga-pedidos.ts`:
      `validarLojaIdAdmin` → `notFound()` → `verificarAdminSaaS()` (falha propaga) → `createServiceClient()` → loja
      por id validado → montagem compartilhada com `p_loja_id` validado. **Nunca** chama o ranking.

## Fora de escopo
- Pages, componentes, item de menu (issue 358).
- Mudar `calcularMetricasDoDia`/`chaveDia` em `metricasPedidos.ts` (ficam intocados, fuso cravado é outra issue).
- Semana configurável; ciclo 29–31.

## Reuso esperado
- `src/lib/utils/fusoLoja.ts` — `instanteNoFuso` (:103), `diaNoFuso` (:160), `partesNoFusoCompletas` (:47): fonte
  única de fuso; não criar outro conversor de datas.
- `src/lib/utils/arredondar.ts` — soma no rollup.
- `src/lib/supabase/queries/clientes.ts:69-90` — molde de wrapper de RPC tipado.
- `src/app/admin/assinantes/[lojaId]/carga-pedidos.ts:30-46` e `carga-pedidos.test.ts` — ordem fail-closed e molde
  de teste do loader admin; `carga.ts` se já houver leitura da loja-alvo reaproveitável.
- `src/lib/actions/admin-loja.ts:30` `validarLojaIdAdmin`.
- Schema do ciclo da issue 354 (mesmo arquivo, sem redefinir 1..28).

## Segurança
- Janela errada = faturamento errado: todos os limites são calculados no servidor, no fuso da loja; a UI só escreve a
  URL. Nenhuma consulta sai sem faixa (o SQL recusa nulo, e o zod nunca deixa passar intervalo aberto nas
  financeiras).
- Admin: `service_role` só depois de `verificarAdminSaaS()`, `lojaId` validado como UUID antes de qualquer client.
- Painel: client da **sessão** (as funções reconferem o dono; o ranking depende de `auth.uid()`).

## Critério de aceite
- [ ] **RN-V07:** dia 5, hoje 07/out/2026 → ciclo atual **05/out a 04/nov**, anterior **05/set a 04/out**; dia 5,
      hoje 03/out → atual **05/set a 04/out**; dia 1, hoje 07/out → **01/out a 31/out**; borda de ano: dia 5, hoje
      03/jan/2027 → **05/dez/2026 a 04/jan/2027**.
- [ ] **RN-V11:** hoje quarta 07/out/2026 → "esta semana" **05/out a 11/out**; no rollup semanal, 04/out (domingo) cai
      na semana iniciada em **28/set**.
- [ ] **RN-V06 (limites):** em `America/Sao_Paulo`, pedido às 23:30 locais de 04/out (`2026-10-05T02:30Z`) fica fora
      de "esta semana" (05/out–11/out) e dentro de "hoje" quando hoje = 04/out; loja `America/Manaus` gera
      limites com −04:00.
- [ ] **RN-V09:** personalizado 01/01/2026 a 01/01/2027 (366 dias) aceito; 01/01/2026 a 02/01/2027 (367) recusado;
      de > até recusado; preset/datas inválidos na URL → "este mês" + aviso, sem exceção nem consulta sem limite.
- [ ] **RN-V10:** `tipo_entrega` fora da allowlist → padrão `ambos`; `ambos` vira `p_tipo_entrega = NULL`.
- [ ] **RN-V12 (propriedade):** para uma fixture de linhas diárias, Σ barras diárias = Σ semanais = Σ por ciclo =
      totais do período, em cada métrica (bruto, descontos, líquido, frete, contadores).
- [ ] **RN-V18:** períodos do ranking: semana ISO, mês = ciclo atual, ano civil, "desde o início" com início nulo; o
      parâmetro do ranking não altera os filtros globais e vice-versa.
- [ ] Loader admin: `lojaId = "x"` → `notFound()` sem `verificarAdminSaaS`/service client; `verificarAdminSaaS`
      rejeita → nenhum `createServiceClient()` nem query; caminho feliz passa o `lojaId` validado como `p_loja_id` e
      **não** chama `ranking_clientes_da_loja`.
- [ ] Falha de RPC → log no servidor e resultado de falha genérico (nenhuma mensagem do Postgres no retorno).
- [ ] Testes vermelhos com `FAIL` capturado antes da implementação; depois verdes; `npx tsc --noEmit` limpo.

## RED (tdd)

Arquivos (plano §8.6): `src/lib/supabase/queries/vendas.test.ts` (verde na fatia A),
`src/lib/validacoes/vendas.test.ts`, `src/lib/utils/periodoVendas.test.ts`,
`src/lib/utils/agregarVendas.test.ts`, `src/lib/vendas/carregarRelatorioVendas.test.ts`,
`src/lib/vendas/carregarRankingClientes.test.ts`, `src/app/admin/assinantes/[lojaId]/carga-vendas.test.ts`.

```bash
npx vitest run src/lib/supabase/queries/vendas.test.ts src/lib/validacoes/vendas.test.ts \
  src/lib/utils/periodoVendas.test.ts src/lib/utils/agregarVendas.test.ts src/lib/vendas \
  "src/app/admin/assinantes/[lojaId]/carga-vendas.test.ts"
```

```
 FAIL  src/lib/supabase/queries/vendas.test.ts > buscarVendasPorDia > 'ambos' → rpc vendas_por_dia SEM a chave p_tipo_entrega; …
Error: Cannot find module '/src/lib/supabase/queries/vendas' imported from …/queries/vendas.test.ts
 FAIL  src/lib/utils/periodoVendas.test.ts > …            (16 casos)
Error: Cannot find module '/src/lib/utils/periodoVendas' imported from …
 FAIL  src/lib/utils/agregarVendas.test.ts > …            (9 casos)
Error: Cannot find module '/src/lib/utils/agregarVendas' imported from …
 FAIL  src/lib/validacoes/vendas.test.ts > …              (30 casos)
Error: Cannot find module '/src/lib/validacoes/vendas' imported from …
 FAIL  src/lib/vendas/carregarRelatorioVendas.test.ts > … (6 casos)
 FAIL  src/lib/vendas/carregarRankingClientes.test.ts > … (4 casos)
 FAIL  src/app/admin/assinantes/[lojaId]/carga-vendas.test.ts > … (6 casos)
Error: Cannot find module '/src/app/admin/assinantes/[lojaId]/carga-vendas' imported from …
```

Import dinâmico por caso (sem stub de produção): cada caso falha isolado pelo módulo ausente.
