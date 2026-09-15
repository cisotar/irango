# [203] Nav de categorias em carrossel com scrollspy (`NavCategorias`)

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 201
**Spec:** specs/busca-e-navegacao-categorias-vitrine.md

## Objetivo

Entregar o trilho horizontal de chips na barra sticky: tocar num chip rola até a
categoria e o chip da categoria em tela fica marcado.

## Escopo

- [ ] `src/components/vitrine/NavCategorias.tsx`: `<nav aria-label="Categorias do cardápio">`
      + `<ul>` + `<a href="#ancora">`, com a âncora **importada** de `src/lib/utils/ancoraCategoria.ts` (201).
      **Não** é `Tabs`, **não** é carousel de lib: não gerar `ui/tabs.tsx` nem `ui/carousel.tsx`.
- [ ] Só renderiza com **≥3 categorias** (RN-4) e recebe de `CatalogoVitrine` um sinal de
      "modo busca" que o oculta quando o termo não é vazio (RN-5).
- [ ] Scrollspy por `IntersectionObserver` sobre as `<section>`:
      `rootMargin: "-<--altura-barra> 0px -55% 0px"` lendo a **mesma** variável da 201 (RN-6),
      `threshold: 0`. **Proibido listener de `scroll`.** Empate entre duas seções visíveis:
      vence a primeira na ordem do catálogo. Chip ativo com `aria-current="true"`.
      Observer reconstruído quando o conjunto de seções muda e desconectado no unmount.
- [ ] Chip ativo trazido ao centro do trilho com
      `scrollIntoView({ inline: "center", block: "nearest" })` — `block: "nearest"` é
      **obrigatório**: sem ele o scroll vertical é sequestrado e o catálogo pula sozinho.
- [ ] Clique num chip marca o ativo **imediatamente**, antes do observer reagir.
- [ ] Trilho: `overflow-x: auto`, `scroll-snap-type: x proximity`,
      `scroll-snap-align: center` nos chips, fade de 16px (`mask-image`) nas bordas.
      Sem botões de seta. Nome de categoria com `white-space: nowrap`, sem truncar.
- [ ] Teclado: Tab percorre, Enter navega. Sem `tabindex` custom, sem roving tabindex,
      **sem sequestrar ←/→**. Chip focado fora da viewport do trilho é trazido para dentro.
- [ ] Chip ativo: fundo `--cor-primaria` com texto **branco fixo** (RN-7, nunca derivado
      do tema) **+** sublinhado interno `box-shadow: inset 0 -3px 0 rgba(255,255,255,.45)`
      (1.4.1 — cor não pode ser o único sinal). Chip inativo `--texto` sobre branco.
      Alvo `min-h-[44px]` literal; foco `outline: 3px solid var(--cor-destaque); outline-offset: 2px`.

## Fora de escopo

Busca (202). Botões de seta, truncamento de nome, tornar o `HeaderLoja` sticky,
destacar/ordenar categoria pelo painel.

## Reuso esperado
- `ancoraCategoria(id, indice)` de `src/lib/utils/ancoraCategoria.ts` (201) — **nunca** uma segunda implementação de âncora. (Módulo puro, não `SecaoCatalogo`: export de valor vindo de módulo `'use client'` vira referência de cliente e explode se um Server Component chamar — decisão D1 do plano da 201.)
- `--altura-barra` publicada pela 201 — **nunca** valor fixo nem uma segunda medição.
- Tokens existentes (`--cor-primaria`, `--cor-destaque`, `--texto`, `--borda-nav`, `--radius`): zero token novo.

## Segurança
- Sem dado sensível, sem valor monetário, sem tabela, sem RLS, sem rede. Nomes e ordem
  das categorias vêm do SSR já escopado pelo slug — nada aqui consulta por `loja_id`.
- Nomes de categoria são texto de lojista renderizado só por JSX; a âncora é derivada do
  `id` (uuid), nunca do nome — nada de seletor montado com texto livre.

## Critério de aceite
- [ ] Com JS desligado (ou antes da hidratação), tocar num chip ainda rola até a categoria.
- [ ] O chip da categoria em tela fica marcado ao rolar, sem jank perceptível em 360×640, e sem nenhum listener de `scroll` no código.
- [ ] O chip ativo entra no centro do trilho **sem** que a página pule verticalmente.
- [ ] Loja com 2 categorias não mostra trilho; com o campo de busca preenchido (após 202) o trilho dá lugar ao resumo.
- [ ] Em 360px o trilho rola em X e o catálogo **nunca** rola em X.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.
