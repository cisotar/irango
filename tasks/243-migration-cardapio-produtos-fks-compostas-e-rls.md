# [243] Migration 2: `cardapio_produtos` com as **FKs compostas** + RLS

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [242] (`tasks/242-migration-cardapios-checks-de-vigencia-e-rls.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2 · RN-09, RN-10
**Fatia crítica:** 1 (migration + RLS de `cardapios` e `cardapio_produtos`) — a metade do vínculo

## Objetivo

Criar o vínculo produto↔cardápio de modo que o vetor cross-tenant da ação em lote seja
**impossível**, não meramente checado: as duas FKs compostas amarram `(cardapio_id, loja_id)`
e `(produto_id, loja_id)` à mesma loja que a própria linha declara.

## Escopo

- [ ] migration com `create table public.cardapio_produtos` (`id`, `loja_id` FK `lojas`
      `on delete cascade`, `cardapio_id`, `produto_id`, `criado_em`);
- [ ] `constraint cardapio_produtos_cardapio_fk foreign key (cardapio_id, loja_id)
      references public.cardapios (id, loja_id) on delete cascade`;
- [ ] `constraint cardapio_produtos_produto_fk foreign key (produto_id, loja_id)
      references public.produtos (id, loja_id) on delete cascade`;
- [ ] `unique (cardapio_id, produto_id)` — é o alvo do `on conflict do nothing` que torna
      reaplicar idempotente (RN-10);
- [ ] `create index on public.cardapio_produtos (loja_id, cardapio_id)` e
      `create index on public.cardapio_produtos (produto_id)` (o segundo é o índice que o
      `EXISTS` da policy alterada da issue 245 usa);
- [ ] `enable row level security` + as três políticas literais de §Segurança:
      `cardapio_produtos_leitura_publica` (`public.loja_esta_ativa(loja_id)`),
      `cardapio_produtos_leitura_propria`, `cardapio_produtos_escrita_propria`
      (`using` **e** `with check`);
- [ ] testes em `tests/migrations/`: asserções 3, 4 e 6 de §Segurança — lojista A **não** grava
      vínculo com `produto_id` da loja B, afirmando o nome `cardapio_produtos_produto_fk`;
      **não** grava com `cardapio_id` da loja B, afirmando `cardapio_produtos_cardapio_fk`;
      `anon` não faz INSERT/UPDATE/DELETE;
- [ ] teste de que o vínculo legítimo (mesma loja nas três pontas) passa, e que reinserir
      o mesmo par é recusado pelo `unique`;
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts`.

## Fora de escopo

A Server Action que grava o lote (issue 251) e a RPC de categoria (issue 250) — aqui só existe
a **trava estrutural** que elas usam. O trigger de RN-14 (issue 245), que depende desta tabela
existir. Nenhum pre-check de posse em JS: é TOCTOU, e a decisão está tomada em RN-09.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`.
- `public.loja_esta_ativa(loja_id)` na policy pública (mesma razão da issue 242).
- O desenho de tabela de junção com `loja_id` redundante de `categoria_produto_opcionais`.
  **Melhoria deliberada, não cópia:** lá a posse cruzada é checada na Server Action
  (`categoriaPertenceALoja`, `produto.ts:38`); aqui é **estrutural**, porque a lista de ids vem
  do cliente. O padrão novo é estritamente mais forte e não invalida o antigo.

## Segurança

- `cardapio_produtos_escrita_propria` valida **só** `cardapio_produtos.loja_id`. Sozinha, ela
  deixaria passar `{loja_id: própria, produto_id: de outra loja}` — o IDOR clássico da ação em
  lote. **São as FKs compostas que fecham isso**, e elas valem também sob `service_role`
  (FK não é RLS).
- Tabela nova ⇒ RLS obrigatória antes de produção (`seguranca.md` §2).
- `23503` nunca vira texto na UI (§14); a mensagem ao lojista é uma só e genérica (RN-09).

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes da migration (fatia 1);
- [ ] o RED afirma o **nome da constraint** (`cardapio_produtos_produto_fk` e
      `cardapio_produtos_cardapio_fk`), não só `23503`;
- [ ] `asService` também não consegue gravar um vínculo misturando lojas — prova de que a
      trava não é RLS;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
