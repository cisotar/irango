# Spec: Lista de Produtos do Painel — Thumbnail + Opcionais no Rodapé

**Versão:** 0.1.0 | **Atualizado:** 2026-06-30

## Visão Geral

Refatoração **visual e de leitura** da lista de produtos do painel do lojista (`/painel/produtos`). Hoje cada produto é uma linha de texto: nome, badge de status, preço e ações (Ocultar / editar / remover). Duas mudanças:

1. **Thumbnail por produto** — exibir a foto do produto (`produtos.foto_url`, campo **já existente** no schema) ao lado de cada item. Sem foto → placeholder com a **inicial do nome** do produto (estilo avatar), nunca ícone genérico.
2. **Rodapé com opcionais** — no rodapé de cada card, listar (somente leitura, só nomes) os grupos de opcionais vinculados àquele produto via a categoria do produto.

**Mundo:** painel do lojista (`/painel/*`, auth obrigatório).

**Natureza:** apenas leitura de dados que já existem no banco + apresentação. Sem migration, sem upload, sem mutation nova, sem mexer no form de editar produto (`FormProduto.tsx` — fica para outra spec). Foto e opcionais são **dado autoritativo do servidor** (vêm da query SSR sob RLS); não há valor monetário nem preview de UX nesta feature.

## Atores Envolvidos

- **iRango (SaaS):** nada — não há mudança de plataforma, billing ou admin.
- **Lojista:** vê a lista de produtos enriquecida (foto + opcionais). Continua podendo ocultar/exibir, editar e remover (comportamento atual, inalterado).
- **Cliente:** não participa — feature é exclusiva do painel.

## Páginas e Rotas

### Produtos (painel) — `/painel/produtos`
**Mundo:** painel (auth obrigatório — guard em `app/(painel)/painel/layout.tsx` + `middleware.ts`).

**Descrição:** O lojista vê seus produtos agrupados por categoria (comportamento atual mantido). Cada produto agora exibe uma **thumbnail** (foto ou inicial) à esquerda da linha e, no **rodapé do card**, a lista de nomes dos opcionais vinculados àquele produto. As ações existentes (Ocultar/Exibir, editar, remover) e o status (Disponível/Indisponível) permanecem.

**Arquivos afetados:**
- `src/app/(painel)/painel/produtos/page.tsx` — Server Component: estende o carregamento de dados para trazer os opcionais por categoria. `foto_url` já vem (a query atual faz `select("*")`).
- `src/app/(painel)/painel/produtos/ProdutosClient.tsx` — Client Component: renderiza thumbnail + rodapé de opcionais em cada item.
- `src/components/painel/ThumbProduto.tsx` (**novo**) — componente de apresentação da thumbnail com fallback de inicial.

**Componentes:**
- `ThumbProduto` (**novo**, `components/painel/`) — recebe `fotoUrl` e `nome`; renderiza `next/image` quando há foto `https://` válida, senão um quadrado com a inicial do nome. Apresentação pura, sem estado.
  - Reuso: padrão de `fotoSegura` (https-only, anti-XSS §15) já presente em `CardProduto.tsx`/`SecaoCatalogo.tsx` — extrair para util compartilhado (ver Regras de Negócio RN-3), não recriar inline.
  - Reuso: `next/image` com `unoptimized` (mesmo padrão de `CardProduto.tsx`).
- `Card` / `CardContent` (`components/ui/`, shadcn) — já em uso, mantidos.
- `Badge`, `Button`, `Separator`, `Sheet`, `AlertDialog` — já em uso, inalterados.
- **Não** usar componente `ui/avatar` — não existe no projeto e não há necessidade de adicioná-lo; o fallback é um `<div>` estilizado com a inicial (evita nova dependência de superfície, `seguranca.md §16`).

**Behaviors:**
- [x] Visualizar thumbnail do produto — ao abrir `/painel/produtos`, cada item mostra a foto do produto. Garantido em: **Server Action/Server Component + RLS** (`foto_url` vem de `buscarProdutosDoLojista` sob `produtos_leitura_propria`; lojista só vê fotos da própria loja).
- [x] Ver inicial como fallback — produto sem `foto_url` (ou URL não-`https://`) exibe a primeira letra do nome em um placeholder. Garantido em: **cliente (apresentação)** — derivação puramente visual da string `nome` que já veio do servidor; sem dado sensível.
- [x] Ver opcionais no rodapé do card — cada produto lista os nomes dos opcionais vinculados (via sua categoria). Garantido em: **Server Component + RLS** (opcionais vêm de `buscarOpcionaisPorCategoria` sob as RLS de `categoria_produto_opcionais`/`opcionais_categorias`/`opcionais` escopadas por dono; ver Segurança).
- [x] Produto sem opcionais — rodapé não aparece (ou aparece estado vazio discreto), sem erro. Garantido em: **cliente (apresentação)** — mapa sem entrada para a `categoria_id` do produto.
- [x] Ocultar/Exibir produto — **comportamento atual, inalterado.** Garantido em: **Server Action + RLS** (`alternarDisponibilidade` → `produtos_escrita_propria`).
- [x] Editar produto — abre o Sheet com `FormProduto`. **Inalterado** (form fora do escopo desta spec).
- [x] Remover produto — **comportamento atual, inalterado.** Garantido em: **Server Action + RLS** (`removerProduto` → `produtos_escrita_propria`).

---

## Modelos de Dados

Nenhuma tabela nova, nenhum campo novo, nenhuma migration. Tabelas lidas (ver `schema.md`):

| Tabela | Uso nesta feature | Campo-chave |
|--------|-------------------|-------------|
| `produtos` | thumbnail + linha do produto | `foto_url` (já existe, `text` nullable), `nome`, `categoria_id` |
| `categoria_produto_opcionais` | junção produto-categoria ⋈ categoria-de-opcional (M:N) | `categoria_id`, `categoria_opcional_id` |
| `opcionais_categorias` | grupo de opcionais (nome exibido como rótulo do grupo) | `nome`, `ordem` |
| `opcionais` | itens de opcional (nomes listados) | `nome`, `ordem`, `ativo` |

**Relação opcional ↔ produto (descoberta no schema):** opcionais **não** se ligam direto ao produto. A ligação é pela **categoria do produto**: `produtos.categoria_id` → `categoria_produto_opcionais.categoria_id` → `opcionais_categorias` → `opcionais`. Produtos sem `categoria_id` (grupo "Sem categoria") não têm opcionais associados — comportamento esperado, exibir sem opcionais.

### Mudança na query de dados

A query de opcionais por categoria **já existe** — `buscarOpcionaisPorCategoria(client, categoriaIds)` em `src/lib/supabase/queries/produtos.ts`, retorna `OpcionaisPorCategoria` (mapa `categoria_id → GrupoOpcional[]`). Foi escrita para a vitrine (issue 081/087) mas é reutilizável aqui.

- `page.tsx` passa a chamar `buscarOpcionaisPorCategoria(supabase, categorias.map(c => c.id))` no mesmo `Promise.all` que já busca produtos e categorias, e injeta o mapa em `ProdutosClient`.
- **Atenção RLS (ver Segurança):** a função foi pensada para o role `anon` da vitrine (RLS pública filtra `ativo=true` e loja ativa). No painel o role é o **autenticado dono**. É preciso garantir que existam policies de leitura própria do lojista nas três tabelas de opcionais, OU que as policies de leitura existentes cubram o dono. Verificar antes de implementar (ver Segurança / Fora do Escopo se faltar policy).
- `foto_url` **não exige mudança de query** — `buscarProdutosDoLojista` já faz `select("*, categorias(*)")`, então `foto_url` já chega ao client.

## Regras de Negócio

- **RN-1 — Origem da foto:** a thumbnail vem **exclusivamente** de `produtos.foto_url` carregado pelo servidor. O cliente nunca informa a URL da imagem. Garantido em: **Server Component + RLS**.
- **RN-2 — Fallback de inicial:** sem `foto_url` válida, exibir `nome.trim().charAt(0).toUpperCase()`. Nome vazio (não deveria ocorrer — `nome` é `NOT NULL`) → placeholder neutro sem letra. Garantido em: **cliente (apresentação)**.
- **RN-3 — URL só `https://`:** renderizar como imagem apenas URLs que começam com `https://` (anti-XSS, `seguranca.md §15`). URL inválida cai no fallback de inicial. Garantido em: **cliente** (defesa de apresentação). Reusar a lógica `fotoSegura` já existente em `CardProduto.tsx`/`SecaoCatalogo.tsx` — extrair para `src/lib/utils/fotoSegura.ts` (DRY, `architecture.md §8`) e consumir nos três lugares, em vez de uma 3ª cópia inline.
- **RN-4 — Opcionais são somente leitura:** o rodapé exibe **apenas nomes** (sem preço, sem link, sem clique, sem ação). Não editável. A edição de quais opcionais um produto tem é feita pela tela de categorias/opcionais existente — fora desta spec. Garantido em: **cliente (apresentação)** — o componente não expõe nenhuma ação.
- **RN-5 — Opcionais resolvidos por categoria:** os opcionais de um produto são `opcionaisPorCategoria[produto.categoria_id]`. Produto sem categoria → sem opcionais. Grupos vazios (todos os itens escondidos por RLS) não aparecem — comportamento já tratado por `buscarOpcionaisPorCategoria`. Garantido em: **Server Component** (resolução) + **cliente** (lookup no mapa).
- **RN-6 — Sem preço no rodapé:** embora `GrupoOpcional.opcionais[].preco` venha no payload (a query o projeta), a UI do painel **não** o renderiza. Isto é decisão de produto; não há valor monetário autoritativo em jogo aqui (nada é cobrado nesta tela).

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não há PII de cliente, chave Pix nem cupom. Os dados exibidos (foto, nomes de produto/opcional) são do próprio lojista, já visíveis a ele no painel. `foto_url` é URL pública de bucket (`seguranca.md §18`) — não é PII.
- **Valor monetário?** **Não.** Nenhum recálculo de servidor é necessário — esta tela não cobra, não fecha pedido, não aplica cupom. O preço exibido (`produtos.preco`) é o já-existente, lido do banco (não é input do cliente). O preço dos opcionais **não** é exibido (RN-6).
- **Isolamento multitenant:** toda leitura usa o **client autenticado** (`createClient()` server), nunca `service_role`. A RLS é a defesa primária:
  - `produtos` → `produtos_leitura_propria` (`dono_id = auth.uid()`) garante que `foto_url` e o produto são da própria loja.
  - Opcionais → **verificar que existem policies de leitura própria do lojista** em `opcionais`, `opcionais_categorias` e `categoria_produto_opcionais`. As policies documentadas em `seguranca.md` para essas tabelas precisam permitir SELECT do dono autenticado; caso a única policy de SELECT seja a pública da vitrine (filtrando `ativo=true`), o painel pode esconder opcionais inativos do próprio lojista (degradação aceitável, não vazamento) ou retornar vazio. **Pré-condição de implementação:** confirmar as policies de SELECT do dono nas três tabelas de opcionais (`schema.md §4` lista RLS habilitada; `seguranca.md` detalha). Se faltar policy de leitura própria, é uma issue de RLS antes desta feature — não relaxar para `service_role`.
- **Tabela nova?** Nenhuma → nenhuma policy RLS nova exigida por esta feature em si.
- **API externa com key?** Nenhuma. `next/image` com `unoptimized` apenas referencia a URL pública do bucket; nenhuma credencial trafega.
- **XSS:** `nome` e nomes de opcional são renderizados como texto (React escapa por padrão, `seguranca.md §15`). `foto_url` validada como `https://` antes de virar `src` (RN-3). Sem `dangerouslySetInnerHTML`.

## Fora do Escopo (v1)

- **Form de editar/criar produto** (`FormProduto.tsx`, upload de foto) — outra spec. Esta feature só **lê** `foto_url`.
- **Upload / troca / remoção de foto** — não há mutation nova. Já existe `UploadFotoProduto.tsx` no fluxo do form (intocado).
- **Editar vínculo de opcionais ao produto** — gerenciado na tela de categorias/opcionais existente; aqui é só leitura.
- **Exibir preço dos opcionais** no rodapé (RN-6) — decisão de produto; pode ser fase posterior.
- **Otimização de imagem / CDN / lazy-loading avançado** — mantém-se `unoptimized` como no `CardProduto` atual. Revisão de performance é débito separado.
- **Componente `ui/avatar` genérico do shadcn** — não adicionar; o fallback é um `<div>` com inicial.
- **Criar policy RLS de leitura própria de opcionais** caso esteja ausente — se a verificação apontar lacuna, vira issue de RLS **anterior** a esta, não parte da apresentação.
