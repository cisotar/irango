# [083] Migration: coluna `oculto` em `produtos` + RLS `produtos_leitura_publica` por `oculto = false`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Adicionar o campo `oculto boolean not null default false` em `produtos` e trocar o predicado da policy pública `produtos_leitura_publica` de `disponivel = true` para `oculto = false`, separando visibilidade de disponibilidade na camada primária (banco).

## Escopo
- [x] Migration versionada em `supabase/migrations/` com `ALTER TABLE produtos ADD COLUMN oculto boolean NOT NULL DEFAULT false;` (RN-7: default `false` = retrocompatível). — `20260621099000_produtos_oculto_rls_publica.sql`
- [x] Na mesma migration: `DROP POLICY "produtos_leitura_publica" ON produtos;` seguido de `CREATE POLICY` com `using (oculto = false and public.loja_esta_ativa(produtos.loja_id))`.
- [x] `produtos_leitura_propria` e `produtos_escrita_propria` (dono) permanecem intocadas — o dono já enxerga tudo por `dono_id = auth.uid()`.
- [ ] (Opcional, decisão do `migrar`) índice `produtos(loja_id, oculto, ordem)` para a leitura da vitrine — não bloqueia a feature. (NÃO criado — tabela pequena; deixado fora conforme nota do plano.)

## Fora de escopo
- Regenerar `database.types.ts` (issue 084).
- Qualquer código de aplicação (queries, actions, UI).
- Migração de dados de produtos hoje indisponíveis para oculto (RN-7: decisão de produto é NÃO migrar).

## Reuso esperado
- Padrão de migration RLS de `20260614002000_rls_catalogo.sql` (DROP + CREATE da mesma policy).
- Função `public.loja_esta_ativa(loja_id)` — reusar, não recriar.

## Segurança
- Toca migration E RLS pública → invariante de isolamento e de visibilidade cross-tenant.
- A troca de predicado é o gate primário do RN-2 (oculto vence tudo na vitrine): validar que `oculto = true` some da leitura anônima e que produto `disponivel = false` não-oculto passa a ser legível.
- Escrita continua exclusivamente pelo client autenticado sob `produtos_escrita_propria`; nunca `service_role`.

## Critério de aceite
- [x] Teste RLS no Supabase local (pglite): sob anon, produto `oculto = true` NÃO retorna; produto `oculto = false, disponivel = false` de loja ativa RETORNA; produto de loja inativa não retorna. — `tests/migrations/rls_produtos_oculto.test.ts` 9/9 GREEN.
- [x] Coluna `oculto` existe com default `false` e `not null`; produtos preexistentes ficam `false`. — validado por `[oculto-8]`.
- [x] `produtos_leitura_propria`/`_escrita_propria` inalteradas (dono continua vendo ocultos e indisponíveis). — validado por `[oculto-6]`/`[oculto-7]`; migration não toca essas policies.
- [ ] `npx supabase db push` aplica limpo (migration repair antes, se histórico remoto dessincronizado). — **PENDENTE: gate de deploy cloud, fora do escopo desta fase (exige autorização explícita).**

---

## Plano técnico (migrar)

### 1. Análise de impacto

**Tipo de mudança:** aditiva de schema (uma coluna) + troca de predicado em uma policy de leitura pública já existente. NÃO é destrutiva/contrato — não renomeia, não dropa, não muda tipo de coluna com dado. Portanto **NÃO exige expand→backfill→contract**. É migration de um passo só.

**Por que ADD COLUMN NOT NULL DEFAULT false é seguro nesta tabela populada:**
- Postgres 11+ trata `ADD COLUMN ... NOT NULL DEFAULT <const>` como operação de **metadados** (armazena o default em `pg_attribute.atthasmissing`/`attmissingval`); não reescreve a tabela linha a linha nem faz backfill físico. O backfill lógico é instantâneo — toda linha preexistente lê `false` sem UPDATE.
- Logo não há passo de backfill separado, não há janela de escrita concorrente perdida, não há lock de reescrita. O `ACCESS EXCLUSIVE` é momentâneo (só atualiza o catálogo).
- A tabela `produtos` do projeto é pequena (MVP), então mesmo o pior caso é irrelevante. Confirmado seguro.

**Quem LÊ `produtos` sob RLS pública (predicado que está mudando):**
- Vitrine pública (Server Components + queries de catálogo em `src/lib/supabase/queries/` — grep por `.from("produtos")` / `from('produtos')`). Hoje só recebem produtos com `disponivel = true`; após a migration passam a receber também `disponivel = false` desde que `oculto = false`. **Atenção de sequência:** enquanto o código de aplicação da issue 084+ não filtrar/renderizar "esgotado", a vitrine passará a exibir produtos indisponíveis como se estivessem normais. Isso é aceitável dentro do escopo desta issue (issue de infra), mas é a razão de a issue 084 (tipos) e as issues de UI serem dependentes — ver Riscos.
- `produtos_leitura_propria` (dono) e `produtos_escrita_propria` (dono) **não mudam** — o dono já vê tudo por `dono_id = auth.uid()`, independente de `oculto`/`disponivel`.

**Quem ESCREVE `produtos`:** apenas o lojista autenticado via `produtos_escrita_propria` (painel). A coluna `oculto` nasce `false` e só será setada por Server Action do painel (fora do escopo desta issue). Nenhuma escrita anon. `service_role` não escreve produto neste fluxo.

**Invariante de segurança tocada:** visibilidade cross-tenant na leitura pública. Gate primário do RN-2 ("oculto vence tudo na vitrine"). A validação RED abaixo prova que `oculto = true` some da leitura anon e que `disponivel = false` não-oculto passa a aparecer.

### 2. Arquivo de migration

**Nome:** `supabase/migrations/20260621099000_produtos_oculto_rls_publica.sql`

Timestamp `20260621099000` — sucede a última migration existente (`20260621098000_ipo_remove_insert_publico.sql`) e mantém a série 0906x/9x contígua. NÃO criar o arquivo agora — é da fase GREEN (`executar`), depois do RED do `tdd`.

**Conteúdo (DDL a escrever na fase GREEN):**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- [083] produtos.oculto + RLS produtos_leitura_publica por oculto = false
--
-- Migration ADITIVA (uma coluna) + troca de predicado da policy de leitura
-- pública já existente (criada na 20260614002000_rls_catalogo.sql).
--
-- 1) Coluna `oculto boolean NOT NULL DEFAULT false`:
--    - Separa VISIBILIDADE (oculto) de DISPONIBILIDADE (disponivel). Produto pode
--      estar indisponível (esgotado) e ainda assim visível na vitrine; produto
--      oculto some da vitrine independente de disponivel.
--    - DEFAULT false (RN-7): retrocompatível — todo produto preexistente continua
--      visível. Postgres 11+ resolve o backfill como metadados (attmissingval),
--      sem reescrever a tabela; seguro em tabela populada. Decisão de produto:
--      NÃO migrar produtos hoje indisponíveis para oculto.
--
-- 2) DROP + CREATE da policy `produtos_leitura_publica`:
--    - Antes:  USING (disponivel = true AND public.loja_esta_ativa(produtos.loja_id))
--    - Depois: USING (oculto = false AND public.loja_esta_ativa(produtos.loja_id))
--    - Reusa a função SECURITY DEFINER public.loja_esta_ativa(uuid) (NÃO recriar):
--      a base `lojas` não tem SELECT público para anon (seguranca.md §19), então um
--      EXISTS direto em lojas rodaria sob RLS do anon e retornaria zero linhas,
--      tornando o catálogo invisível. O helper responde só o booleano.
--    - `produtos_leitura_propria` e `produtos_escrita_propria` ficam INTOCADAS:
--      o dono já vê/gerencia tudo por dono_id = auth.uid(), inclusive oculto.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.produtos
  add column oculto boolean not null default false;

-- Troca do predicado da leitura pública: disponivel = true  →  oculto = false.
-- DROP + CREATE (mesmo padrão da 20260614002000): Postgres não tem
-- "ALTER POLICY ... USING" que preserve intenção de forma legível; recriar é o
-- padrão do projeto.
drop policy "produtos_leitura_publica" on public.produtos;

create policy "produtos_leitura_publica"
  on public.produtos for select
  using (
    oculto = false
    and public.loja_esta_ativa(produtos.loja_id)
  );

-- (Opcional — decisão do migrar/executar) índice para a leitura da vitrine.
-- A leitura pública passa a filtrar por (loja_id, oculto) e ordenar por ordem.
-- O índice existente é produtos(loja_id, disponivel, ordem) (schema.md §3) — não
-- casa mais o predicado. Índice de suporte, não bloqueia a feature; incluir se o
-- executar julgar pertinente:
-- create index on public.produtos (loja_id, oculto, ordem);
```

**Nota sobre o índice:** o índice `produtos(loja_id, disponivel, ordem)` da 010000 deixa de casar o novo predicado de leitura pública (que agora usa `oculto`). Não é bloqueante (tabela pequena), mas é candidato natural a `create index on public.produtos (loja_id, oculto, ordem)`. Decisão fica para o `executar`; se criado, documentar em `references/schema.md §3` (issue de documentação).

### 3. Sequência

Um passo. Não há expand→backfill→contract porque:
- não removemos nem renomeamos coluna com dado;
- o DEFAULT cobre o backfill instantaneamente (metadados);
- a troca de predicado da policy é atômica dentro da transação implícita da migration (DROP + CREATE na mesma migration — nunca fica uma janela sem policy pública em produção, pois migration roda em transação).

Ordem de trabalho do fluxo: **RED (`tdd`) → GREEN (`executar` cria a migration) → tipos (issue 084) → UI (issues seguintes)**.

### 4. Regenerar tipos

Fora do escopo desta issue (é a issue 084), mas o comando canônico do projeto é:

```
npx supabase gen types typescript > src/lib/database.types.ts
```

Nunca `pnpm supabase`; nunca escrever em `src/types/supabase.ts` (arquivo morto).

### 5. Rollback

Migration inversa (uma migration nova, nunca editar a aplicada):

```sql
-- reverter troca de predicado
drop policy "produtos_leitura_publica" on public.produtos;
create policy "produtos_leitura_publica"
  on public.produtos for select
  using (disponivel = true and public.loja_esta_ativa(produtos.loja_id));

-- reverter coluna (DROP COLUMN é irreversível — só se nenhum dado de `oculto`
-- precisar ser preservado; ver janela abaixo)
alter table public.produtos drop column oculto;
-- se um índice de suporte tiver sido criado, o DROP COLUMN o remove em cascata.
```

**Janela segura de rollback:** enquanto nenhum lojista tiver setado `oculto = true` em produção. A partir do momento em que existir produto com `oculto = true`, o `DROP COLUMN` perde essa informação (produto volta a ficar visível). A troca de predicado, isolada, é sempre reversível sem perda de dado. Na prática: reverter só o predicado é sempre seguro; reverter a coluna só antes de haver escrita significativa em `oculto`.

### 6. Checklist de validação

- [ ] `npx supabase db reset` local aplica a migration limpo (sem erro de policy inexistente no DROP — a policy existe desde a 20260614002000).
- [ ] Suite de testes de migration passa: `npx vitest run tests/migrations/` — em especial o novo teste RED desta issue e o `rls_catalogo.test.ts` existente (garante que não regrediu o resto do catálogo).
- [ ] RLS testada (isolamento): loja A não vê produto de loja B; anon não vê produto oculto de loja ativa; anon vê produto indisponível não-oculto de loja ativa; anon não vê nada de loja inativa.
- [ ] `produtos_leitura_propria`/`_escrita_propria` inalteradas — dono continua vendo produto oculto e indisponível.
- [ ] Tipos regenerados em `src/lib/database.types.ts` (issue 084) — `oculto: boolean` presente na Row/Insert/Update de `produtos`.
- [ ] `next build` verde (o export de Server Action que escreve `oculto` — se houver na issue de UI — não quebra o build).
- [ ] `npx supabase db push` aplica limpo (migration repair antes, se histórico remoto dessincronizado — ver MEMORY deploy-migrations-cloud).

### 7. Riscos

- **NOT NULL sem default:** N/A — a coluna tem `DEFAULT false`, então `NOT NULL` é seguro em tabela populada. (Se algum dia precisasse ser `NOT NULL` sem default, exigiria backfill antes do `SET NOT NULL` — não é o caso.)
- **Leitores ativos durante a troca de predicado:** a vitrine passa a expor produtos `disponivel = false, oculto = false` imediatamente após o deploy da migration, ANTES de a UI saber renderizar "esgotado". Impacto: produto esgotado aparece como comprável até a issue de UI subir. Mitigação: sequenciar o deploy (migration → tipos → UI) próximos, ou aceitar a janela (produto esgotado comprável é reconciliado no servidor por `criarPedido`, que recusa item indisponível — seguranca.md §10 passo 2; então não gera pedido inválido, só ruído de UX). **Não é vetor de segurança** — o recálculo server-side já barra a compra de indisponível.
- **Custo:** desprezível. ADD COLUMN é metadados; troca de policy é catálogo. Tabela pequena.
- **DROP policy antes do CREATE:** dentro da transação da migration não há janela sem policy. Se, por engano, o DROP for aplicado sem o CREATE (migration cortada pela metade), a leitura pública de produtos cai para deny-all (catálogo some) — não vaza nada, falha fechada. Aceitável.

---

## Teste RED (contrato para o `tdd`)

**Arquivo:** `tests/migrations/rls_produtos_oculto.test.ts` (novo). Segue o padrão de `tests/migrations/rls_catalogo.test.ts` — pglite aplica TODAS as migrations em ordem; harness roda como `asAnon` / `asUser` / `asService`. Cenário montado via `asService` (BYPASSRLS).

**Por que é RED:** a migration `20260621099000_produtos_oculto_rls_publica.sql` ainda NÃO existe. Logo:
- a coluna `oculto` não existe → todo INSERT/SELECT que a referencia **falha** (erro `column "oculto" does not exist`);
- a policy ainda filtra `disponivel = true` → o cenário "anon LÊ produto indisponível não-oculto" retorna 0 linhas (deveria retornar 1 depois da migration) → **falha**.

**Cenário mínimo (montar via `asService`):**
- `DONO_A` (auth.users) → `lojaA` ativa; `DONO_A2` → `lojaAInativa` (RN-01: 1 loja por conta).
- `prodVisivel`: lojaA, `disponivel = true`, `oculto = false` → anon VÊ (1 linha).
- `prodIndispNaoOculto`: lojaA, `disponivel = false`, `oculto = false` → anon VÊ (1 linha) — **este é o cenário-chave que muda de comportamento**.
- `prodOcultoDisp`: lojaA, `disponivel = true`, `oculto = true` → anon NÃO vê (0 linhas; existe via service).
- `prodOcultoIndisp`: lojaA, `disponivel = false`, `oculto = true` → anon NÃO vê (0 linhas; existe via service).
- `prodLojaInativa`: lojaAInativa, `disponivel = true`, `oculto = false` → anon NÃO vê (loja inativa vence; 0 linhas; existe via service).

**Casos (assert por número de linhas + anti-falso-verde via `asService`):**

1. `[oculto-1]` anon LÊ produto `disponivel=true, oculto=false` de loja ativa → **1 linha**.
2. `[oculto-2]` anon LÊ produto `disponivel=false, oculto=false` de loja ativa → **1 linha** (novo comportamento; hoje seria 0). Reconferir via `asService` que a linha existe.
3. `[oculto-3]` anon NÃO lê produto `oculto=true, disponivel=true` de loja ativa → **0 linhas**; `existeId(produtos, prodOcultoDisp) === true` (negação por policy, não por dado ausente).
4. `[oculto-4]` anon NÃO lê produto `oculto=true, disponivel=false` de loja ativa → **0 linhas**; existe via service.
5. `[oculto-5]` anon NÃO lê produto `oculto=false` de loja INATIVA → **0 linhas** (loja ativa continua sendo gate); existe via service. (Prova que a troca de predicado não afrouxou o filtro de loja ativa.)
6. `[oculto-6]` dono A LÊ os PRÓPRIOS produtos ocultos E indisponíveis (`prodOcultoDisp`, `prodOcultoIndisp`, `prodIndispNaoOculto`) via `asUser(DONO_A)` → **3 linhas** (leitura própria inalterada — dono vê tudo).
7. `[oculto-7]` (isolamento) dono B NÃO lê produto oculto de A → **0 linhas**; existe via service.
8. `[oculto-8]` (sanity/default) produto inserido SEM informar `oculto` nasce `oculto = false` — inserir via `asUser(DONO_A)` sem a coluna e reconferir via `asService` que `oculto = false` e que anon o vê (retrocompatibilidade RN-7).
9. `[oculto-9]` `service_role` lê produto oculto (bypass RLS) → 1 linha (sanity do harness).

O caso `[oculto-2]` e a existência da coluna (`[oculto-8]`, INSERT com `oculto`) são os que **falham vermelho** antes da migration. Os casos de negação `[oculto-3..5,7]` passam por deny-parcial hoje (produto oculto ainda não existe como conceito), mas ficam registrados para a fase GREEN não regredir — mesma filosofia anti-falso-verde do `rls_catalogo.test.ts`.

**Comando para confirmar o RED:** `npx vitest run tests/migrations/rls_produtos_oculto.test.ts` — deve falhar com `column "oculto" does not exist` (no `criarCenario`) e/ou o assert de 1 linha em `[oculto-2]`.

### Saída RED capturada (fase `tdd` — 2026-07-01)

Arquivo criado: `tests/migrations/rls_produtos_oculto.test.ts` (9 casos `[oculto-1]`..`[oculto-9]`).

Comando: `npx vitest run tests/migrations/rls_produtos_oculto.test.ts --reporter=verbose`

```
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/migrations/rls_produtos_oculto.test.ts > 083 RLS produtos.oculto — leitura pública por oculto = false
error: column "oculto" of relation "produtos" does not exist
 ❯ pe.Le node_modules/.pnpm/@electric-sql+pglite@0.5.2/node_modules/@electric-sql/pg-protocol/src/parser.ts:432:10
 ...
Serialized Error: { length: 127, severity: 'ERROR', code: '42703', ...
  file: 'parse_target.c', routine: 'checkInsertTargets',
  query: 'insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, oculto)\n ... returning id', ... }

 Test Files  1 failed (1)
      Tests  9 skipped (9)
```

**Confirmação do RED (não é erro de setup/sintaxe):**
- A falha é o Postgres code `42703` (`column "oculto" ... does not exist`), levantada no `criarCenario` (setup do `beforeAll`) porque a migration `20260621099000_produtos_oculto_rls_publica.sql` ainda não existe — a coluna `oculto` não foi criada. Os 9 testes ficam `skipped` porque o setup da suite falha antes das asserções: é o RED por ausência da coluna, exatamente como previsto no contrato.
- Harness confirmado íntegro: `npx vitest run tests/migrations/rls_catalogo.test.ts` segue **36/36 verde** (a falha é isolada ao novo teste, não regressão do catálogo).
- Após a coluna existir, o segundo motivo de RED aparece no `[oculto-2]` (anon lê produto `disponivel=false, oculto=false`): a RLS antiga filtra `disponivel = true` e retorna 0 linhas onde o teste espera 1 — a troca de predicado para `oculto = false` é o que deixa esse caso verde.
