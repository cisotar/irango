# [004] Barra/FAB de carrinho fixa acompanha a largura do container

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [002]
**Spec:** specs/vitrine-responsiva-desktop.md

## Objetivo
Fazer a barra fixa inferior do carrinho (`VitrineClient.tsx`) acompanhar a nova largura do container em cada breakpoint, em vez de ficar travada em `max-w-3xl` (spec §68, tabela §72, §196).

## Escopo
- [x] Barra/FAB fixa do carrinho: largura interna acompanha `md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` (mesmos limites do container — issue 002).
- [x] Carrinho permanece como `Sheet` lateral em todos os tamanhos (não vira coluna fixa na vitrine — spec §67, §185).
- [x] Mobile (< `md`): barra idêntica ao atual (`max-w-3xl`).

## Fora de escopo
- Resumo sticky do checkout (issue 006/007) — coluna fixa só existe no checkout, nunca na vitrine.
- Lógica de subtotal do carrinho (é preview de UX, inalterada).

## Reuso esperado
- shadcn/ui `Sheet` (`Carrinho.tsx`) — inalterado.
- Limites de largura definidos na issue 002 (mesma fonte de breakpoints — não duplicar valores divergentes).

## Segurança
- Subtotal exibido na barra é preview de UX (spec §83); valor autoritativo só no checkout/Server Action. Nenhuma tabela tocada, nenhuma RLS.

## Critério de aceite
- [x] Barra fixa alinhada ao container em `md`/`lg`/`xl` (sem ficar estreita no centro).
- [x] Carrinho continua abrindo como Sheet lateral em todos os tamanhos.
- [x] Mobile inalterado.

## Status
Concluída. A escada `max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` já foi aplicada no `<nav aria-label="Resumo do carrinho">` (`VitrineClient.tsx` linha 51) — entregue junto com a issue 002 em HEAD. `mx-auto`, `min-h-16`, `fixed inset-x-0 bottom-0 z-40` intactos; `Carrinho.tsx` (Sheet `sm:max-w-md`) não foi tocado.

## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (inalterado):**
- `src/components/vitrine/VitrineClient.tsx` — componente `'use client'` dono do estado `open` do `Carrinho` (Sheet) e da barra/FAB fixa (`<nav aria-label="Resumo do carrinho">`, linha 49-71). É o **único** site a modificar. O contador/total vêm de `useCarrinho` — preview de UX (servidor recalcula no checkout, `seguranca.md` §10). A lógica (`totalItens > 0`, `setOpen`, `formatarMoeda`) permanece intacta.
- `src/components/vitrine/Carrinho.tsx` — Sheet lateral com `sm:max-w-md`. **Não tocar** — spec §67 manda manter Sheet em todos os tamanhos; o carrinho na vitrine nunca vira coluna fixa (coluna fixa só no checkout, issue 006/007).
- `src/lib/utils/formatarMoeda.ts` — já usado para o subtotal. Inalterado.
- `src/hooks/useCarrinho.ts` — fonte do `totalItens`/`subtotal` (preview). Inalterado.
- Classes `md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` + `mx-auto` — utilities padrão do Tailwind v4 (breakpoints default `md` 768 / `lg` 1024 / `xl` 1280, sem `tailwind.config.ts`; tokens em `globals.css @theme`). Zero CSS artesanal, zero lib nova.

**Inventário de reuso — nada a criar.** Não há util/validação/query/componente novo. A escada de largura é a **mesma string literal** definida pela spec §72 e pela issue 002 (`page.tsx` + `SecaoCatalogo.tsx`). Não se cria constante compartilhada para classes Tailwind (anti-padrão: quebra o JIT/purge do Tailwind, que precisa das classes literais no source). A "fonte única" das larguras é a tabela da spec §72 — todos os três sites (catálogo, gate, barra) copiam o mesmo literal por design.

**Dependência [002] — estado real:** a issue 002 **ainda não foi implementada em código** (`page.tsx:101,185` seguem `max-w-3xl`; `SecaoCatalogo.tsx:123` segue `grid-cols-2 ... lg:grid-cols-3`). Logo, ordem importa (ver Ordem de Implementação): se 004 for implementada antes de 002, a barra cresce mas o catálogo abaixo dela continua em `max-w-3xl` — desalinhamento visual temporário. Recomenda-se implementar 002 antes (ou junto), garantindo que barra e container usem o **mesmo literal**.

### Cenários

**Caminho Feliz:**
1. Cliente abre `/loja/[slug]` em viewport `< md` com itens no carrinho → barra fixa inferior com largura `max-w-3xl` (idêntica ao atual).
2. Em `md` (≥768px) → barra cresce para `max-w-5xl`, alinhada ao container do catálogo (issue 002).
3. Em `lg` (≥1024px) → barra cresce para `max-w-6xl`.
4. Em `xl` (≥1280px) → barra cresce para `max-w-7xl`.
5. Clica "Ver carrinho" → abre o `Sheet` lateral (`Carrinho.tsx`) — comportamento inalterado em todos os tamanhos.

**Casos de Borda:**
- **Carrinho vazio** (`totalItens === 0`) → `<nav>` não renderiza (guard existente `totalItens > 0`). Sem impacto da mudança.
- **Sem permissão / loja inativa / falha de rede** → não se aplica: a barra é puramente client/preview, sem I/O. Estados de loja inativa e gate de assinatura são tratados em `page.tsx` (server, fora desta issue).
- **Subtotal grande** (muitos itens) → largura cresce mas `formatarMoeda` e o flex `justify-between` mantêm layout; sem regressão.
- **Mobile centralizado** → `mx-auto` + `max-w-3xl` já centralizam a barra hoje; a escada só adiciona limites maiores em desktop, mobile permanece idêntico.

**Tratamento de Erros:** nenhum caminho de erro novo — mudança 100% declarativa de CSS, sem I/O, sem try/catch, sem mensagem ao usuário nem log de servidor.

### Schema de Banco
Não se aplica — nenhuma tabela, coluna, migration ou RLS tocada. Reflow puramente de apresentação.

### Validação (zod)
Não se aplica — sem input, sem form, sem payload.

### Recálculo no Servidor
Não se aplica — nenhum valor monetário introduzido ou alterado. O subtotal exibido na barra continua sendo **preview de UX** (`useCarrinho`); o valor autoritativo é recalculado pelo servidor no checkout a partir do banco (`seguranca.md` §10). Esta issue altera **só a largura** do container que exibe o preview — a garantia server-side permanece intacta.

### Regra cliente ↔ servidor
Nenhuma regra de valor, permissão ou acesso é introduzida ou alterada. A mudança é em arquivo `'use client'` (`VitrineClient.tsx`), **somente em className** — sem mover lógica de camada. RLS pública de catálogo/zonas/formas e gate de assinatura (server, `page.tsx`) não são tocados.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar (1 arquivo, 1 linha):**
- `src/components/vitrine/VitrineClient.tsx` (linha 51): no `<nav aria-label="Resumo do carrinho">`, trocar `max-w-3xl` por `max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl`. Manter `mx-auto`, `min-h-16`, `inset-x-0 bottom-0 z-40` e todas as demais utilities. (`fixed inset-x-0` + `mx-auto max-w-*` é o padrão correto para barra fixa centralizada que acompanha o container.)

**NÃO tocar:**
- `Carrinho.tsx` — Sheet mantém `sm:max-w-md` em todos os tamanhos (spec §67); carrinho na vitrine nunca vira coluna fixa.
- `useCarrinho.ts`, `formatarMoeda.ts` — fontes do preview, inalteradas.
- `page.tsx` e `SecaoCatalogo.tsx` — pertencem à **issue 002** (container do catálogo + grid). Não duplicar aqui.
- `components/ui/` — shadcn gerado, nunca editar à mão.
- Qualquer migration, query, validação — fora de escopo.

### Dependências Externas
Nenhuma. Sem novo pacote. Tailwind CSS v4 já instalado; breakpoints `md/lg/xl` são default. Ref: https://tailwindcss.com/docs/responsive-design

### Ordem de Implementação
Issue **não crítica** (sem dinheiro, RLS, auth, token de pedido) → **sem TDD red-first obrigatório**.
1. **Implementar issue 002 antes** (ou no mesmo PR) — `page.tsx` + `SecaoCatalogo.tsx` precisam da mesma escada para o catálogo e a barra ficarem alinhados. Se 002 já estiver mergeada, prosseguir direto.
2. `VitrineClient.tsx` linha 51 — trocar a única string de className do `<nav>`.
3. Verificação visual manual (`/verificar`) nos breakpoints `< md` / `md` / `lg` / `xl`: barra alinhada à borda do container do catálogo (sem ficar estreita no centro), mobile idêntico ao atual, "Ver carrinho" continua abrindo o Sheet lateral em todos os tamanhos.
