# [225] As quatro superfícies recebem `produto: ProdutoVitrine` obrigatório — e o D13 morre

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [224] (`tasks/224-contrato-de-catalogo-produtovitrine-e-projecao.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D13 · RN-19
**Fatia crítica:** 2 (contrato de catálogo + correção do D13) — a metade das superfícies

## Objetivo

Trocar campos avulsos por **um objeto obrigatório** nas quatro superfícies do catálogo, e
com isso fechar o beco sem saída de `disponivel` que existe hoje: o cliente abre um produto
esgotado pela lista textual, escolhe opcionais, monta o carrinho e só é recusado no fim.

## Escopo

- [ ] `CardProduto`, `ItemProdutoLista`, `ProdutoModal` e o caminho da busca passam a receber
      `produto: ProdutoVitrine` **obrigatório**, sem campo opcional com default;
- [ ] `SecaoCatalogo` (`abrirModal`, linhas 89-100) **para de montar um objeto parcial à mão**
      e repassa o `ProdutoVitrine` inteiro — é essa troca que torna o bug impossível de reintroduzir;
- [ ] cai o `produto.disponivel ?? true` de `ProdutoModal.tsx:139` — o default silencioso **é** o bug;
- [ ] `ItemProdutoLista` passa a tratar `compravel`/`motivoNaoCompravel`: a linha deixa de ser
      `role="button"` sempre clicável e mostra "Esgotado", com o **mesmo padrão visual que
      `CardProduto` já usa** para esgotado — nunca o de `oculto`;
- [ ] `filtrarCatalogo`/`BuscaProdutos` são **verificados, não reescritos**: a única exigência é
      que continuem repassando o objeto inteiro, sem re-montar um shape reduzido;
- [ ] `ProdutoModal`: o total do modal (com opcionais) parte do **preço efetivo** — o campo
      `preco` que `calcularSubtotal` já consome passa a ser o efetivo, sem aritmética nova no modal.

## Fora de escopo

Selo, preço riscado e `PrecoProduto` (issues 232 e 233) — aqui só muda o **tipo** e o
tratamento de comprabilidade. `pedido.ts:174` continua recusando o item indisponível no
servidor, **inalterado**: a UI nunca foi a proteção. Nenhum `"fora_da_janela"` (Spec B).

## Reuso esperado

- `src/lib/utils/catalogoVitrine.ts` (issue 224) — o tipo, obrigatório em todas as props.
- `CardProduto.tsx:46,95` — o tratamento de esgotado que **já existe e está certo**; é ele
  que `ItemProdutoLista` copia, não uma terceira variante.
- `fotoSegura`, `TextoRealcado`, `formatarMoeda` — nada novo.

## Segurança

- **A trava é o `tsc`, não a revisão de código.** O repo não tem jsdom (`environment: node`,
  sem Docker, sem Playwright), então "o modal trata esgotado" não é afirmável por teste de DOM.
  Campo faltando vira **erro de compilação**, que é o primeiro passo do CI.
- Severidade correta do D13, registrada para ninguém reclassificar depois: **não é brecha de
  dinheiro e não é compra indevida** — o servidor recusa o item esgotado no recálculo
  autoritativo, sempre. O dano é beco sem saída de UX.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 2): a prova é o **`tsc`** —
      demonstrar, antes do código, que a montagem parcial de `SecaoCatalogo` não compila
      contra o objeto obrigatório;
- [ ] `grep -rn "disponivel?:" src/components/vitrine/` **não devolve nada**;
- [ ] `grep -rn "?? true" src/components/vitrine/ProdutoModal.tsx` **não devolve nada**;
- [ ] a linha textual de um produto esgotado não abre o modal e mostra "Esgotado";
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
