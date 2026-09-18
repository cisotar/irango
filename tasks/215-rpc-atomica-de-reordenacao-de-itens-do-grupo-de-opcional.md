# [215] RPC atômica de reordenação de itens dentro do grupo de opcional

**crítica:** SIM — escrita de ordem é autorização, não CRUD. TDD red-first obrigatório.
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md`.
**depende de:** nada — pode rodar em paralelo com a 214. **Bloqueia a 216.**
**fecha junto:** `tasks/211-atomicidade-da-reordenacao-de-opcionais-no-admin.md`.

## Problema

`opcionais.ordem` é a ordem dos itens dentro de um grupo, e a vitrine já a respeita
(`src/lib/supabase/queries/produtos.ts`, ~linha 220). No painel, porém, ela só é gravável por
um campo numérico digitado à mão no form da Biblioteca. Não existe reordenação de itens.

Somado a isso, a reordenação **de grupos** no hub admin
(`reordenarOpcionaisDaCategoriaAdmin`, `src/app/admin/assinantes/actions/admin-opcionais.ts`)
grava com N `update` sequenciais **fora de transação** — é o débito 211. Queda de rede no 3º
de 5 deixa posições 0,1,2 gravadas e 3,4 antigas; sem unique em `(categoria_opcional_id,
ordem)` o resultado é `ordem` duplicada e vitrine não determinística.

## Escopo

Uma RPC **`security definer`** com `p_loja_id` explícito, servindo **os dois caminhos**
(lojista e hub admin), mais a action, o schema zod e o espelho admin. E a troca da
reordenação de grupos do admin pelo mesmo desenho atômico — é isso que fecha o 211.

**Por que `definer` e não `invoker`:** o admin roda sob `service_role`, onde a RLS não vale;
uma `invoker` não serve, e é exatamente por isso que o admin hoje grava à mão. Como `definer`
escapa da RLS **por construção**, o escopo deixa de ser garantido pelo banco e passa a ser
responsabilidade do corpo da função — o checklist das 7 travas de `seguranca.md` §2 é refeito
**do zero**, e `p_loja_id` é sempre provado pelo chamador (derivado de `auth.uid()` no
lojista, do escopo admin auditado na via admin), nunca aceito do payload do cliente.

**Molde estrutural:** `supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql`
— `cardinality()` (**nunca** `array_length`), permutação completa conferida por `row_count`,
`ordem` derivada de `ordinality - 1`, `revoke ... from public, anon` +
`grant execute to authenticated, service_role`. O que **não** se copia de lá é o
`security invoker`.

**Escopo da permutação (decisão do usuário):** o par `(loja_id, categoria_opcional_id)`
**inteiro**, incluindo itens com `ativo = false`. O painel enxerga os inativos e manda todos
os ids; a vitrine não renderiza os inativos e continua lendo a ordem certa (0,1,3 ordena
igual a 0,1,2). Exigir só os ativos faria o painel mandar mais ids do que a RPC espera e
derrubar a transação por `row_count`.

## Fora de escopo

Qualquer UI (216 e 217). Unique em `(categoria_opcional_id, ordem)` — não é necessário quando
a escrita é atômica e a permutação é completa.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes de qualquer linha de produção;
- [ ] migration em `supabase/migrations/` criando a RPC;
- [ ] prova em pglite (`tests/migrations/`, via `createTestDb()` de `tests/helpers/pglite.ts`)
      de que a RPC **recusa `p_loja_id` de outra loja mesmo sob `service_role`** — é a trava
      que substitui a RLS perdida com o `definer`;
- [ ] prova em pglite de **atomicidade**: falha no meio da permutação não deixa posição
      parcial gravada;
- [ ] permutação incompleta, id de outra loja, id inexistente ou duplicado → transação cai;
- [ ] action do lojista + espelho admin + schema zod (`.min(2)`), ambos apontando para a
      mesma RPC;
- [ ] `reordenarOpcionaisDaCategoriaAdmin` passa a gravar atomicamente (fecha o 211);
- [ ] `npx supabase db push` **com autorização humana explícita** (irreversível);
- [ ] depois do push: `npx supabase migration list` com `Remote` preenchida **e**
      `npx supabase gen types typescript > src/lib/database.types.ts` — a RPC precisa aparecer
      em `Database["public"]["Functions"]` ou a action não tipa;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.
