# [282] `EscopoLoja.atualizar`/`atualizarPorChave`: strip em runtime de `loja_id`, `id` e colunas da chave no patch

**crítica: SIM** — primitivo de escrita sob `service_role`. Severidade da auditoria: **BAIXA**.

**Depende de:** [274] (entregue).

## Origem

Auditoria da issue 274 em `e002c1c` (branch `feat/vigencia-por-item-do-cardapio`).

## O problema

`atualizarPorChave` (`src/lib/actions/admin-loja.ts`) e `atualizar` protegem o patch só pelo tipo
(`Omit<Update, "loja_id" | "id" | K>`). Um caller futuro com cast (`as never`) consegue mandar
`loja_id` + colunas da chave de outra loja e o UPDATE re-parenteia a linha para outro tenant.
Prova em pglite sob `service_role`: patch só com `loja_id` alheio ⇒ `23503` (FK composta segura);
patch com `loja_id` + `cardapio_id` + `produto_id` alheios ⇒ 1 linha movida. Sem vetor a partir do
cliente: os payloads passam por zod `.strict()` antes.

## Correção proposta

Mesmo padrão de `atualizarLoja` (strip em runtime):

```ts
const bloqueadas = new Set(["loja_id", "id", ...colunas.map(([c]) => c)]);
const seguro = Object.fromEntries(
  Object.entries(patch as Record<string, unknown>).filter(([k]) => !bloqueadas.has(k)),
);
```

## Critério de aceite

- [ ] RED em `admin-loja.test.ts`: patch com `loja_id`/`id`/coluna da chave via cast ⇒ `op.payload`
      sem essas chaves, nas duas funções.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
