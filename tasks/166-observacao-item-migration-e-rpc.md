# [166] Migration: coluna `observacao` em `itens_pedido` + RPC `criar_pedido`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Criar a coluna `observacao text` em `itens_pedido` com CHECK de 200 caracteres e
atualizar a RPC `public.criar_pedido` para gravá-la a partir de `p_itens`. É a
issue que **bloqueia todas as outras** desta spec: sem a coluna no cloud, o tipo
gerado não tem o campo e tudo a jusante compila mas quebra em runtime
(`PGRST204`).

## Escopo

- [ ] Migration nova `supabase/migrations/<timestamp>_itens_pedido_observacao.sql`:
      `ALTER TABLE itens_pedido ADD COLUMN observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 200);`
      — aditiva, nullable, sem backfill (tabela populada; `NULL` = sem observação).
- [ ] Na **mesma** migration, `CREATE OR REPLACE FUNCTION public.criar_pedido(...)`
      a partir da última versão (`20260614009500_rpc_criar_pedido_idempotencia.sql`),
      **assinatura inalterada**. No `insert into public.itens_pedido` dentro do
      `for v_item in select * from jsonb_array_elements(p_itens)` (~l.129-139),
      acrescentar a coluna `observacao` lendo
      `left(nullif(trim(v_item->>'observacao'), ''), 200)` — `NULLIF(trim(...),'')`
      normaliza vazio/whitespace para `NULL` e o `left(...,200)` é truncamento
      defensivo para o CHECK nunca abortar o pedido inteiro.
- [ ] Preservar intactos: `loja_esta_ativa`, dedupe por idempotência, trava atômica
      de cupom, `INSERT` em `itens_pedido_opcionais`, `SECURITY INVOKER`,
      `search_path=public`.
- [ ] Estender `tests/migrations/rpc_criar_pedido.test.ts` (não criar arquivo novo)
      com o RED: (a) observação persiste via `p_itens`; (b) `''` e `"   "` viram
      `NULL`; (c) 201 caracteres não aborta o pedido e grava 200; (d) item sem o
      campo grava `NULL`; (e) `asAnon` continua sem `INSERT` em `itens_pedido`.
- [ ] Regenerar `src/lib/database.types.ts` (`npx supabase gen types typescript`)
      **depois** do `db push` — `gen types` lê o cloud, não as migrations locais.
- [ ] Rollback documentado no cabeçalho da migration: `DROP COLUMN observacao` +
      `CREATE OR REPLACE` de volta na versão anterior da RPC.

## Fora de escopo

- Executar `npx supabase db push` sem autorização explícita do humano — é
  irreversível em tabela populada. O push e o `gen types` são **marco humano**,
  não passo automático da issue.
- Qualquer policy RLS nova (issue não tem: a coluna herda as políticas de
  `itens_pedido`).
- Contrato zod e normalização em TypeScript → issue 167.
- `supabase/seed.sql` — vem depois, via `popular`.

## Reuso esperado

- `supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql` — copiar o
  corpo atual da RPC e alterar só o `INSERT` do loop; **não** reescrever a função.
- `supabase/migrations/20260614008000_rpc_criar_pedido_opcionais.sql` — precedente
  de campo que viaja dentro de `p_itens` sem mudar a assinatura.
- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`.
- `tests/migrations/rpc_criar_pedido.test.ts` — estender.

## Segurança

- `INSERT` em `itens_pedido` é **exclusivo da RPC sob `service_role`**
  (`seguranca.md` §`itens_pedido`, achado #3A). A observação **não abre via nova de
  escrita**: entra pelo `p_itens` já existente.
- Input não-confiável: o CHECK é defesa em profundidade; a autoridade de tamanho é
  o zod da issue 167. O truncamento no SQL evita que um payload malicioso de 201
  chars derrube o pedido inteiro pelo CHECK.
- Coluna **não** é campo de billing/identidade — fora de qualquer trigger de
  proteção.
- Nenhum valor monetário envolvido: a observação não entra em nenhum cálculo.

## Critério de aceite

- [ ] Teste vermelho escrito e com `FAIL` capturado **antes** do SQL de produção.
- [ ] `npx vitest run tests/migrations/rpc_criar_pedido.test.ts` verde em pglite,
      sem tocar o cloud.
- [ ] Pedido criado pela RPC com `observacao: "sem cebola"` no `p_itens` retorna a
      string gravada em `itens_pedido.observacao`.
- [ ] `observacao: "   "` grava `NULL`; item sem o campo grava `NULL`.
- [ ] `observacao` de 201 caracteres não lança: grava exatamente 200.
- [ ] `asAnon` continua recebendo erro ao tentar `INSERT` em `itens_pedido`.
- [ ] Após o marco humano: `npx supabase migration list` mostra `Remote` preenchido
      e `src/lib/database.types.ts` lista `itens_pedido.Row.observacao: string | null`.
