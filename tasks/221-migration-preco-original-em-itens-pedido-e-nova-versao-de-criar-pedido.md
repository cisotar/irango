# [221] Migrations 4 e 5: `itens_pedido.preco_original` + nova versão de `public.criar_pedido`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [220] (`tasks/220-migration-modal-promocoes-em-lojas-e-recriacao-de-vitrine-lojas.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D7 · RN-13
**Fatias críticas:** 5 (`criar_pedido` + snapshot) e 6 (CHECK `preco_original >= preco`) — a metade de banco das duas

## Objetivo

Gravar o preço de tabela ao lado do preço pago, por item, de forma imutável (D7), e
fazer a RPC transacional aceitar esse campo **sem** mudar a assinatura de 17 argumentos.

## Escopo

- [ ] migration 4: `alter table public.itens_pedido add column preco_original numeric(10,2)`
      (NULL = não houve desconto) + `itens_pedido_preco_original_check`
      (`preco_original is null or preco_original >= preco`);
- [ ] migration 5: nova versão de `public.criar_pedido` — **só** o `insert into
      public.itens_pedido` do laço ganha a coluna, lendo
      `(v_item->>'preco_original')::numeric` do jsonb `p_itens`;
- [ ] a assinatura de 17 argumentos de
      `20260913121000_rpc_criar_pedido_frete_a_combinar.sql` **não muda**, e nenhum
      overload novo é criado (`function is not unique` é o erro que isso evitaria);
- [ ] teste em `tests/migrations/`: jsonb **sem** a chave `preco_original` ⇒ coluna NULL,
      sem erro — é a janela de deploy da Vercel, com lambda antiga chamando a RPC nova;
- [ ] teste: jsonb com `preco_original` ⇒ coluna gravada;
- [ ] teste: `preco_original < preco` é recusado pelo CHECK (promoção nunca sobe preço);
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts`.

## Fora de escopo

**Nenhuma regra de desconto entra na RPC.** `preco` e `preco_original` chegam já decididos
pela Server Action a partir do banco — a RPC é transacional, não é oráculo de preço
(`seguranca.md` §10). A derivação dos dois números e a trava de RN-12-a são a issue 229.
A assinatura legada de 16 args continua intocada.

## Reuso esperado

- `supabase/migrations/20260913121000_rpc_criar_pedido_frete_a_combinar.sql` — a versão
  vigente da RPC; a nova é **cópia com uma linha a mais**, não reescrita.
- `tests/helpers/pglite.ts` — `asService` (a RPC é `GRANT EXECUTE TO service_role`).
- família de snapshot imutável já existente: `itens_pedido.nome`, `.preco`, `.observacao`
  (`schema.md` §6).

## Segurança

- Snapshot imutável: editar o produto depois **não** muda pedido nenhum.
- Os dois números vêm do banco, nunca do payload do cliente — o schema zod do pedido
  continua `.strict()` e continua **sem nenhum campo monetário**.
- O CHECK `>= preco` impede o snapshot sem sentido ("de R$ 80 por R$ 100").

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatias 5 e 6): o `FAIL` dos três casos de RPC
      e do CHECK capturado antes do SQL novo;
- [ ] chave ausente no jsonb ⇒ `preco_original` NULL, **sem erro**;
- [ ] a suíte atual de checkout/pedido passa **sem uma única edição** — nenhum teste
      existente é reescrito para caber no SQL novo;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
