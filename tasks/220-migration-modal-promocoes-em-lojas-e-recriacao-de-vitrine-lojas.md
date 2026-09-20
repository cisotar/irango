# [220] Migrations 2 e 3: `lojas.modal_promocoes` + recriação de `public.vitrine_lojas`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [219] (`tasks/219-migration-colunas-de-desconto-em-produtos-e-checks.md`) — só para manter a ordem de timestamp das cinco migrations
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D6 · RN-16
**Fatia crítica:** 7 (`vitrine_lojas` recriada + allowlist de `modal_promocoes`) — metade de banco

## Objetivo

Criar a preferência de loja `modal_promocoes` (D6: **default ligado**) e recriar a view
`public.vitrine_lojas` para que o SSR da vitrine consiga lê-la. Recriar essa view é o
ponto mais perigoso do trabalho inteiro: ela é a **única** porta de leitura pública da
loja, e uma coluna a menos derruba a vitrine em silêncio.

## Escopo

- [ ] migration 2: `alter table public.lojas add column modal_promocoes boolean not null default true`;
- [ ] migration 3: `drop view if exists public.vitrine_lojas` + `create view ... with (security_invoker = false)`
      com **todas** as colunas da definição **vigente** no momento da implementação
      **mais** `modal_promocoes`;
- [ ] conferir a lista de colunas contra a última migration que tocou a view
      (`logo_url` e `taxa_entrega_fora_zona` entraram **depois** de
      `20260614005000_vitrine_lojas_assinatura.sql` — `grep` na pasta antes de escrever);
- [ ] re-aplicar `grant select on public.vitrine_lojas to anon, authenticated` **na mesma
      migration** — `drop` + `create` recria privilégios do zero;
- [ ] teste em `tests/migrations/`: `asAnon` lê a view e **todas as colunas anteriores
      continuam presentes** (asserção por lista de colunas, não por "não deu erro");
- [ ] teste: `asAnon` **não** consegue `UPDATE`/`INSERT`/`DELETE` na view
      (defesa em profundidade, `seguranca.md` §19);
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts` — `LojaPublica` é
      `Tables<"vitrine_lojas">` e é **gerado depois**, por isso o `tsc` não pega coluna faltando.

## Fora de escopo

A allowlist de `montarPatchPerfil` e as Server Actions que gravam o campo (issue 231).
O toggle na tela de perfil (issue 236). O `ModalPromocoes` (issue 234).
`modal_promocoes` **não** entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR` nem na lista de 14
colunas de `lojas_protege_billing()` — não é billing e não é PII.

## Reuso esperado

- `supabase/migrations/20260614005000_vitrine_lojas_assinatura.sql` — precedente exato de
  `drop` + `create` desta view; copiar a forma, não inventar outra.
- `supabase/migrations/20260702140000_vitrine_lojas_revoke_escrita.sql` — o §2 dela já
  alterou os *default privileges* do schema, então a view nova **não** reganha escrita
  automaticamente; o teste de `anon` sem `UPDATE` fica como cinto-e-suspensórios.
- `tests/helpers/pglite.ts` — `asAnon`.

## Segurança

- `modal_promocoes` é preferência de UI: **não é PII, não é billing**. Exposição na view
  pública avaliada e aceita (§Modelos de Dados).
- O risco residual desta migration é **disponibilidade**, não escalonamento: perder o
  `grant select` ou uma coluna derruba a vitrine para todo mundo, sem erro de CI.
- `create or replace view` não permite mudar a lista de colunas — `drop` + `create` é
  obrigatório, e as três armadilhas são consequência disso.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 7): a asserção de "todas as
      colunas anteriores presentes" falha **antes** da migration nova existir;
- [ ] `anon` carrega a vitrine pela view depois da recriação;
- [ ] `anon` é recusado em `UPDATE` na view;
- [ ] loja nova nasce com `modal_promocoes = true` (D6);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
