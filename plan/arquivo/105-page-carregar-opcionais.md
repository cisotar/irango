## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada novo na camada de dados):**

- `src/lib/supabase/queries/produtos.ts:176` — `buscarOpcionaisPorCategoria(client, categoriaIds: string[]): Promise<OpcionaisPorCategoria>`.
  Assinatura e shape **confirmados no código real**:
  - `OpcionaisPorCategoria = Record<string, GrupoOpcional[]>` (`produtos.ts:31`) — chave = `categoria_id` do **produto**.
  - `GrupoOpcional = { categoriaOpcionalId, categoriaOpcionalNome, ordem, opcionais: OpcionalDisponivel[] }` (`produtos.ts:23`).
  - `OpcionalDisponivel = Pick<Tables<"opcionais">, "id" | "nome" | "preco" | "ordem">` (`produtos.ts:17`).
  - Faz **uma única consulta** com `.in("categoria_id", categoriaIds)` (JOIN `categoria_produto_opcionais → opcionais_categorias → opcionais`) — não há N+1, é uma chamada para todas as categorias de uma vez.
  - `categoriaIds` vazio → retorna `{}` sem consultar o banco (`produtos.ts:180`). Cobre o caso da loja sem categorias.
  - Categoria sem associação, ou cujo grupo ficou sem item visível pela RLS, simplesmente não aparece no mapa.
  - Propaga `error` (§14); itens já ordenados por `ordem`.

- `src/lib/supabase/server.ts` — `createClient()` (client autenticado). Já importado e usado em `page.tsx:19`. **Reusar.**

- `src/app/(painel)/painel/produtos/page.tsx:26-29` — `Promise.all([buscarProdutosDoLojista, buscarCategorias])` já existe. A nova chamada entra **neste mesmo `Promise.all`**.

- Referência de uso idêntico (vitrine SSR): `src/app/(publica)/loja/[slug]/page.tsx:147-153` — deriva `categoriaIds` da lista de categorias e chama `buscarOpcionaisPorCategoria(db, categoriaIds)`. Mesmo padrão a replicar no painel.

**O que precisa ser criado:** nada de query/util/validação. Só (a) a chamada no `Promise.all` do `page.tsx` e (b) uma prop nova em `ProdutosClient`. Sem migration, sem zod, sem Server Action, sem componente novo.

### Cenários

**Caminho Feliz:**
1. `page.tsx` resolve `loja` via `buscarLojaDoDono` (já existe).
2. Deriva `categoriaIds = categorias.map((c) => c.id)` a partir do resultado de `buscarCategorias`. **Dependência de ordem:** `categorias` precisa estar resolvido antes de derivar os ids. Como `buscarCategorias` e `buscarOpcionaisPorCategoria` rodam no mesmo `Promise.all`, a derivação não pode usar a saída de outra promise do próprio array. **Solução:** envolver as duas em uma função que primeiro busca categorias e depois opcionais (ver "Recálculo/Ordem" abaixo), mantendo o paralelismo só com `buscarProdutosDoLojista`.
3. `buscarOpcionaisPorCategoria(supabase, categoriaIds)` retorna `OpcionaisPorCategoria`.
4. `page.tsx` passa `opcionaisPorCategoria={...}` para `ProdutosClient`.

**Casos de Borda:**
- **Loja sem categorias:** `categoriaIds = []` → query retorna `{}` sem tocar o banco. Página renderiza normal.
- **Categorias sem opcionais associados:** mapa volta sem as chaves dessas categorias (`opcionaisPorCategoria[catId]` = `undefined`). Consumidor (issue 107) trata ausência como "sem opcionais".
- **Sem login / sem loja:** `buscarLojaDoDono` retorna `null` → `redirect("/painel/onboarding")` (comportamento atual, intocado).
- **Loja inativa / dono errado:** RLS de leitura própria (issue 103) já isola; outra loja nunca aparece no mapa.
- **Falha de rede / erro do Supabase:** `buscarOpcionaisPorCategoria` propaga `error` (throw). O Server Component falha como hoje — Next renderiza o `error.tsx` do segmento; nenhum dado parcial vaza.

**Tratamento de Erros:** erro propagado pela query (§14) — usuário vê a tela de erro genérica do segmento; o detalhe fica só no log do servidor. Nenhum novo `try/catch` que mascare erro.

### Schema de Banco

Não toca schema. Nenhuma migration. As três tabelas (`categoria_produto_opcionais`, `opcionais_categorias`, `opcionais`) e suas políticas RLS de leitura própria do dono já existem (migration 080, confirmadas pela issue 103 e por `seguranca.md` §2).

### Validação (zod)

Não há input do cliente nesta issue — é leitura SSR de dado autoritativo. Nenhum schema zod.

### Recálculo no Servidor

Não há valor monetário em jogo. O `preco` de `OpcionalDisponivel` é dado de exibição/preview (RN-6: nem renderizado nesta feature — issue 107 esconde o preço). Nenhum cálculo. A leitura é 100% server-side (Server Component + client autenticado), garantida pela RLS de leitura própria do dono (issue 103). Nenhuma camada `'use client'` toca a regra de acesso — invariante de leitura garantida por RLS.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/app/(painel)/painel/produtos/page.tsx` — derivar `categoriaIds`, chamar `buscarOpcionaisPorCategoria(supabase, categoriaIds)` (preservando o paralelismo com `buscarProdutosDoLojista`), e passar a prop `opcionaisPorCategoria` para `ProdutosClient`. Adicionar o import de `buscarOpcionaisPorCategoria` (já mora em `@/lib/supabase/queries/produtos`, mesmo módulo de `buscarProdutosDoLojista`).
- `src/app/(painel)/painel/produtos/ProdutosClient.tsx` — adicionar à `ProdutosClientProps` o campo `opcionaisPorCategoria: OpcionaisPorCategoria` (importar o tipo de `@/lib/supabase/queries/produtos`, já há import de `Produto` desse módulo na linha 33). Receber no destructuring da função (linha 90-96). **Não consumir/renderizar agora** — só aceitar a prop (a UI é a issue 107). Para não introduzir parâmetro não usado (lint), a issue 107 fará o consumo; se o lint reclamar de prop não lida, deixar a prop tipada em `ProdutosClientProps` e destructurar apenas quando 107 a usar — **decisão:** adicionar ao tipo agora e ao destructuring quando consumida, OU destructurar já e marcar uso trivial. Preferir: adicionar ao tipo + destructuring; o consumo real fica em 107.

**NÃO tocar:**
- `src/lib/supabase/queries/produtos.ts` — a query está pronta. Fora de escopo criar/alterar.
- `src/lib/supabase/queries/opcionais.ts` — funções de painel de opcionais; não relacionadas a este carregamento por categoria de produto.
- `src/app/(painel)/painel/produtos/opcionais/page.tsx` — página de gestão de opcionais; **não** é o alvo. O alvo é `.../produtos/page.tsx`.
- `supabase/migrations/`, `lib/validacoes/`, `lib/actions/` — nada de schema, zod ou action.
- `components/ui/` (shadcn) — não se edita à mão.

### Dependências Externas

Nenhuma. Sem novo pacote nem API.

### Ordem de Implementação

Issue **não crítica** (leitura sob RLS já existente, sem valor monetário, sem mutation) → **sem RED obrigatório**.

1. `ProdutosClient.tsx`: estender `ProdutosClientProps` com `opcionaisPorCategoria: OpcionaisPorCategoria` (+ import do tipo). Primeiro o consumidor de tipo para o `page.tsx` compilar ao passar a prop.
2. `page.tsx`: importar `buscarOpcionaisPorCategoria`, derivar `categoriaIds` da lista de `categorias`, chamar a query e passar a prop. Garantir que `categoriaIds` deriva do resultado já resolvido de `buscarCategorias` (não de outra promise do mesmo `Promise.all`).
3. Rodar `next build` (critério de aceite) — confirma tipos e a restrição de export de Server Component/Action.
