# [294] Drop de pedidos_insert_publico: INSERT de pedido só via RPC service_role

**crítica: SIM** — RLS + grant; TDD red-first em pglite. Severidade: MÉDIA.

## O problema

`pedidos` tem RLS habilitada (`20260614000129_schema_inicial.sql:187`) e a policy
`pedidos_insert_publico` (`20260614002500_rls_cupons_pedidos.sql:46-48`, sem cláusula `to` →
`roles = {public}`) deixa `anon` **e qualquer `authenticated`** (inclusive o lojista B contra a
loja A) inserir qualquer linha em loja **ativa**, sem posse, sem token e sem checar valor. O grant
de tabela (`20260614008500_grants_roles_supabase.sql:20`, `GRANT ALL ON ALL TABLES IN SCHEMA
public TO anon, authenticated, service_role`) nunca foi revogado para `pedidos`. Resultado: quem
usa a anon key pública grava pedido com `total`/`subtotal`/`nome_cliente`/`endereco_entrega`
arbitrários, fora do recálculo (`seguranca.md` §10) e fora do rate limit de `criarPedido`. O
forjador escolhe `id`, `token_acesso`, `status` e `criado_em` (colunas comuns com default, sem
CHECK de sinal em `total`): detém o par `(id, token)` e a página `/confirmacao` e
`consultarStatusPedido` renderizam o pedido forjado sob a marca da loja; `status` direto contorna
a máquina de estados RN-08 (que só vive no UPDATE, `status.ts:57-60`).

Contido na classe: `itens_pedido` é deny-all desde `20260708130000` (o pedido forjado nasce sem
itens); sem SELECT anon em `pedidos` (não lê pedidos reais); `pedidos` não tem `cupom_id`, só
`cupom_codigo text` (não consome cupom); nenhum trigger em `pedidos`/`cupons`; nenhuma outra
tabela com INSERT `{public}` vivo. Impacto: spam/poluição de pedidos no painel de qualquer loja
ativa + confirmação forjada.

O caminho legítimo é `svc.rpc("criar_pedido", …)` em `src/lib/actions/pedido.ts:479-522`, com
`svc = createServiceClient()` (`pedido.ts:97`). A RPC é `SECURITY INVOKER`
(`20260920127000_rpc_criar_pedido_preco_original.sql:89`), com EXECUTE revogado de anon e
authenticated e concedido só a `service_role` (`:219-230`). `service_role` tem BYPASSRLS, então o
drop da policy não afeta o checkout. Nenhum `.from("pedidos").insert` em `src/`.

## Correção proposta

Migration `supabase/migrations/<ts>_pedidos_remove_insert_publico.sql`:

```sql
drop policy if exists "pedidos_insert_publico" on public.pedidos;
revoke insert on public.pedidos from anon, authenticated;
```

O revoke é a segunda camada: se alguém reintroduzir policy permissiva de INSERT, o grant continua
fechado. Efeito colateral declarado: o lojista perde o INSERT direto em `pedidos` da própria loja
via PostgREST (hoje coberto por `pedidos_acesso_lojista` FOR ALL, mas nenhum código usa isso).
Novo contrato: "INSERT em `pedidos` só pela RPC `criar_pedido` sob `service_role`". A policy
`pedidos_acesso_lojista` não é tocada; SELECT/UPDATE/DELETE do lojista seguem iguais.

Acompanha a remoção do laço `do $grants$ … end $grants$;` de `tests/helpers/pglite.ts:83-95`, que
reconcedia `insert, update, delete` a anon/authenticated em toda tabela base depois das migrations
e mascarava qualquer revoke em teste (experimento: 843/847 verdes rodando `tests/migrations/`
inteiro sem o laço; as 4 falhas restantes são asserções de mensagem `/row-level security/` que
precisam aceitar também `/permission denied/`, porque passam a refletir negação por grant, não por
RLS).

## Critério de aceite

- [ ] `[10]` de `rls_cupons_pedidos.test.ts` invertido: `asAnon` não insere pedido em loja ativa
      (deny-all pós-remoção de `pedidos_insert_publico`)
- [ ] `[D1]` `asAnon` e `[D1b]` `asUser` de outra loja não inserem pedido em
      `pentest_area2_isolamento.test.ts` (novo describe `[D]`)
- [ ] `[D2]` snapshot de `pg_policies` de `pedidos` == só `pedidos_acesso_lojista`
- [ ] `[D3]` nenhuma sobrecarga de `criar_pedido` executável por anon/authenticated (guard, já
      verde hoje)
- [ ] `[D4]` `has_table_privilege` para INSERT em `pedidos`: `anon=false`, `authenticated=false`,
      `service_role=true`, direto após `createTestDb()`, sem reexecutar a migration
- [ ] Harness `tests/helpers/pglite.ts` sem o laço que reconcede escrita em tabela base; suíte
      `tests/migrations/` inteira verde (847/847)
- [ ] `rpc_criar_pedido.test.ts` (28 casos) e `pedidos_frete_a_combinar.test.ts` sem regressão
- [ ] Casos do dono da loja em `rls_cupons_pedidos.test.ts` (`[1][5][6][13][14][16][21]`) sem
      regressão
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`
- [ ] `references/seguranca.md` e `references/schema.md` sem menção à policy pública de INSERT em
      `pedidos`

## Fora de escopo

`pedidos_acesso_lojista`, `loja_esta_ativa`, sobrecarga de 16 args de `criar_pedido` (`tasks/266`).

## Origem

Auditoria estática de 2026-09-22 sobre `947b6ea`, revisada em 2026-09-23.
