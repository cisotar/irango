# [353] Congelar a categoria do item na venda (snapshot em `itens_pedido` + backfill + `criar_pedido`)

**crítica:** SIM (TDD red-first)
**Mundo:** infra (banco)
**Depende de:** —
**Spec:** specs/relatorio-vendas.md — §4 Banco (behaviors 1, 2 e 3), Migrations A e B; fecha **RN-V14** e a parte de backfill da **RN-V15**

## Objetivo
Gravar em cada `itens_pedido` a categoria (id + nome) que o produto tinha no momento da venda, resolvida pela RPC
`criar_pedido` no servidor, e preencher os itens antigos com a categoria atual. É a base do relatório "itens mais
vendidos por categoria" (issue 355).

## Escopo
- [ ] Migration A (expand + backfill): `itens_pedido.categoria_id_snapshot uuid` e `categoria_nome_snapshot text`,
      ambos nullable e **sem FK** (snapshot imutável, mesma família de `nome`/`preco`); CHECK de par coerente
      `(categoria_id_snapshot IS NULL) = (categoria_nome_snapshot IS NULL)` [direção do spec].
- [ ] Backfill na mesma migration com a categoria **atual**, via `produto_id`, restrito a
      `categorias.loja_id = produtos.loja_id = pedidos.loja_id` (nunca cruzar loja). `produto_id` NULL ou produto sem
      categoria → NULL.
- [ ] Migration B: `CREATE OR REPLACE` da **mesma** `criar_pedido` de 18 argumentos (última versão em
      `supabase/migrations/20261003122000_rpc_criar_pedido_cliente.sql`, INSERT de itens nas linhas ~200-210).
      No loop dos itens, buscar `produtos.categoria_id` + `categorias.nome` por `(v_item->>'produto_id')::uuid`
      **com** `produtos.loja_id = p_loja_id` e `categorias.loja_id = p_loja_id`. Nenhuma chave de categoria do jsonb é
      lida. Assinatura, `SECURITY INVOKER`, `search_path` e grants **inalterados**.
- [ ] Testes pglite em `tests/migrations/` (RED antes das migrations).
- [ ] Patch determinístico de `src/lib/database.types.ts` com as duas colunas (o `gen types` real vem depois do
      `db push`).

## Fora de escopo
- Funções de agregação que leem o snapshot (issue 355).
- Mudar a Server Action `criarPedido` (`src/lib/actions/pedido.ts`): o payload **não** ganha campo.
- Reprocessar o backfill para a categoria "da época" (não há histórico antes da migration).
- Atualizar `references/schema.md` (incluindo o drift de `itens_pedido.preco_original`): é do `escriba`.
- `db push` (passo de sessão, autorizado no loop, depois do GREEN).

## Reuso esperado
- `supabase/migrations/20261003122000_rpc_criar_pedido_cliente.sql` — corpo inteiro da RPC atual como base do
  `CREATE OR REPLACE`; só o INSERT de itens muda.
- `tests/migrations/rpc_criar_pedido.test.ts` e `rpc_idempotencia_criar_pedido.test.ts` — fixtures de loja/produto/
  pedido e chamada da RPC; continuam verdes sem alteração.
- `tests/helpers/pglite.ts` — `createTestDb()` com `asAnon`/`asUser`/`asService`.

## Segurança
- Integridade do pedido: a RPC de checkout é republicada. Qualquer regressão no dedupe de idempotência, cupom,
  `cliente_id` ou valores é bug de dinheiro → a suíte `rpc_criar_pedido*` existente tem de seguir verde.
- Snapshot resolvido **só** a partir de `produto_id` + `p_loja_id`: payload forjado não pode escolher categoria, nem
  puxar categoria de produto/categoria de outra loja.
- RLS: nenhuma policy nova. `itens_pedido` mantém INSERT deny-all para usuário (só a RPC sob `service_role`),
  `itens_pedido_lojista` e `itens_pedido_select_cliente`. Nenhum caminho de UPDATE é criado.

## Critério de aceite
- [ ] **Caso "Coca" (RN-V14):** produto "Coca" em "Bebidas", pedido criado; produto movido para "Refrigerantes";
      novo pedido. O 1º item segue com `categoria_nome_snapshot = 'Bebidas'`, o 2º com `'Refrigerantes'`.
- [ ] **Ataque (RN-V14):** jsonb do item com `categoria_id`/`categoria_nome` forjados → ignorados; grava a categoria
      real do produto.
- [ ] **Ataque cross-loja:** item com `produto_id` de **outra** loja → snapshot NULL (nunca a categoria alheia); a
      validação de item da RPC existente segue valendo.
- [ ] Produto sem categoria no momento da venda → ambos os campos NULL ("Sem categoria").
- [ ] **Backfill (RN-V15):** item antigo de produto já apagado (`produto_id` NULL) → NULL; item antigo de "Coca" hoje
      em "Refrigerantes" → `'Refrigerantes'`; item cuja categoria pertence a loja diferente da do pedido → NULL.
- [ ] CHECK de par recusa `(id não nulo, nome nulo)` e vice-versa — afirmar o **nome da constraint/fragmento da
      mensagem**, não só o SQLSTATE.
- [ ] `pg_get_function_identity_arguments` de `criar_pedido` igual ao de antes (18 args, mesma ordem); só uma
      versão da função existe.
- [ ] Teste vermelho com `FAIL` capturado (coluna inexistente / snapshot nulo) antes das migrations; depois verde.
- [ ] `npx vitest run tests/migrations` verde, incluindo `rpc_criar_pedido*`; `npx tsc --noEmit` limpo.
