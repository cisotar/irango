# [289] Abrir o produto a partir do modal de promoções

**crítica: SIM** — não há valor monetário novo nem cálculo no cliente, mas a mudança mexe no
caminho que alimenta `promocaoExibida` (238/RN-12-a): um segundo `ProdutoModal` ou um segundo
montador do payload de `adicionar` criaria um caminho de compra onde a trava do servidor nunca
dispara, em silêncio (classe de bug do D13).

**Spec:** `specs/abrir-produto-a-partir-do-modal-de-promocoes.md`

## Origem

Na vitrine pública, o `ModalPromocoes` lista até 3 pratos em promoção com linhas **não
interativas** — o único CTA leva ao topo do `<main>`. É beco sem saída: o cliente vê a promoção,
fecha o modal e tem que caçar o prato no catálogo.

## O que muda

Tocar numa linha do modal promocional fecha o modal e abre o `ProdutoModal` daquele prato, pronto
para escolher quantidade/opcionais e adicionar ao carrinho — mesmo modal que o card do catálogo
abre. **A tela não rola** (descartado pelo usuário, fora de escopo).

**Decisão de arquitetura (D1, já fechada no spec):** store de módulo + `useSyncExternalStore` no
padrão de `useCarrinho.ts`, sem persistência, para compartilhar "qual produto está em foco" entre
`ModalPromocoes` (em `VitrineClient`) e `ProdutoModal` (renderizado em `SecaoCatalogo`) — os dois
são irmãos sob um Server Component e não compartilham estado hoje. Alternativas (Context React,
elevar estado a `VitrineClient`, mover `ModalPromocoes` para dentro do catálogo, segunda instância
de `ProdutoModal`) já avaliadas e rejeitadas no spec — não reabrir a escolha.

## Arquivos

1. `src/hooks/useProdutoEmFoco.ts` — **novo.** Store de módulo (`subscribe`/`getSnapshot`/`abrir`/
   `fechar`), forma de `useCarrinho.ts:204`. Guarda
   `{ dados: ProdutoModalDados | null; aberto: boolean; origem: "catalogo" | "promocoes" }`.
   `getServerSnapshot` devolve estado fechado (nada no SSR).
2. `src/hooks/useProdutoEmFoco.test.ts` — **novo.**
3. `src/lib/utils/catalogoVitrine.ts` — nova função pura
   `derivarPromocionaisParaModal(secoes, opcionaisPorCategoria, rotulosVigencia): ProdutoModalDados[]`,
   substitui o `flatMap`+`filter` inline hoje em `page.tsx:280-282`.
4. `src/lib/utils/catalogoVitrine.test.ts` — acréscimo de cobertura de
   `derivarPromocionaisParaModal`.
5. `src/components/vitrine/ModalPromocoes.tsx` — `<li>` vira `<li><button type="button">`; clique
   guarda o prato como pendente e chama o **mesmo** `fechar()` de sempre; abertura do
   `ProdutoModal` no `onOpenChangeComplete(false)`. Prop `promocoes` muda de `ProdutoVitrine[]`
   para `ProdutoModalDados[]` (superset, `ProdutoModal.tsx:50-59`).
6. `src/components/vitrine/ModalPromocoes.test.tsx` — acréscimo de prova de árvore (botão, altura
   mínima literal ≥44px, rótulo acessível, "e mais N" não é botão).
7. `src/components/vitrine/SecaoCatalogo.tsx` — troca os dois `useState`
   (`produtoSelecionado`/`modalAberto`, hoje `:121-122`) pelo store; `confirmarAdicao` (`:141`,
   `temDesconto: true` em `:164`) fica onde está, sem mudança de conteúdo.
8. `src/components/vitrine/ProdutoModal.tsx` — ganha prop opcional
   `focoDeSaida?: RefObject<HTMLElement | null>`, repassada ao `finalFocus` do `DialogContent`.
9. `src/components/vitrine/VitrineClient.tsx` — só o tipo de `promocoes` muda (repasse).
10. `src/app/(publica)/loja/[slug]/page.tsx` — chama `derivarPromocionaisParaModal` com os mapas
    já em escopo (`page.tsx:205,248`). Nenhuma query nova.

**NÃO tocar (RN-13):** `scrollspyCategorias.ts`, `NavCategorias.tsx`, `CardProduto.tsx`,
`ItemProdutoLista.tsx`, `layoutVitrine.ts`, `decisaoModalPromocoes.ts` (+ teste), `useCarrinho`,
`checkout/*`, `components/ui/*`, qualquer coisa do painel.

## Regras de negócio (ver spec para a lista completa RN-1 a RN-13)

- RN-1: todo prato listado abre o detalhe; beco sem saída proibido.
- RN-3/RN-4: um único `fechar()`; uma única instância de `ProdutoModal`; um único montador do
  payload de `adicionar` (`confirmarAdicao`).
- RN-5/RN-6: nunca dois dialogs abertos ao mesmo tempo; sequenciado por `onOpenChangeComplete`;
  foco nunca cai no `<body>`.
- RN-8: prato em promoção e esgotado abre o detalhe sem CTA de compra (comprabilidade não filtra
  a navegação).
- RN-9: opcionais e vigência vêm prontos do servidor; nada é buscado no caminho do modal.
- RN-10: alvo de toque ≥44px **literal**, com `rotuloPrecoAcessivel`.
- RN-11: nenhum handler de `pointerdown`/`touchstart`/`mousedown` no `ModalPromocoes.tsx` — só
  `onClick`.
- RN-12: o store não persiste; zera quando `SecaoCatalogo` desmonta.
- RN-13: arquivos listados acima como "NÃO tocar" continuam intocados.

## Testabilidade (ambiente sem jsdom/Playwright)

Foco, animação de fechamento e trava de scroll do Base UI **não são observáveis** nesta suíte
(`environment: node`). Cobertos por teste: o store (`useProdutoEmFoco.test.ts`), a função pura
(`catalogoVitrine.test.ts`) e a árvore do `ModalPromocoes` (`renderToStaticMarkup`). Verificação
final é **manual**, na loja de teste "Lanches base", viewport mobile — checklist no spec, seção
Testabilidade.

## Critério de aceite

- [ ] Todos os behaviors do spec implementados (ver spec, seção Behaviors).
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.
- [ ] `grep -c "<ProdutoModal" src/components/vitrine/*.tsx` = 1 (instância única).
- [ ] `grep -rn "temDesconto: true" src/components/vitrine/` = uma única ocorrência
      (`SecaoCatalogo.tsx`).
- [ ] `grep -nE "pointerdown|touchstart|mousedown" src/components/vitrine/ModalPromocoes.tsx` vazio.
- [ ] `git diff --stat main` não lista nenhum dos arquivos "NÃO tocar".
- [ ] Auditoria do vetor `promocaoExibida` sem achado ALTO/CRÍTICO em aberto.
- [ ] Checklist manual de clique na "Lanches base" (spec, seção Testabilidade) — feito pelo usuário.
