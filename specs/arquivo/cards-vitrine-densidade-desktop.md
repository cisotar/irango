# Spec: Densidade dos Cards de Produto no Desktop (Vitrine Pública)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-08

## Visão Geral

Na vitrine pública, em telas de desktop com zoom 100%, os cards de produto do
catálogo aparecem **grandes demais** — poucas colunas ocupam toda a largura, cada
card fica largo e a página perde densidade (o cliente vê poucos produtos por dobra).

Esta feature **reduz o tamanho do card e a escala tipográfica interna apenas no
layout desktop** da vitrine pública, aumentando a densidade do grid:

- **Card**: reduzível até **67% da largura atual** (piso — não menor que isso).
- **Fontes dentro do card**: reduzíveis até **75% do tamanho atual** (piso).

É uma mudança **puramente visual** (densidade de grid + escala tipográfica
responsiva). **Não toca dado, valor monetário, permissão, schema, RLS nem Server
Action.** O preço exibido continua sendo o mesmo preview de UX de hoje — o servidor
segue como única autoridade de valor no checkout (`seguranca.md` §10), inalterado.

**Mundo:** vitrine pública (`/loja/[slug]`), sem auth. **Escopo estrito: desktop.**
Mobile e tablet (`md`) permanecem exatamente como estão — toda redução é aplicada
atrás de prefixos responsivos (`lg:` / `xl:`), a base nunca é alterada.

## Atores Envolvidos

- **iRango (SaaS):** define a escala de densidade desktop no design-system
  (`design-claude/`) e no componente da vitrine.
- **Cliente:** consumidor final navegando o catálogo no desktop — passa a ver mais
  produtos por dobra, cards menores e proporcionais.
- **Lojista:** não participa — não há configuração nova; é comportamento padrão da
  vitrine de toda loja.

## Estado Atual (medido)

Container do catálogo (`page.tsx`): `mx-auto w-full max-w-3xl px-4 md:max-w-5xl
lg:max-w-6xl xl:max-w-7xl`. Grid de cards (`SecaoCatalogo.tsx`, ramo
`exibir_imagens ≠ false`): `grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4`.

Largura útil e largura de card por breakpoint hoje (gap `2.5` = 10px, `px-4` = 16px/lado):

| Breakpoint | Container | Útil | Colunas hoje | Largura do card |
|-----------|-----------|------|--------------|-----------------|
| `lg` (≥1024) | `max-w-6xl` 1152px | 1120px | 3 (herda `md`) | **≈367px** |
| `xl` (≥1280) | `max-w-7xl` 1280px | 1248px | 4 | **≈305px** |

> Observação: hoje o `lg` herda `md:grid-cols-3`, então em telas 1024–1279px o card
> é o **maior** de todos (≈367px). É o pior ofensor do "grande demais".

Escala tipográfica interna do card hoje (`CardProduto.tsx`):

| Elemento | Classe atual | Tamanho |
|----------|--------------|---------|
| Nome | `text-sm` | 14px |
| Preço | `text-lg` | 18px |
| Botão "+" | `text-base` + `h-8 w-8` | 16px / 32×32 |
| Body | `p-3` / `gap-2` | 12px / 8px |

## Páginas e Rotas

### Vitrine da Loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)
**Descrição:** o cliente navega o catálogo em seções por categoria. No desktop, o
grid de cards passa a ser mais denso (mais colunas, cards menores) e a tipografia
interna do card encolhe proporcionalmente. Mobile/tablet inalterados.

**Componentes:** (reuso — nenhum componente novo)
- `SecaoCatalogo.tsx` (`components/vitrine/`) — dona do grid; ajuste nas classes de
  colunas do `<div className="grid ...">` (ramo do card com imagem, ~linha 146).
- `CardProduto.tsx` (`components/vitrine/`) — ajuste da escala tipográfica/spacing
  interna via prefixos `lg:`/`xl:`.
- `design-claude/vitrine/` — fonte única do visual; recebe mockup desktop-denso novo
  (ver Regras de Negócio RN-4).
- Não usa nenhum primitivo `components/ui/` novo — só utilitários Tailwind existentes.

**Behaviors:**
- [ ] Ver o catálogo em desktop com **mais colunas / cards menores** — grid denso.
      Garantido em: cliente (UX puro, sem valor/servidor).
- [ ] Ver a **tipografia do card reduzida** proporcionalmente no desktop (nome,
      preço, botão). Garantido em: cliente (UX puro).
- [ ] Ver **mobile e tablet idênticos** ao atual — nenhuma regressão. Garantido em:
      cliente (base sem prefixo responsivo intocada).
- [ ] Clicar no card / no botão "+" e abrir o `ProdutoModal` como hoje — fluxo de
      carrinho inalterado. Garantido em: cliente (estado de UX; o valor final é
      recalculado no checkout — `seguranca.md` §10, inalterado).

---

## Escala Proposta (alvos e pisos)

### 1. Densidade do grid (largura do card — piso 67%)

`SecaoCatalogo.tsx`, grid do ramo com imagem:

```
- grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4
+ grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6
```

Efeito (mesma largura útil de container, sem mexer no container):

| Breakpoint | Colunas hoje → nova | Card hoje → novo | % da largura atual |
|-----------|---------------------|------------------|--------------------|
| `md` (768–1023) | 3 → **3 (inalterado)** | ≈243px | 100% (fora de escopo) |
| `lg` (1024–1279) | 3 → **4** | ≈367px → **≈273px** | **≈74%** |
| `xl` (≥1280) | 4 → **6** | ≈305px → **≈200px** | **≈66% ≈ piso 67%** |

Racional: passar de 4 para 6 colunas é exatamente 2/3 (66,7%) da largura por card —
o alvo de 67% pedido. O `xl` (1280px, a largura de desktop canônica onde a queixa
aparece) já aterrissa no piso; o `lg` reduz menos (74%), coerente com "até 67%" como
**piso**, não valor fixo. **Não ultrapassar 6 colunas** — abaixo de ~200px o card
perde legibilidade e cai abaixo do piso.

> Container **não muda**. `max-w-7xl` (1280px) segue como teto — telas ≥1536px (`2xl`)
> mantêm o grid centralizado em 1280px com margens, consistente com hoje. Widening de
> container está fora de escopo (ver Fora do Escopo).

### 2. Escala tipográfica interna (fonte — piso 75%)

`CardProduto.tsx` — reduções **atrás de `lg:`** (pegam `lg` e `xl`, os dois tiers
desktop; base mobile intocada). Alvos ficam entre 78–86% (acima do piso de 75%):

| Elemento | Atual | Alvo desktop (`lg:`) | % | Piso 75% |
|----------|-------|----------------------|---|----------|
| Nome | `text-sm` (14px) | `lg:text-xs` (12px) | 86% | 10,5px |
| Preço | `text-lg` (18px) | `lg:text-sm` (14px) | 78% | 13,5px |
| Botão "+" | `text-base` (16px) + `h-8 w-8` | `lg:text-sm` (14px) + `lg:h-7 lg:w-7` | 88% / 28px | 12px |
| Padding body | `p-3` (12px) | `lg:p-2.5` (10px) | — | — |
| Gap body | `gap-2` (8px) | `lg:gap-1.5` (6px) | — | — |

Valores são **alvos**; o piso é 75% (nome ≥10,5px, preço ≥13,5px, botão ≥12px).
Nunca reduzir abaixo do piso. Todos os valores usam tokens Tailwind padrão
(`text-xs`, `text-sm`, `h-7`, `p-2.5`, `gap-1.5`) — nenhum token novo em `@theme`.
Se um alvo precisar de valor intermediário, usar arbitrary value (`text-[0.6875rem]`
= 11px = 78,6%), nunca abaixo do piso.

## Modelos de Dados

**Nenhum.** Nenhuma tabela, coluna, migration, view ou índice é afetado. Não há
campo novo. `schema.md` inalterado.

## Regras de Negócio

- **RN-1 — Escopo desktop estrito.** Toda redução é aplicada exclusivamente por
  prefixo responsivo `lg:`/`xl:`. As classes base (mobile) e `md:` (tablet) do
  `CardProduto` e do grid **não podem ser alteradas**. Garantido em: cliente (CSS/
  Tailwind) — verificável por inspeção do diff (nenhuma classe sem prefixo mudou).
- **RN-2 — Piso de card 67%.** No breakpoint mais denso (`xl`, 6 colunas), o card
  não fica menor que ~67% da largura atual (≈200px). Não adicionar 7+ colunas.
  Garantido em: cliente (contagem de colunas fixa no CSS).
- **RN-3 — Piso de fonte 75%.** Nenhum texto do card abaixo de 75% do tamanho atual
  (nome ≥10,5px, preço ≥13,5px, botão ≥12px). Garantido em: cliente (tokens de
  tipografia fixos no CSS).
- **RN-4 — design-claude é a fonte de verdade.** O `card-produto.html` atual é
  mobile-only (max-width 430px, 2 colunas). Antes/junto da mudança no componente,
  atualizar `design-claude/vitrine/` com o estado **desktop-denso** (novo
  `card-produto-desktop.html` ou extensão de `vitrine-completa.html`) refletindo a
  ladder de colunas e a escala tipográfica desta spec — para o design-system
  permanecer autoritativo e não nascer mockup paralelo. Garantido em: processo
  (revisão) — não é regra de runtime.
- **RN-5 — Lista textual inalterada.** Categorias com `exibir_imagens = false` usam
  `ItemProdutoLista` (sem card com imagem) — **fora do escopo**; não é um "card de
  produto". Não alterar. Garantido em: cliente (ramo separado do `SecaoCatalogo`).
- **RN-6 — Preço permanece preview.** O preço no card é e continua sendo estimativa
  de UX; a autoridade de valor é o servidor no checkout (`seguranca.md` §10). Esta
  mudança **não altera** essa fronteira. Garantido em: Server Action (checkout) —
  inalterada por esta spec.

## Segurança (obrigatório)

- **Dado sensível entra/sai?** Não. Nenhuma PII, chave Pix, cupom ou token trafega
  ou é exibido de forma nova. Só muda tamanho/quantidade de colunas e fontes.
- **Valor monetário?** O card exibe preço, mas é o **mesmo preview de UX de hoje** —
  nenhum cálculo novo, nenhuma origem de valor nova. O recálculo autoritativo no
  servidor (checkout, `seguranca.md` §10) **não é tocado**. Nenhum recálculo novo
  necessário.
- **Tabela nova / RLS?** Nenhuma. Sem migration, sem política RLS nova.
- **API externa com key?** Nenhuma.
- **Fronteira cliente↔servidor:** inalterada. Esta é uma mudança 100% de camada de
  apresentação no client (classes Tailwind). Não há behavior de valor/permissão/dado
  sensível introduzido — logo, nenhuma linha "garantido em: Server Action + RLS" é
  necessária além das já existentes (que permanecem intactas).

## Fora do Escopo (v1)

- **Mobile e tablet (`md`)** — a queixa é desktop 100%; base e `md:` ficam idênticas.
- **Alargar o container** (`max-w-7xl` / adicionar `2xl:max-w-*`) — mantido o teto de
  1280px atual; a densidade vem de mais colunas, não de container mais largo.
- **`ItemProdutoLista`** (categorias com imagens ocultas) — não é card com imagem
  (RN-5).
- **Preferência do lojista para densidade** (ex.: escolher nº de colunas por loja) —
  não há configuração nova; densidade é padrão da plataforma. Eventual toggle por
  loja seria fase futura (não consta no roadmap do `modelo-negocio.md`).
- **Zoom / densidade ajustável pelo cliente** (controle de tamanho na UI) — fora de
  escopo; a escala é fixa por breakpoint.
- **Redesenho do card** (nova hierarquia, descrição no card, badges) — só escala e
  densidade; a anatomia do card (foto 4:3, nome 2 linhas, preço + botão) permanece.
- **Reduções abaixo dos pisos** (card <67%, fonte <75%) — proibido por RN-2/RN-3.
