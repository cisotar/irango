# [354] Ciclo mensal da loja: `lojas.dia_inicio_ciclo` + actions de edição (lojista e admin)

**crítica:** SIM (TDD red-first)
**Mundo:** infra (banco) + painel + admin
**Depende de:** —
**Spec:** specs/relatorio-vendas.md — §4 Banco (behavior "Migration adiciona `lojas.dia_inicio_ciclo`"), Migration C,
§2 behavior "Editar o dia de início do ciclo" e §3 behavior "Editar o dia de início do ciclo da loja-alvo" (lado
servidor); fecha **RN-V08**

## Objetivo
Dar à loja um dia de início de ciclo mensal (1..28, default 1), travado no banco, e as duas Server Actions que o
editam: a do lojista (própria loja) e a do admin (loja-alvo, paridade).

## Escopo
- [ ] Migration C: `lojas.dia_inicio_ciclo smallint NOT NULL DEFAULT 1` com
      `CONSTRAINT lojas_dia_inicio_ciclo_check CHECK (dia_inicio_ciclo BETWEEN 1 AND 28)`.
- [ ] Schema zod do ciclo em `src/lib/validacoes/vendas.ts` (arquivo novo; a issue 357 acrescenta os schemas de
      filtro no mesmo arquivo): inteiro 1..28, `.strict()`. É o **mesmo** schema que o `react-hook-form` do
      `CicloMensal` usa (issue 358).
- [ ] Action do lojista (`salvarCicloVendas`, local definido pelo plano técnico): zod → `buscarLojaDoDono` → UPDATE só
      de `dia_inicio_ciclo` escopado pelo id da loja da sessão, com checagem fail-closed de linhas afetadas
      (`count !== 1` → erro; precedente issue 283) → `revalidatePath` da rota de vendas. Erro genérico na UI, detalhe
      no log.
- [ ] Action do admin `salvarCicloVendasAdmin(lojaId, payload)`: `prepararContextoAdmin(lojaId)` (valida id +
      `verificarAdminSaaS()` antes do service client) → zod → `escopo.atualizarLoja({ dia_inicio_ciclo })`.
- [ ] Patch de `src/lib/database.types.ts` com a coluna.

## Fora de escopo
- Componente `CicloMensal` e o texto "Ciclo atual: 05/out a 04/nov" (issue 358; o cálculo do intervalo é da 357).
- Expor a coluna na view `vitrine_lojas` (proibido: dado interno do painel).
- Ciclo com dia 29–31.

## Reuso esperado
- `src/lib/actions/admin-loja.ts` — `validarLojaIdAdmin` (:30), `prepararContextoAdmin` (:236) e
  `escopo.atualizarLoja`; **não** adicionar a coluna a `CAMPOS_LOJA_SOMENTE_SERVIDOR` (:51).
- `src/lib/actions/patches-loja.ts` — padrão de allowlist coluna a coluna para paridade painel/admin.
- `src/lib/actions/clientesDaLoja.ts:41-71` — molde de action com zod + `buscarLojaDoDono` + erro genérico.
- `src/lib/supabase/queries/lojas.ts:62` `buscarLojaDoDono`.
- `src/app/admin/assinantes/actions/*.paridade.test.ts` — molde de teste de paridade lojista/admin.

## Segurança
- Escrita em `lojas`: lojista só na própria loja (RLS `lojas_update_proprio` + escopo por id da sessão); admin só após
  `verificarAdminSaaS()` e com `lojaId` validado. Nenhum id de loja vem do payload do lojista.
- Não é campo de billing nem PII: fora do trigger de billing e de `CAMPOS_LOJA_SOMENTE_SERVIDOR`; o teste prova que o
  dono consegue gravá-la e que isso não abre escrita em coluna de billing.

## Critério de aceite
- [ ] Banco (pglite): default 1 em loja nova; `0`, `29` → CHECK recusa com fragmento `lojas_dia_inicio_ciclo_check`
      na mensagem (não só SQLSTATE `23514`); `1` e `28` aceitos.
- [ ] Banco (pglite): `asUser` dono grava o próprio ciclo; `asUser` de outra loja → 0 linhas afetadas na loja alheia.
- [ ] zod: `5` ok; `0`, `29`, `5.5`, `"5"` (se o contrato não coagir), `null`, chave extra → recusados.
- [ ] Action lojista: payload sem sessão/loja → erro genérico, nenhum UPDATE; UPDATE só com o id de
      `buscarLojaDoDono`; `count !== 1` → erro.
- [ ] Action admin: `lojaId` não-UUID → recusa antes de qualquer client; `verificarAdminSaaS()` falha → nenhum
      `createServiceClient()`; caminho feliz grava só `dia_inicio_ciclo` da loja-alvo.
- [ ] `vitrine_lojas` não expõe a coluna (teste ou asserção na suíte de `vitrine_lojas`).
- [ ] Teste vermelho com `FAIL` capturado antes da migration/actions; depois verde; `npx tsc --noEmit` limpo.

## RED (tdd)

Arquivos (plano §8.2 e §8.6): `tests/migrations/lojas_dia_inicio_ciclo.test.ts`,
`src/lib/actions/patches-loja.ciclo.test.ts`, `src/lib/actions/vendas.test.ts`,
`src/app/admin/assinantes/actions/admin-vendas.test.ts`,
`src/app/admin/assinantes/actions/admin-vendas.paridade.test.ts`, parte "ciclo" de
`src/lib/validacoes/vendas.test.ts`.

```bash
npx vitest run tests/migrations/lojas_dia_inicio_ciclo.test.ts src/lib/actions/patches-loja.ciclo.test.ts \
  src/lib/actions/vendas.test.ts src/app/admin/assinantes/actions/admin-vendas.test.ts \
  src/app/admin/assinantes/actions/admin-vendas.paridade.test.ts
```

```
 FAIL  … > T354-01 default 1 em loja nova; smallint NOT NULL
error: column "dia_inicio_ciclo" does not exist
 FAIL  … > T354-02 0 recusado → 23514 lojas_dia_inicio_ciclo_check
AssertionError: expected '42703' to be '23514' // Object.is equality
 FAIL  … > T354-08 gravar o ciclo não abre billing …
AssertionError: expected '42703' to be 'P0001' // Object.is equality
      Tests  9 failed (9)
 FAIL  src/lib/actions/patches-loja.ciclo.test.ts > montarPatchCiclo — allowlist (354) > …
Error: [RED 354] `montarPatchCiclo` ainda não existe em src/lib/actions/patches-loja.ts (§7.7).
 FAIL  src/lib/actions/vendas.test.ts > salvarCicloVendas (lojista) > …   (6 casos)
Error: Cannot find module '/src/lib/actions/vendas' imported from …/vendas.test.ts
 FAIL  src/app/admin/assinantes/actions/admin-vendas.test.ts > …          (7 casos)
Error: Cannot find module '/src/app/admin/assinantes/actions/admin-vendas' imported from …
```
