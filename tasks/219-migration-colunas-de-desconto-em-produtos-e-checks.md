# [219] Migration 1: colunas de desconto em `produtos` + os cinco CHECKs

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D10 · RN-01, RN-03, RN-04, RN-05, RN-06, RN-07
**Fatia crítica:** 6 (RLS + CHECKs das colunas de desconto)

## Objetivo

Dar ao banco as cinco colunas que sustentam o desconto por produto (D1) e os CHECKs
que impedem, no último nível, uma configuração monetária incoerente. É a primeira
migration do trabalho: nada depende dela para existir, tudo depende dela para valer.

## Escopo

- [ ] migration em `supabase/migrations/` com:
      `desconto_ativo boolean not null default false`, `desconto_tipo text`,
      `desconto_valor numeric(10,2)`, `desconto_inicio timestamptz`,
      `desconto_fim timestamptz` em `public.produtos`;
- [ ] `produtos_desconto_tipo_check` — `null` ou `in ('percentual','fixo')`
      (enum inline, convenção de `schema.md` §5: CHECK, nunca `CREATE TYPE`);
- [ ] `produtos_desconto_coerente_check` — ligado exige tipo **e** valor (RN-07:
      desligado preserva a configuração, então a coerência só é exigida quando `ativo`);
- [ ] `produtos_desconto_percentual_check` — percentual em `(0, 100]` (RN-04);
- [ ] `produtos_desconto_fixo_check` — `desconto_valor <= preco`, cross-column (RN-05, RN-06/D10);
- [ ] `produtos_desconto_prazo_check` — `fim > inicio` quando os dois existem (RN-03);
- [ ] teste em `tests/migrations/` via `createTestDb()` de `tests/helpers/pglite.ts`:
      lojista A (`asUser`) **não** liga nem edita desconto em produto da loja B —
      afirmando o **fragmento da mensagem** além do SQLSTATE;
- [ ] os quatro casos de CHECK recusados: percentual 101; fixo maior que o preço;
      `desconto_ativo = true` sem tipo/valor; `desconto_fim <= desconto_inicio`;
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts` (as colunas novas
      precisam aparecer em `Tables<"produtos">`).

## Fora de escopo

Nenhuma política RLS nova — `produtos_acesso_proprio` e `produtos_leitura_publica` já
existem e a RLS filtra **linha**, não coluna. O índice parcial
`create index on public.produtos (loja_id) where desconto_ativo` é decisão do `acelerar`
**depois** do `executar` (§Modelos de Dados); não entra aqui.
Nada de coluna "expirada" nem job de expiração: a vigência é avaliada por request (RN-03).

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`; não escrever helper novo.
- convenção de nome de constraint e de enum inline já usada em `cupons.tipo` (`schema.md`).
- `produtos_acesso_proprio` — política existente, **não** reescrever.

## Segurança

- Valor monetário: sim. O CHECK é **defesa em profundidade**, não a barreira principal —
  a barreira legível é o zod + Server Action (issue 230). O `23514` nunca vira texto na UI:
  mensagem genérica, detalhe no log (`seguranca.md` §14).
- Tabela tocada já tem RLS por `loja_id`; a issue **prova** o isolamento em pglite, não presume.
- `npx supabase db push` é irreversível e exige autorização humana — não é critério desta issue.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 6): o `FAIL` das asserções de
      CHECK e de escopo cross-loja capturado antes de a migration existir;
- [ ] lojista A recebe recusa ao escrever desconto em produto da loja B, com o fragmento
      da mensagem afirmado (não só o SQLSTATE);
- [ ] linhas existentes de `produtos` continuam válidas sob os cinco CHECKs
      (todas nascem `desconto_ativo = false` com os quatro campos NULL);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
