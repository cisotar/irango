/**
 * Fase RED (TDD) da issue 225 — a linha textual passa a receber
 * `produto: ProdutoVitrine` e a tratar comprabilidade.
 *
 * O bug (D13): hoje `ItemProdutoLista` recebe só `nome`/`preco` e é SEMPRE
 * `role="button"` clicável. Produto esgotado numa categoria com
 * `exibir_imagens = false` abre o modal, o cliente escolhe opcionais, monta o
 * carrinho — e só é recusado no fim, pelo servidor (`pedido.ts:174`, que segue
 * inalterado: a UI nunca foi a proteção). O dano é beco sem saída de UX.
 *
 * Ambiente: vitest `environment: node`, sem jsdom — mesma estratégia do
 * `SecaoCatalogo.test.tsx` já no repo: `renderToStaticMarkup` e asserção sobre
 * o HTML gerado. Não há clique real a simular; o que se prova é que o HTML da
 * linha esgotada NÃO carrega a afordância de clique.
 *
 * Por que é RED HOJE:
 *  - runtime: `ItemProdutoLista` não conhece `compravel`; a linha do esgotado
 *    sai com `role="button"`, `tabIndex=0` e `aria-label="Ver detalhes de ..."`,
 *    e sem nenhum "Esgotado";
 *  - tipo: `produto: ProdutoVitrine` não é prop aceita (hoje são `nome`/`preco`
 *    avulsos) → `npx tsc --noEmit` também cai vermelho neste arquivo.
 *
 * O padrão visual do esgotado é o que `CardProduto.tsx` JÁ usa (pill "Esgotado"
 * + `aria-label` "<nome> esgotado") — nunca uma terceira variante, e nunca o de
 * `oculto` (produto oculto não chega ao catálogo).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";

import { ItemProdutoLista } from "./ItemProdutoLista";

/** `ProdutoVitrine` COMPLETO — os 12 campos do contrato da issue 224. */
function produtoVitrine(over: Partial<ProdutoVitrine> = {}): ProdutoVitrine {
  return {
    id: "p-1",
    nome: "Suco de laranja 500ml",
    descricao: null,
    foto_url: null,
    categoria_id: "cat-bebidas",
    preco: 9,
    precoEfetivo: 9,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
    ...over,
  };
}

const ESGOTADO = produtoVitrine({
  id: "p-esg",
  nome: "Suco Esgotado",
  compravel: false,
  motivoNaoCompravel: "esgotado",
});

describe("225 ItemProdutoLista — a linha textual trata comprabilidade", () => {
  it("produto ESGOTADO: a linha não é alvo de clique (sem role=button, sem tabindex)", () => {
    const html = renderToStaticMarkup(
      <ItemProdutoLista produto={ESGOTADO} onSelecionar={() => {}} />,
    );

    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex="0"');
  });

  it("produto ESGOTADO: não anuncia 'Ver detalhes' — o modal não é uma saída", () => {
    const html = renderToStaticMarkup(
      <ItemProdutoLista produto={ESGOTADO} onSelecionar={() => {}} />,
    );

    // "Ver detalhes de" é a afordância de entrada no modal — some por inteiro.
    expect(html).not.toContain("Ver detalhes de");
  });

  it("produto ESGOTADO: mostra 'Esgotado' com o mesmo rótulo acessível do CardProduto", () => {
    const html = renderToStaticMarkup(
      <ItemProdutoLista produto={ESGOTADO} onSelecionar={() => {}} />,
    );

    expect(html).toContain("Esgotado");
    expect(html).toContain("Suco Esgotado esgotado");
  });

  it("produto COMPRÁVEL: segue clicável e anunciado como antes (contrato não regride)", () => {
    const html = renderToStaticMarkup(
      <ItemProdutoLista produto={produtoVitrine()} onSelecionar={() => {}} />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Ver detalhes de Suco de laranja 500ml");
    expect(html).not.toContain("Esgotado");
  });

  it("o preço exibido é o EFETIVO, não o de tabela (fonte única: ProdutoVitrine)", () => {
    // Desconto vigente: tabela R$ 9,00 → efetivo R$ 7,20. A linha mostra o que
    // o cliente paga agora. (Selo e preço riscado são das issues 232/233.)
    const html = renderToStaticMarkup(
      <ItemProdutoLista
        produto={produtoVitrine({
          precoEfetivo: 7.2,
          temDesconto: true,
          seloDesconto: "-20%",
        })}
        onSelecionar={() => {}}
      />,
    );

    expect(html).toContain("7,20");
  });

  it("o realce da busca continua funcionando sobre o nome do objeto", () => {
    const html = renderToStaticMarkup(
      <ItemProdutoLista
        produto={produtoVitrine({ nome: "Pão na chapa" })}
        termo="pao"
        onSelecionar={() => {}}
      />,
    );

    expect(html).toMatch(/<mark[^>]*>Pão<\/mark>/);
  });
});
