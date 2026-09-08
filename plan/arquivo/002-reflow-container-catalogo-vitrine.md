## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (inalterado):
- `src/components/vitrine/CardProduto.tsx` — card de largura fluida (não fixa nenhuma coluna; só preenche a célula do grid). **Não tocar** — confirmado que muda apenas quantos cabem por linha (§66).
- `src/components/vitrine/SecaoCatalogo.tsx` — o `scroll-mt-24` já existe na `<section>` (linha 106). É **preservado**, não recriado.
- Breakpoints Tailwind v4 canônicos (`md` 768 / `lg` 1024 / `xl` 1280) — vêm do default do Tailwind, sem `tailwind.config.ts` (tokens em `globals.css @theme`). Nenhum breakpoint custom necessário.
- Classes de largura (`max-w-5xl/6xl/7xl`) e `mx-auto px-4` já são utilities padrão do Tailwind — zero CSS artesanal, zero lib nova.

O que precisa mudar (só strings de className):
- 1 grid em `SecaoCatalogo.tsx`.
- 3 containers com `max-w-3xl` (descoberta importante — a issue cita "2 arquivos", mas são **3 sites de `max-w-3xl`**, ver abaixo).

**Descoberta vs. escopo da issue:** o `max-w-3xl` aparece em três lugares, não dois:
1. `page.tsx:101` — `<main>` do estado "loja temporariamente indisponível" (gate de assinatura).
2. `page.tsx:185` — `<main>` principal do catálogo.
3. `VitrineClient.tsx:51` — `<nav>` da barra/FAB de carrinho fixa.
O site (3) é o "barra fixa acompanha o container" da spec §68/§74-77 — está dentro do escopo desta issue (a issue 004 trata de comportamento/conteúdo do carrinho, não da largura do container). Os três precisam da mesma escada de largura para o catálogo e a barra ficarem alinhados em cada breakpoint.

### Cenários

**Caminho Feliz:**
1. Cliente abre `/loja/[slug]` em viewport `< md` → 2 colunas, `max-w-3xl` (idêntico ao atual).
2. Em `md` (≥768px) → grid vira 3 colunas, `main` cresce para `max-w-5xl`, barra fixa acompanha.
3. Em `lg` (≥1024px) → `main` cresce para `max-w-6xl` (grid permanece 3 colunas, conforme tabela §74-77).
4. Em `xl` (≥1280px) → grid vira 4 colunas, `main` cresce para `max-w-7xl`. Nunca passa de 4 colunas (regra de ouro §51).
5. Clica numa âncora de seção → rola com offset `scroll-mt-24` preservado.

**Casos de Borda:**
- Catálogo vazio (`temVazio`) → bloco "ainda não tem produtos" segue dentro do `main`; a largura cresce mas o conteúdo é centralizado (sem regressão visual).
- Loja com assinatura inválida → `main` do gate (site 1) usa a mesma escada para não destoar do header em desktop.
- Carrinho vazio → `<nav>` não é renderizado (`totalItens > 0`), sem impacto.
- Poucos produtos (1-2 numa categoria) → grid de 4 colunas deixa células vazias à direita; comportamento esperado de CSS grid, sem ajuste (não é bug).

**Tratamento de Erros:** nenhum caminho de erro novo — mudança puramente declarativa de CSS, sem I/O, sem try/catch. Não há mensagem ao usuário nem log de servidor envolvido.

### Schema de Banco

Não se aplica — nenhuma tabela, coluna, migration ou RLS tocada. Reflow 100% de apresentação (spec §145).

### Validação (zod)

Não se aplica — sem input, sem form, sem payload.

### Recálculo no Servidor

Não se aplica — nenhum valor monetário. O subtotal exibido na barra de carrinho continua sendo **preview de UX** (`useCarrinho`), recalculado pelo servidor no checkout (`seguranca.md` §10). Esta issue não altera essa garantia — só a largura do container que exibe o preview.

### Regra cliente ↔ servidor

Nenhuma regra de valor, permissão ou acesso é introduzida ou alterada. As invariantes server-side existentes permanecem intactas:
- Gate de assinatura (`assinaturaPermiteAcesso`, `page.tsx:86`) — server-side, não tocado.
- RLS pública de catálogo/zonas/formas — não tocada.
- A mudança é em arquivos `'use client'` (`SecaoCatalogo`, `VitrineClient`) e no Server Component `page.tsx`, mas **somente em className** — sem mover lógica de camada.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/components/vitrine/SecaoCatalogo.tsx` (linha 123): grid `grid-cols-2 gap-2.5 lg:grid-cols-3` → `grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4`. `scroll-mt-24` (linha 106) preservado sem alteração.
- `src/app/(publica)/loja/[slug]/page.tsx` (linhas 101 e 185): `max-w-3xl` → `max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` em ambos os `<main>` (mantém `mx-auto px-4` e os paddings verticais existentes).
- `src/components/vitrine/VitrineClient.tsx` (linha 51): `max-w-3xl` → `max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` no `<nav>` (mantém `mx-auto` e demais utilities).

**NÃO tocar:**
- `CardProduto.tsx` — largura fluida; muda só quantos cabem por linha (§66).
- `ProdutoModal.tsx` — issue 003.
- `Carrinho.tsx` — Sheet mantém `sm:max-w-md` em todos os tamanhos (spec §67); conteúdo/comportamento do carrinho é issue 004.
- `components/ui/` — shadcn gerado, nunca editar à mão.
- Qualquer migration, query, validação — fora de escopo.

### Dependências Externas

Nenhuma. Sem novo pacote. Tailwind CSS v4 já instalado; breakpoints `md/lg/xl` são default. Ref: https://tailwindcss.com/docs/responsive-design

### Ordem de Implementação

Issue **não crítica** (sem dinheiro, RLS, auth) → sem TDD red-first obrigatório. Ordem por baixo acoplamento:
1. `SecaoCatalogo.tsx` — grid (peça central, independente).
2. `page.tsx` — os dois `<main>` (catálogo + gate).
3. `VitrineClient.tsx` — barra fixa acompanha a mesma escada.
4. Verificação visual manual nos breakpoints `< md` / `md` / `lg` / `xl` (`/verificar`): mobile idêntico, escada de colunas e largura conforme tabela §74-77, âncoras com offset preservado.
