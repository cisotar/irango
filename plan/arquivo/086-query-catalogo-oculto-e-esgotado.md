## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:

- `src/lib/supabase/queries/produtos.ts` — `buscarCatalogoPublico(client, lojaId, categorias)`. Query única de catálogo público. Hoje `select("*")` + `.eq("loja_id", lojaId)` + `.eq("disponivel", true)` + `.order("ordem")`. Depois agrupa por categoria (grupo "Outros" por último). **Editar apenas o encadeamento de filtros e o comentário-cabeçalho** — a lógica de agrupamento fica intacta.
- `select("*")` já traz `disponivel` E `oculto` (colunas reais de `produtos` após migration 083). Ou seja, o item "garantir que o select traz `disponivel`" JÁ está satisfeito pelo `*` — não é preciso trocar o select. Confirmar no plano para não reintroduzir select explícito.
- `type Produto = Tables<"produtos">` e `type GrupoCatalogo` (linha 14 e 34) — não mudam: `Produto` já inclui `disponivel` e `oculto` via `Tables<"produtos">`. Nenhuma alteração de tipo na camada de query.
- `buscarProdutosPorIds` (insumo do recálculo §10) — **NÃO tocar**: continua sem filtrar `oculto`/`disponivel` (o recálculo precisa enxergar oculto/indisponível para recusá-lo — RN autoritativa da 087).
- `public.loja_esta_ativa(uuid)` + policy `produtos_leitura_publica` (migration 083, já mergeada) — 1ª camada de segurança. Esta issue adiciona a 2ª camada (filtro explícito na query). Reuso conceitual, nada a recriar.
- `CardProduto` (`src/components/vitrine/CardProduto.tsx`) — JÁ aceita `disponivel?: boolean` e renderiza estado "esgotado" (opacidade, botão desabilitado, aria-label). Nenhuma mudança de componente.
- Testes existentes que serão ATUALIZADOS (não recriados): `src/lib/supabase/queries/produtos.test.ts` (camada 2, mock) e `tests/migrations/queries_catalogo.test.ts` (camada 1, pglite).

Cadeia de propagação do "esgotado" (descoberta na exploração — a issue previa "salvo se faltar propagar", e FALTA):

1. `buscarCatalogoPublico` → `Produto[]` (tem `disponivel`) — OK após a mudança.
2. `page.tsx` (`src/app/(publica)/loja/[slug]/page.tsx`, linhas 157-168) mapeia `Produto` → `ProdutoCatalogo` e **descarta `disponivel`**.
3. `ProdutoCatalogo` (`SecaoCatalogo.tsx`, linha 16) **não tem campo `disponivel`**.
4. `SecaoCatalogo` (linhas 120-131) renderiza `<CardProduto>` **sem passar `disponivel`** → default `true`.

Consequência: sem fechar essa cadeia, o produto esgotado passa a APARECER (efeito da query) mas renderiza como DISPONÍVEL — pior que o estado atual. A propagação mínima é obrigatória para a issue não regredir a UX.

### Cenários

**Caminho Feliz (vitrine anon, loja ativa):**
1. Anon abre `/loja/[slug]`.
2. `buscarCatalogoPublico` roda sob role anon; RLS 083 (`oculto=false AND loja_esta_ativa`) + filtro explícito `.eq("oculto", false)` retornam produtos não-ocultos, disponíveis E esgotados.
3. `page.tsx` mapeia incluindo `disponivel`.
4. `SecaoCatalogo`/`CardProduto` renderiza disponível como clicável e esgotado com estado visual + botão desabilitado.

**Casos de Borda:**
- Produto `oculto=true` (disponível ou não): NUNCA retorna (RLS + filtro explícito, AND). Coberto por [oculto-3]/[oculto-4].
- Produto `oculto=false, disponivel=false`: RETORNA e renderiza "esgotado". Caso-chave da issue.
- Loja inativa: 0 produtos (loja_esta_ativa=false → RLS nega antes mesmo do filtro `oculto`). A vitrine já mostra "Loja temporariamente indisponível" antes de chamar a query.
- Produto de outra loja: nunca vaza (filtro `loja_id` + RLS por loja ativa; oculto cross-tenant gate por RLS).
- Sem produtos: `[]` → grupos vazios, agrupamento intacto.
- Falha de rede/DB: query PROPAGA `error` (throw) — não mascara. Server Component trata via boundary/notFound existente.

**Tratamento de Erros (§14):** a query já faz `if (error) throw error` (propaga, não mascara como `[]`). Nada muda. Mensagem genérica ao usuário fica a cargo do Server Component; detalhe só no log do servidor.

### Schema de Banco

Nenhuma mudança de schema nesta issue. A coluna `oculto` e a policy `produtos_leitura_publica` (predicado `oculto=false AND loja_esta_ativa`) já vieram na migration 083 (mergeada). Esta issue é código de aplicação (query + propagação UI), não migration.

### Validação (zod)

Não se aplica — issue de leitura (query pública), sem input de formulário nem escrita.

### Recálculo no Servidor

Não há valor monetário calculado aqui. `preco` retornado é dado de exibição/preview (§10) — o servidor recalcula no checkout. A recusa autoritativa de produto oculto/indisponível no pedido é escopo da issue 087 (via `buscarProdutosPorIds`, que por isso NÃO filtra). Camada de segurança desta issue:

| Invariante | Camada que garante |
|-----------|--------------------|
| Anon não lê produto oculto | RLS `produtos_leitura_publica` (083) — 1ª camada |
| Anon não lê produto oculto (defesa em profundidade) | `.eq("oculto", false)` na query — 2ª camada (esta issue) |
| Anon não lê produto de loja inativa | RLS `loja_esta_ativa` (083) |
| Esgotado visível mas não comprável | UI (`CardProduto disponivel=false`) — preview; recusa real no pedido é 087 |

O filtro `.eq("oculto", false)` NÃO substitui a RLS — ambos coexistem (architecture §defesa em profundidade, seguranca.md §1/§2).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/supabase/queries/produtos.ts` — em `buscarCatalogoPublico`: trocar `.eq("disponivel", true)` por `.eq("oculto", false)`. Manter `select("*")` (já traz `disponivel` e `oculto`). Atualizar comentário-cabeçalho (linhas 6-8) e docstring da função (linhas 44-49): de `disponivel=true` para `oculto=false`.
- `src/app/(publica)/loja/[slug]/page.tsx` (mapeamento linhas 157-168) — adicionar `disponivel: p.disponivel` ao objeto `ProdutoCatalogo`.
- `src/components/vitrine/SecaoCatalogo.tsx` — adicionar `disponivel: boolean` ao type `ProdutoCatalogo` (linha 16) e passar `disponivel={produto.disponivel}` ao `<CardProduto>` (linha 121).
- `src/lib/supabase/queries/produtos.test.ts` (camada 2, mock) — atualizar o teste "consulta ... filtrando por loja_id e disponivel=true" para asseverar `.eq("oculto", false)` e `expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true)`. Ajustar comentário de contrato (linhas 20-23).
- `tests/migrations/queries_catalogo.test.ts` (camada 1) — já reflete o novo contrato ([2] e [9] com `oculto`). Revisar se os SELECTs equivalentes de anon usam `oculto=false` no lugar de `disponivel=true` (hoje [1] e [4] ainda escrevem `disponivel = true` no SQL manual); alinhar ao contrato real da query.

**NÃO tocar:**
- `buscarProdutosPorIds`, `buscarProdutosDoLojista`, `buscarOpcionaisPorCategoria` (contratos distintos).
- Migration 083 / policy RLS (já em produção).
- `src/components/vitrine/CardProduto.tsx` (já suporta `disponivel`; shadcn/ui não se edita à mão).

### Dependências Externas

Nenhuma. Usa Supabase JS client e tipos já presentes.

### Ordem de Implementação (crítica — TDD red-first)

1. **RED (`/tdd`)** — escrever/atualizar os testes ANTES do código de produção:
   - Camada 2 (`produtos.test.ts`): teste que prova que `buscarCatalogoPublico` emite `.eq("oculto", false)` e NÃO emite `.eq("disponivel", true)`. Confirmar falha real (hoje a função emite `disponivel=true`).
   - Camada 1 (`queries_catalogo.test.ts` / pglite): teste de integração provando que a função aplica o filtro POR SI (independente da RLS). Ver contrato do RED abaixo.
2. **GREEN (`/execute`)** — trocar o filtro na query + atualizar comentários; propagar `disponivel` na cadeia UI. Rodar suites até verde.
3. Refatorar se necessário (nada previsto) e `next build` (constraint de `'use server'` não se aplica aqui, mas o build valida os tipos da cadeia UI).

### Contrato do Teste RED

**Escopo do que é testável nesta issue (defesa em profundidade sobre a RLS):**

A garantia crítica — "produto oculto nunca retorna mesmo se a RLS falhar" — não é observável num teste que roda sob a própria RLS. Portanto, o RED separa as duas provas:

- **Camada 2 (mock, unit)** — prova que a FUNÇÃO, por si, injeta o filtro `oculto=false` no PostgREST builder, independente de qualquer RLS. É a prova direta da defesa em profundidade: mesmo com o client mockado (sem RLS), a função sozinha aplica o filtro.
  - `expect(calls.eq).toHaveBeenCalledWith("oculto", false)`
  - `expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true)`
  - Segue asseverando `loja_id` e `order("ordem", {ascending:true})` (não regredir).

- **Camada 1 (pglite, integração)** — prova o comportamento de dados sob o SQL equivalente. Como pglite roda a RLS real da 083, o teste mede o efeito combinado. Para isolar "a função filtra por si", o SELECT equivalente do teste anon deve incluir explicitamente `where oculto = false` (espelhando o que a função emite) e provar:
  - produto `oculto=false, disponivel=false` de loja ativa → **1 linha** (esgotado aparece);
  - produto `oculto=true` → **0 linhas** via o próprio filtro `oculto=false` do SELECT, reconfirmado por `asService` de que a linha EXISTE (negação por filtro, não por dado ausente — anti-falso-verde);
  - produto `oculto=false, disponivel=true` → 1 linha (caminho feliz).
  - A prova de que a RLS TAMBÉM barra oculto (redundância das duas camadas) já vive em `rls_produtos_oculto.test.ts` [oculto-3/4] — não duplicar aqui; referenciar.

**Anti-falso-verde:** toda negação reconferida via `asService` (BYPASSRLS) de que a linha existe. O RED cai vermelho hoje porque a função ainda emite `.eq("disponivel", true)` (camada 2 falha na asserção) e o SQL manual das camadas 1 desalinhado do novo contrato.
