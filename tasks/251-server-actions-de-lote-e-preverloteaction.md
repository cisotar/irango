# [251] Ação em lote: `aplicarCardapioEmProdutos` / `tirarDeCardapio` + `preverLoteAction` (RN-09-a)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [250] (`tasks/250-migration-rpc-aplicar-cardapio-em-categoria.md`) e [243] (`tasks/243-migration-cardapio-produtos-fks-compostas-e-rls.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2, D14 · RN-09, RN-09-a, RN-10, RN-11 · design §10.2, mecanismo M8
**Fatia crítica:** 5 (ação em lote) — a metade de Server Action

## Objetivo

Receber do cliente **uma lista de ids** — o vetor clássico de IDOR — e gravar sem nenhum
pre-check em JS, deixando a trava estrutural derrubar a operação inteira; e entregar a
**prévia do servidor** que o diálogo de confirmação exige, para que nenhuma confirmação seja
feita sobre contagem do cliente.

## Escopo

- [ ] `src/lib/actions/cardapio.ts` com `aplicarCardapioEmProdutos({ cardapio_id, produto_ids })`,
      `aplicarCardapioEmCategoria({ cardapio_id, categoria_id })` (chama a RPC da issue 250) e
      `tirarDeCardapio(...)`;
- [ ] `loja_id` vem de `buscarLojaDoDono` (`auth.uid()`), **nunca** do payload — padrão já usado
      em `produto.ts` e `cupom.ts`;
- [ ] gravação como **um `upsert` homogêneo**
      (`.upsert(linhas, { onConflict: "cardapio_id,produto_id", ignoreDuplicates: true })`):
      uma instrução, uma transação. **Sem pre-check de posse em JS** — um `SELECT` antes do
      `INSERT` é TOCTOU, e a decisão já está tomada (mesmo racional de `reordenarCategorias`,
      `produto.ts:326-328`);
- [ ] zod em `src/lib/validacoes/cardapio.ts`: `.max(200)` na lista, **sem duplicata**, array
      **novo produzido pelo parse** (propriedade hostil pendurada no array do cliente não
      sobrevive) — mesma forma de `schemaReordenacaoCategorias`. CWE-770;
- [ ] **uma** mensagem, genérica, para id alheio, id inexistente, cardápio alheio e falha de
      banco: `"Não foi possível aplicar o cardápio aos produtos selecionados."`;
- [ ] `preverLoteAction({ produto_ids } | { categoria_id })
      : { ok: true; total: number; nomes: string[] } | { ok: false; erro: string }` — **não grava
      nada**, usa **o mesmo zod** da gravação, lê
      `select id, nome from produtos where id in (...) and loja_id = <própria>`;
- [ ] `nomes` limitado a **6** (o desktop mostra 6, o mobile 3 — design §10.3); `total` é a
      contagem inteira. Para `categoria_id`, a contagem é dos produtos da categoria **agora**,
      a mesma leitura que a RPC fará;
- [ ] com D14, a prévia devolve também os **dois números** que o diálogo precisa (quantos dos
      selecionados são `'menu'` e quantos `'cardapio'`), pela mesma leitura — o cliente não
      conta nada;
- [ ] `revalidatePath("/painel/cardapios")`, `revalidatePath("/painel/produtos")` e
      ``revalidatePath(`/loja/${loja.slug}`)`` — **o slug da própria loja**, nunca a forma
      coringa `("/loja/[slug]", "page")` (RN-11).

## Fora de escopo

A barra de seleção e o diálogo (issues 260 e 261) — aqui é servidor. `CAMINHO_PAINEL` de
`produto.ts:25`: `"/painel/cardapio"` não existe como rota e os `revalidatePath` que o consomem
são no-op (débito conhecido, `architecture.md` §10) — **não** reusar. Mensagens distintas por
tipo de falha: virariam oráculo de existência de id (`seguranca.md` §14). Contagem de
"ignorados" na prévia: mesma razão.

## Reuso esperado

- `buscarLojaDoDono` — fonte única de `loja_id`.
- `schemaReordenacaoCategorias` — **forma** do zod de lista de ids (teto, sem duplicata, array
  novo), não código a copiar.
- A RPC da issue 250 para o caminho de categoria; as FKs compostas da 243 para o caminho de lista.
- `src/lib/validacoes/cardapio.ts` — o mesmo módulo do `schemaCardapio` (issue 255): **um zod,
  dois consumidores**, nunca schema paralelo.

## Segurança

- **O cross-tenant é impossível, não checado.** `pB` viola `cardapio_produtos_produto_fk` ⇒
  `23503` ⇒ a instrução inteira falha ⇒ nada gravado, nem para `p1`, `p2`, `p3`, nem na loja B.
- Aplicar parcialmente confirmaria, pela diferença entre pedido e resultado, **quais ids existem
  em outra loja**.
- A prévia **só mostra o que é seu**: id alheio ou inexistente simplesmente não volta, sem
  mensagem distinta.
- Nenhum valor monetário. `23503` nunca vira texto na UI (§14).

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do código (fatia 5);
- [ ] cenário 5 literal: `[p1, p2, pB, p3]` ⇒ **nenhuma** linha nova em `cardapio_produtos` para
      **nenhum** dos 4 ids;
- [ ] o RED afirma o nome da constraint `cardapio_produtos_produto_fk` **e** o fragmento da
      mensagem devolvida pela Server Action;
- [ ] `cardapio_id` alheio idem; na via da RPC, os fragmentos `loja alheia` /
      `cardapio fora da loja` / `categoria fora da loja`;
- [ ] teto de 200 ids e recusa de duplicata provados;
- [ ] reaplicar o mesmo lote é idempotente;
- [ ] **RN-09-a:** `preverLoteAction` com `[p1, pB]` devolve `total = 1` e **só** o nome de `p1`
      — o id da loja B **não aparece** na prévia e não produz mensagem distinta;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
