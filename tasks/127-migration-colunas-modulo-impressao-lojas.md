# [127] Migration: colunas `modulo_impressao_a4` + `modulo_impressao_termica` em `lojas`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Adicionar à tabela `lojas` as duas flags de entitlement dos módulos de impressão
(`modulo_impressao_a4`, `modulo_impressao_termica`), ambas `boolean not null default
false` (fail-closed), e regenerar os tipos. É o pré-requisito de dados de toda a
feature (DA-M1 → Opção A).

## Escopo
- [ ] Nova migration `supabase/migrations/20260707120000_lojas_modulos_impressao.sql`:
  ```sql
  ALTER TABLE lojas
    ADD COLUMN IF NOT EXISTS modulo_impressao_a4      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS modulo_impressao_termica boolean NOT NULL DEFAULT false;
  ```
- [ ] **NÃO** adicionar as colunas à view `vitrine_lojas` (ao contrário da issue 121):
  entitlement/billing é dado interno do painel, nunca público. A vitrine não precisa
  e não deve enxergar quais módulos a loja contratou.
- [ ] Regenerar `src/lib/database.types.ts`: as colunas devem aparecer em
  `Tables<"lojas">` (Row/Insert/Update) — `npx supabase gen types typescript`.
- [ ] `migration repair` antes de `db push` se o histórico remoto estiver dessincronizado;
  usar `npx supabase` (memória `deploy-migrations-cloud`).
- [ ] Bloco de rollback comentado no fim do `.sql` (`DROP COLUMN IF EXISTS ...`).

## Fora de escopo
- Extensão do trigger de billing (issue 128).
- `CAMPOS_LOJA_SOMENTE_SERVIDOR` (issue 129).
- Qualquer util/leitura/UI (issues 130+).

## Reuso esperado
- Padrão de coluna boolean fail-closed de `ativo`/`logo_url` (`references/schema.md §lojas`).
- Padrão aditivo sem rewrite da issue 121 (default constante → sem backfill).

## Segurança
- **`default false` = fail-closed:** loja nasce sem nenhum módulo pago (RN-M1). Um bug
  de default (`true`) liberaria os módulos pagos para todas as lojas → burla de billing.
  Por isso esta issue é crítica.
- Colunas caem sob a RLS de linha de `lojas` já existente — **nenhuma política RLS nova**.
- `select("*")` de `buscarLojaDoDono`/`buscarLojaAdminPorId` já as traz para
  `LojaCompleta` após regenerar os tipos — zero query nova.
- **Não** entram na view `vitrine_lojas` (não vazar entitlement ao público).

## Critério de aceite
- [ ] (RED-first) Teste pglite: uma `lojas` inserida sem especificar as colunas nasce com
  `modulo_impressao_a4 = false` **e** `modulo_impressao_termica = false`.
- [ ] Vermelho escrito e confirmado ANTES da migration; depois verde.
- [ ] `Tables<"lojas">` expõe `modulo_impressao_a4: boolean` e `modulo_impressao_termica: boolean`.
- [ ] `Tables<"vitrine_lojas">` **NÃO** expõe nenhuma das duas (guarda de não-vazamento).
- [ ] Suíte existente (pglite aplica a migration) continua verde; `next build` + `vitest run` verdes.
