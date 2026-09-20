# [244] Migration 3 (D14): coluna `produtos.visibilidade` — expand puro, sem backfill

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D14 · RN-05, RN-13, RN-14
**Fatia crítica:** 16 (D14 no banco) — a metade da coluna

## Objetivo

Dar a todo produto a declaração que decide se ele **some** quando a temporada acaba: "do menu"
(default, comportamento de hoje) ou "de cardápio". A migration é **expand puro** — o default
`'menu'` é constante e não-volátil, então no Postgres 11+ ela não reescreve a tabela, não exige
UPDATE nenhum e **nenhum produto existente muda de aparência**.

## Escopo

- [ ] migration com `alter table public.produtos add column visibilidade text not null
      default 'menu' check (visibilidade in ('menu','cardapio'))` — **sem backfill**, sem
      `UPDATE`, sem etapa de contract;
- [ ] `create index on public.produtos (loja_id, visibilidade)` (o painel conta exclusivos por loja);
- [ ] teste em `tests/migrations/`: asserção 10 de §Segurança — o CHECK recusa
      `visibilidade = 'promocional'` afirmando o nome `produtos_visibilidade_check`;
      `anon` **não** faz UPDATE de `visibilidade`; lojista A **não** muda a `visibilidade` de
      produto da loja B (`produtos_escrita_propria`), com o fragmento da mensagem afirmado;
- [ ] teste de que **toda linha pré-existente** passa a valer `'menu'` sem nenhuma escrita;
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts` — as fatias 2 e 3
      (issues 246 e 247) precisam da coluna no tipo gerado para compor RN-05 e RN-13.

## Fora de escopo

O trigger de RN-14 e a policy `produtos_leitura_publica` alterada (issue 245) — os dois dependem
de `cardapio_produtos` existir, esta coluna não. O `RadioGroup` do `FormProduto` e a ação em lote
"marcar como exclusivo" (issue 261). Qualquer conversão automática de `visibilidade` pelo sistema:
§Fora do Escopo é explícito — converter é gesto do lojista, sempre.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`.
- `produtos_escrita_propria` e `produtos_leitura_publica` — políticas **existentes**, nenhuma
  reescrita nesta issue.
- Convenção texto + CHECK inline em vez de boolean ou `CREATE TYPE` (`schema.md` §5): o nome do
  estado aparece no erro e um terceiro valor futuro é `alter constraint`, não migração de semântica.

## Segurança

- `produtos.visibilidade` é **interno do painel**: não trafega ao cliente. Ela é **entrada** da
  projeção e `ProdutoVitrine` não ganha campo (regra 2 do contrato do Spec A).
- Coluna em tabela que já tem RLS por `loja_id`; a issue **prova** o isolamento em pglite.
- Nenhum valor monetário é tocado.
- `npx supabase db push` é irreversível e exige autorização humana.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes da migration (fatia 16);
- [ ] o RED afirma o nome da constraint do CHECK, não só `23514`;
- [ ] asserção explícita de **não-regressão**: nenhuma linha de `produtos` precisou ser escrita
      para a migration valer, e todas passam a ser `'menu'`;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
