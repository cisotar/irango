# [208] Ordem dos opcionais por categoria de produto: coluna, RPC e Server Actions

**crítica:** SIM (TDD red-first)
**Mundo:** painel + hub admin + infra (banco)
**Depende de:** —
**Spec:** specs/opcionais-sanfona-e-ordenacao.md (v0.2.0)

## Objetivo

Entregar **a camada de escrita inteira** da ordem dos grupos de opcional por categoria de
produto: coluna `categoria_produto_opcionais.ordem` com backfill neutro, RPC de escrita em
lote `SECURITY INVOKER`, schema zod, Server Action do lojista, variante admin escopada por
`lojaId`, e a correção da RN-12 em `salvarAssociacaoOpcionais`.

Lojista e admin ficam **na mesma issue de propósito**: mesmo teste vermelho, mesmo
`executar`, mesma auditoria. Separar dobraria o ciclo caro sem separar risco.

## Escopo

### Migration 1 — coluna + backfill + índice

`supabase/migrations/<ts>_ordem_em_categoria_produto_opcionais.sql`

- [ ] `alter table public.categoria_produto_opcionais add column ordem int not null default 0;`
- [ ] Backfill **neutro** (RN-13): `ordem` = posição do grupo dentro do par
      `(loja_id, categoria_id)` seguindo a ordem que a vitrine usa **hoje**
      (`opcionais_categorias.ordem`, desempate por `opcionais_categorias.nome`), via
      `update ... from (select ..., row_number() over (partition by loja_id, categoria_id
      order by oc.ordem, oc.nome) - 1 as pos ...)`. Duas categorias de produto que
      compartilham o mesmo grupo recebem numeração **independente**.
- [ ] `create index on public.categoria_produto_opcionais (loja_id, categoria_id, ordem);`
- [ ] `expand → backfill` numa migration só, sem `contract` (nada é removido).
      Rollback documentado no cabeçalho: `drop column ordem` volta ao estado anterior sem
      perda, porque `opcionais_categorias.ordem` continua intacta.
- [ ] **Nenhuma política RLS nova.** `cat_prod_opc_leitura_publica` e
      `cat_prod_opc_escrita_propria` já cobrem a tabela; a coluna entra em tabela que o
      dono já escreve. Conferir isso explicitamente (não presumir).

### Migration 2 — RPC de escrita em lote

`supabase/migrations/<ts>_rpc_reordenar_opcionais_da_categoria.sql` —
`public.reordenar_opcionais_da_categoria(p_loja_id uuid, p_categoria_id uuid, p_ids uuid[])
returns integer`, espelho fiel de `reordenar_categorias`
(`20260908120000_rpc_reordenar_categorias.sql` + a correção `20260908130000`):

- [ ] `language plpgsql`, **`security invoker`** (nunca `definer` — sob `DEFINER` o
      `p_loja_id` é escolhido pelo chamador e um lojista reescreveria a ordem de outra loja)
- [ ] `set search_path = public`
- [ ] permutação **completa do par (loja, categoria de produto)**: `p_ids` tem que cobrir
      exatamente `categoria_produto_opcionais where loja_id = p_loja_id and categoria_id =
      p_categoria_id`. **Essa é a diferença estrutural para `reordenar_categorias`**, cujo
      escopo é a loja inteira.
- [ ] **`cardinality(p_ids)`**, nunca `array_length(p_ids, 1)` (array multidimensional
      burlaria a checagem e corromperia a `ordinality` — achado de `20260908130000`)
- [ ] `update ... from unnest(p_ids) with ordinality` com `set ordem = e.pos - 1`, casando
      por `categoria_opcional_id`, com `and cpo.loja_id = p_loja_id and cpo.categoria_id =
      p_categoria_id` como segunda camada além da RLS
- [ ] confere `row_count` e levanta exceção se divergir → transação inteira derrubada
- [ ] `revoke all on function ... from public, anon;` +
      `grant execute ... to authenticated, service_role;`

### Validação

- [ ] `schemaReordenacaoOpcionaisDaCategoria` em `src/lib/validacoes/opcional.ts`:
      `{ categoria_id: z.guid(), categoria_opcional_id: z.array(z.guid()).min(2).max(200) }`
      + `.refine` de ids únicos. Espelha `schemaReordenacaoCategorias`
      (`src/lib/validacoes/produto.ts:60`). O parse devolve **objeto novo** — propriedade
      hostil pendurada pelo cliente (ex.: `loja_id`) não chega aos args da RPC.

### Server Action do lojista

`src/lib/actions/opcional.ts` — `reordenarOpcionaisDaCategoria(payload: unknown)`:

- [ ] parse do schema **antes de qualquer I/O**
- [ ] `p_loja_id` de `buscarLojaDoDono(supabase)`, **nunca do payload** (RN-5)
- [ ] `p_categoria_id` **vem do payload** e por isso é validada com
      `categoriaProdutoPertenceALoja` antes da RPC (RN-5b) — mesmo guard que
      `salvarAssociacaoOpcionais` já usa
- [ ] **uma única** mensagem genérica `"Não foi possível salvar a ordem."` para id alheio,
      lista incompleta, `categoria_id` de outra loja e erro de banco (`seguranca.md` §14 —
      mensagem distinta viraria oráculo de existência de id); detalhe só no
      `console.error`
- [ ] `revalidatePath("/painel/produtos/opcionais")` +
      `revalidatePath(\`/loja/${loja.slug}\`)` — **nunca** a forma coringa
      `("/loja/[slug]", "page")`, que invalidaria o Router Cache de todas as lojas

### Server Action admin

`src/app/admin/assinantes/actions/admin-opcionais.ts` —
`reordenarOpcionaisDaCategoriaAdmin(lojaId, payload)`:

- [ ] padrão de `reordenarCategoriasAdmin`: `validarLojaIdAdmin` → `prepararContextoAdmin`
      → escrita carregando o escopo da **loja-alvo** → `registrarAcessoAdmin(svc, { lojaId,
      acao: "reordenar_opcionais_da_categoria" })` → `revalidarLojaAdmin`
- [ ] `categoria_id` do payload validada contra a **loja-alvo**, não contra a do dono do SaaS
- [ ] **não** reusa a RPC do lojista sob `service_role`: a RPC é `SECURITY INVOKER` e a RLS
      do lojista não vale para o admin

### RN-12 — associação não pode zerar a ordem

- [ ] `salvarAssociacaoOpcionais` (`src/lib/actions/opcional.ts`, bloco "Associação
      categoria-de-produto ⋈ categorias-de-opcional") hoje faz `delete` + `insert` do
      conjunto inteiro da categoria. Com a coluna nova isso **apagaria a ordem a cada
      clique** de checkbox. Passa a **preservar a `ordem` dos grupos que permanecem** e
      anexar os recém-marcados no fim (`max(ordem) + 1` em diante).
- [ ] A mesma correção vale pela via admin (`salvarAssociacaoOpcionaisAdmin`, se a lógica
      for duplicada lá — verificar e **não duplicar**: extrair o cálculo do novo conjunto
      para uma função pura compartilhada se os dois caminhos precisarem dele).

### Tipos

- [ ] `npx supabase gen types typescript > src/lib/database.types.ts` **depois** do
      `db push`. Atenção à ordem: o gerador lê o **cloud**. Enquanto a migration não estiver
      aplicada, o runtime devolve `PGRST204` mesmo com build e testes verdes.
      **Não tocar `src/types/supabase.ts` (morto).**

## Fora de escopo

- Qualquer UI: o botão "Reordenar", a lista arrastável e a injeção no
  `OpcionaisAdminClient` são a issue **209**.
- A sanfona da vitrine e a troca da chave de ordenação em `agruparOpcionais` são a issue
  **210** (esta issue **não** toca `src/lib/supabase/queries/produtos.ts`).
- Drag & drop dos **itens** dentro de um grupo (`opcionais.ordem`) — v2.
- Remover `opcionais_categorias.ordem` — vira débito em `architecture.md` §10 (D-2).
- `npx supabase db push`: é **parada dura**, exige autorização explícita do usuário e não é
  feita pelo agente.

## Reuso esperado

- `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` +
  `20260908130000_cardinality_reordenar_categorias.sql` — **espelho**, não invenção
- `src/lib/actions/produto.ts::reordenarCategorias` (linha 331) — estrutura da action,
  incluindo os comentários sobre TOCTOU e sobre o `revalidatePath` da vitrine por slug
- `src/lib/validacoes/produto.ts::schemaReordenacaoCategorias` (linha 60) — forma do schema
- `buscarLojaDoDono`, `categoriaProdutoPertenceALoja`, `categoriaOpcionalPertenceALoja`
- `validarLojaIdAdmin`, `prepararContextoAdmin`, `registrarAcessoAdmin`, `revalidarLojaAdmin`
- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon` / `asUser` / `asService`

## Segurança

- **Valor monetário:** a issue não cria caminho de dinheiro. Preço de opcional segue
  recalculado em `criarPedido` via `buscarOpcionaisPorIds` (`seguranca.md` §10).
- **Coluna nova em tabela com dados no cloud:** sim. RLS nova: **não** — conferir que
  `cat_prod_opc_leitura_publica` e `cat_prod_opc_escrita_propria` cobrem a coluna.
- **Superfície de autorização nova:** `categoria_id` vem do cliente (RN-5b). É o único
  parâmetro de escopo que não deriva de `auth.uid()` e é o ponto que a auditoria tem que
  provar em três camadas: `categoriaProdutoPertenceALoja` na action, filtro por
  `categoria_id` dentro da RPC, RLS por baixo.
- **Checklist obrigatório da RPC** (`seguranca.md` §2, "RPC de escrita em lote do lojista"),
  item a item com `arquivo:linha` na auditoria:
  `security invoker` · `set search_path = public` · `revoke ... from public, anon` ·
  `grant execute ... to authenticated, service_role` · `cardinality()` ·
  `where loja_id = p_loja_id and categoria_id = p_categoria_id` ·
  permutação completa do par + conferência de `row_count` com exceção.

## Critério de aceite

- [ ] **Teste vermelho escrito e capturado com `FAIL` literal antes de qualquer código de
      produção** (mandato 3). Os casos, em `tests/migrations/` via `createTestDb()`:
  - [ ] `asUser`: lojista A chama a RPC com `p_categoria_id` da loja B → erro e **zero
        linhas escritas nas duas lojas**
  - [ ] `asUser`: lojista A passa uma `categoria_opcional_id` da loja B dentro de `p_ids` →
        erro, `ordem` intacta nas duas lojas
  - [ ] `asUser`: ids válidos da própria loja mas de **outra categoria de produto** → erro
        (a permutação é do par, não da loja)
  - [ ] `asAnon`: `anon` não tem EXECUTE na RPC
  - [ ] lista incompleta (subconjunto) → exceção, `ordem` intacta
  - [ ] array multidimensional → barrado por `cardinality()`
  - [ ] **backfill** (RN-13): categoria com 3 grupos recebe `ordem` 0,1,2 na ordem de
        `opcionais_categorias.ordem`; duas categorias de produto que compartilham um grupo
        recebem numeração independente
  - [ ] **RN-12**: reordenar, depois salvar a associação marcando um grupo novo → a ordem
        dos antigos é preservada e o novo entra no fim
  - [ ] node: `schemaReordenacaoOpcionaisDaCategoria` rejeita duplicata, não-UUID,
        `categoria_id` ausente e propriedade extra
- [ ] Todos os testes acima verdes depois do `executar`
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes
- [ ] `npx supabase migration list` mostra as duas migrations; o `Remote` só fica preenchido
      **após autorização explícita do usuário** para o `db push`
- [ ] Nenhum arquivo de `src/components/` nem
      `src/lib/supabase/queries/produtos.ts` tocado nesta issue
