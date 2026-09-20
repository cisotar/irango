# [233] Selo e par de preços nas quatro superfícies da vitrine

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [225] (`tasks/225-quatro-superficies-recebem-produtovitrine-e-correcao-do-d13.md`) e [232] (`tasks/232-tokens-de-promocao-selodesconto-e-precoproduto.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D13 · RN-14 (apresentação), RN-19 · design §3.2–§3.5

## Objetivo

Fazer o cliente **ver** a promoção: preço de tabela riscado, preço efetivo em destaque e selo,
nas quatro superfícies do catálogo. A 225 entregou o objeto nas props; esta issue entrega a
apresentação, sem que nenhuma superfície formate preço por conta própria (M1).

## Escopo

- [ ] `CardProduto` — selo no canto **superior esquerdo** da foto (`ancoragem="foto"`); par de
      preços empilhado (`riscado text-xs` acima, efetivo `text-lg` abaixo), `items-end` com o "+";
      a partir de `lg` o riscado cai para `text-[11px]`. A altura do card **sem** desconto não muda;
- [ ] `ItemProdutoLista` — selo `ancoragem="inline"` em **segunda linha** sob o nome (nunca entre o
      nome e a linha pontilhada); par de preços à direita, empilhado, `text-right`; alvo de toque
      `min-h-[44px]` **literal**, não `min-h-11`;
- [ ] `ProdutoModal` — selo inline centrado **acima** do bloco de quantidade e abaixo da descrição
      (a mesma posição do selo "Esgotado"); `PrecoProduto tamanho="modal"`; `Cada unidade · R$ X`
      passa a usar `PrecoProduto`; o ✕ do cabeçalho vai de `size-7` (33,6px) para `size-[44px]`;
- [ ] resultado de busca — **coberto de graça**: `filtrarCatalogo` é *verificado*, não reescrito.
      A única exigência é continuar repassando o `ProdutoVitrine` inteiro, sem re-montar shape
      reduzido. `TextoRealcado` continua realçando **só o nome**;
- [ ] `aria-label` da linha de `ItemProdutoLista` e do botão "+" de `CardProduto` passam a usar
      `rotuloPrecoAcessivel` — hoje o cliente cego ouviria **só o preço cheio** e nunca saberia da
      promoção.

## Fora de escopo

Os componentes e tokens (issue 232). O objeto e a correção do D13 (issues 224 e 225). O modal de
promoções (issue 234). Nenhuma aritmética nova no `ProdutoModal`: o subtotal já parte de
`produto.preco`, que com o contrato novo **é** o preço efetivo. Nenhum realce de selo ou de preço
pela busca.

## Reuso esperado

- `SeloDesconto`, `PrecoProduto`, `rotuloPrecoAcessivel` (issue 232) — nenhuma superfície formata
  preço sozinha.
- `formatarMoeda`, `fotoSegura`, `TextoRealcado` — nada novo.
- `CardProduto.tsx:46,95` — o tratamento de esgotado que já existe e está certo.

## Segurança

- Nenhum número é calculado no cliente: `temDesconto`, `seloDesconto`, `preco` e `precoEfetivo`
  chegam decididos do servidor (regra 6 do contrato de catálogo).
- Risco real desta issue é **silencioso**: um shape reduzido em `filtrarCatalogo` faria o selo
  sumir só na busca, e nenhum teste deste repo pegaria. A trava é o tipo obrigatório (M2) —
  shape reduzido não type-checa contra a prop `produto`.

## Critério de aceite

- [ ] produto com desconto exibe riscado + efetivo + selo nas quatro superfícies; produto sem
      desconto renderiza **a mesma árvore de hoje**, sem `sr-only` duplicado;
- [ ] `grep -rn "formatarMoeda" src/components/vitrine/{CardProduto,ItemProdutoLista}.tsx` não
      mostra bloco de preço montado à mão — o par vem de `PrecoProduto`;
- [ ] nenhum alvo de toque abaixo de 44px nas linhas e no ✕ do modal;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
