# [250] Migration 4: a RPC `aplicar_cardapio_em_categoria` (`SECURITY INVOKER`, T1–T4)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [243] (`tasks/243-migration-cardapio-produtos-fks-compostas-e-rls.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2 · RN-09, RN-10
**Fatia crítica:** 5 (ação em lote) — a metade de banco

## Objetivo

Dar ao painel a única operação que o PostgREST não faz — "aplicar a uma **categoria inteira**" é
um `insert ... select` — **dentro da transação**, para que o TOCTOU de ler a lista em JS e mandá-la
de volta simplesmente não exista.

## Escopo

- [ ] migration com `create or replace function public.aplicar_cardapio_em_categoria(
      p_loja_id uuid, p_cardapio_id uuid, p_categoria_id uuid) returns integer`,
      `language plpgsql`, **`security invoker`**, `set search_path = public`;
- [ ] as quatro travas, **nesta ordem**: T1 parâmetro nulo; T2 **autoridade**
      (`lojas where id = p_loja_id and dono_id = auth.uid()`); T3 coerência do par
      `(loja, cardapio)` e `(loja, categoria)` — **depois** de T2, ou viraria oráculo de
      existência em loja alheia (`seguranca.md` §2); T4 o `insert ... select` com
      `on conflict (cardapio_id, produto_id) do nothing` e `get diagnostics`;
- [ ] as mensagens de `raise exception` **literais**: `loja alheia`, `cardapio fora da loja`,
      `categoria fora da loja`, `parametro nulo`;
- [ ] `revoke all on function ... from public, anon` + `grant execute ... to authenticated`
      — o Postgres concede EXECUTE a PUBLIC por padrão e o projeto **não** tem
      `alter default privileges ... on functions`: sem o revoke, `anon` executaria com a chave
      do bundle;
- [ ] a RPC inclui produtos `oculto` e `disponivel = false` (RN-10) — participar de um cardápio
      é ortogonal a esses dois eixos;
- [ ] testes em `tests/migrations/`: `p_loja_id` de outra loja ⇒ fragmento `loja alheia`;
      `p_cardapio_id` alheio ⇒ `cardapio fora da loja`; `p_categoria_id` alheio ⇒
      `categoria fora da loja`; `p_categoria_id` nulo ⇒ recusado por T1; reaplicar é idempotente
      (segunda chamada devolve 0 e não duplica linha); `anon` **não** consegue executar;
      **`asService` falha em T2** (`auth.uid()` NULL) — a função fail-closes para a via de serviço.

## Fora de escopo

A Server Action que a chama e a `preverLoteAction` (issue 251). Aplicar a "Sem categoria"
(`categoria_id is null`): usa o caminho de seleção explícita, e `p_categoria_id` nulo é recusado
por T1 **de propósito**, para não haver dois significados para o mesmo parâmetro. Gestão de
cardápio no hub admin (§Fora do Escopo): **não acrescentar `grant` para `service_role`** — o dia
em que entrar, a conversão é `SECURITY DEFINER` + T1–T7 de `seguranca.md` §2 com
`coalesce(auth.role(), '')` e `set search_path = public, pg_temp`, nunca só o grant.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`.
- O padrão de RPC de escrita em lote do lojista já documentado em `seguranca.md` §2
  ("RPC de escrita em lote do lojista", issues 175/208) e o precedente de
  `reordenar_categorias` (`20260908120000`): id alheio derruba a transação inteira, "nada é
  escrito em nenhuma das duas lojas".
- As FKs compostas da issue 243 — a segunda camada, que vale mesmo se a RPC for burlada.

## Segurança

- **`authenticated`, não `service_role`, de propósito.** Sob `service_role` `auth.uid()` é NULL e
  T2 falha: fail-closed para uma via que ainda não existe, e isso é **testado**.
- T3 depois de T2 é regra, não estilo: a ordem inversa confirmaria a existência de cardápio ou
  categoria em loja alheia.
- **Nenhum valor do cliente entra numa coluna**: as linhas gravadas são derivadas do `SELECT` no
  servidor.
- `raise exception` é **para o log e para o teste**, nunca para a tela (§14).

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes da RPC existir (fatia 5);
- [ ] os três fragmentos literais afirmados — `loja alheia`, `cardapio fora da loja`,
      `categoria fora da loja` — não só o SQLSTATE;
- [ ] `anon` recusado por falta de privilégio, com asserção explícita;
- [ ] `asService` recusado por T2;
- [ ] idempotência provada por duas chamadas seguidas;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
