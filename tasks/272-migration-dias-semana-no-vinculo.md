# [272] Migration aditiva `cardapio_produtos.dias_semana` + CHECK de domínio + tipos regerados

**crítica:** SIM (TDD red-first)
**Mundo:** infra (schema)
**Depende de:** [270] (o caminho de escrita em lote é corrigido antes de qualquer código desta spec)
**Spec:** specs/vigencia-por-item-do-cardapio.md — §Modelos de Dados, RN-01, RN-11, RN-13

## Origem

Spec §Modelos de Dados: a agenda semanal é estado do **vínculo** produto↔cardápio. Nenhuma tabela
nova, nenhuma policy nova, nenhum GRANT novo — `cardapio_produtos` já tem RLS e política é por
linha, não por coluna (`20260920129000_cardapio_produtos.sql`).

## Objetivo

Adicionar a coluna `dias_semana smallint[]` (NULLABLE, sem default, sem backfill) em
`cardapio_produtos`, com CHECK de domínio `<@ array[0..6]`, e regerar `src/lib/database.types.ts`.
Nada muda no comportamento: todo vínculo existente fica `NULL` = "todos os dias do cardápio".

## Escopo

- [ ] `supabase/migrations/<timestamp>_cardapio_produtos_dias_semana.sql` com a coluna, o
      `comment on column` e o constraint `cardapio_produtos_dias_semana_dominio` (SQL literal no spec)
- [ ] Bloco de ROLLBACK comentado no fim da migration (manual, nunca automático), incluindo a ordem
      "retirar o código que seleciona a coluna antes de dropar" (senão `42703`)
- [ ] Teste de migration em `tests/migrations/` via `createTestDb()`: `NULL` aceito, `{}` aceito,
      `{0,6}` aceito, `{7}` e `{-1}` recusados pelo CHECK
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts`

## Fora de escopo

- `npx supabase db push` no cloud — é o gate humano G2 do `plan/loop-vigencia-por-item-do-cardapio.md`
- Qualquer índice sobre `dias_semana` (decisão de dia é função pura em TS — §Modelos de Dados)
- Coluna de horário por item (§Decisões (b)), `dias_mes` por item, policy ou GRANT novo
- Qualquer leitura/escrita da coluna em TS — isso é [273] e [274]

## Reuso esperado

- `tests/helpers/pglite.ts` (`createTestDb`, `asService`) — não criar helper novo
- `tests/migrations/cardapios_checks_vigencia_rls.test.ts` como modelo de teste de CHECK
- `src/lib/database.types.ts` (regerado; `src/types/supabase.ts` está morto — não tocar)

## Segurança

- Tabela já tem RLS e GRANTs; policy é por **linha**: a coluna nova é coberta sem alteração
- Migration aditiva e reversível: nenhum dado existente é reescrito; janela de rollback TOTAL
- CHECK é backstop de domínio; a normalização `[] → NULL` é do servidor (RN-11, issue [274])

## Critério de aceite

- [ ] RED capturado: o teste do CHECK falha com o output `FAIL` antes da migration existir
- [ ] `npx vitest run tests/migrations/<arquivo>.test.ts` verde
- [ ] `npx supabase migration list` mostra a migration como só-local (coluna Remote vazia)
- [ ] `npx tsc --noEmit` = 0 erros com os tipos regerados
