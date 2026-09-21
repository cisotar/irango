/**
 * Issue 233 — o selo e o par de preços aparecem nas QUATRO superfícies da
 * vitrine. É o que faz o cliente VER a promoção: até aqui a vitrine mostrava o
 * preço já com desconto e nenhuma indicação de que havia desconto.
 *
 * Ambiente: vitest `environment: node`, sem jsdom — `renderToStaticMarkup`,
 * padrão do repo (`SecaoCatalogo.test.tsx`, `ItemProdutoLista.test.tsx`).
 *
 * Três superfícies são afirmadas por RENDER (card, linha e — via `SecaoCatalogo`
 * — o catálogo inteiro, que é também o caminho do resultado de busca, subtrativo
 * sobre os mesmos componentes). O `ProdutoModal` NÃO é afirmável por render: o
 * `Dialog` do Base UI usa portal e `renderToStaticMarkup` devolve string vazia
 * (medido). Para ele a asserção é ESTÁTICA, sobre a fonte — mesmo precedente de
 * `superficiesProdutoVitrine.test.tsx`.
 *
 * Nada de monetário é calculado aqui nem lá: `temDesconto`, `seloDesconto`,
 * `preco` e `precoEfetivo` chegam decididos do servidor (regra 6 do contrato).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";

import { CardProduto } from "./CardProduto";
import { ItemProdutoLista } from "./ItemProdutoLista";
import { SecaoCatalogo, type CategoriaComProdutos } from "./SecaoCatalogo";

/** Espaço do `Intl` em `R$ 80,00` é NBSP — comparar byte a byte exige o literal. */
const NBSP = " ";

function produto(over: Partial<ProdutoVitrine> = {}): ProdutoVitrine {
  return {
    id: "p-1",
    nome: "Feijoada completa",
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 100,
    precoEfetivo: 100,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
    ...over,
  };
}

const SEM_PROMOCAO = produto();
const EM_PROMOCAO = produto({
  precoEfetivo: 80,
  temDesconto: true,
  seloDesconto: "-20%",
});
const PROMOCAO_ESGOTADA = produto({
  precoEfetivo: 80,
  temDesconto: true,
  seloDesconto: "-20%",
  compravel: false,
  motivoNaoCompravel: "esgotado",
});

const card = (p: ProdutoVitrine) =>
  renderToStaticMarkup(<CardProduto produto={p} onAdicionar={() => {}} />);
const linha = (p: ProdutoVitrine) =>
  renderToStaticMarkup(<ItemProdutoLista produto={p} onSelecionar={() => {}} />);

describe("233 CardProduto — selo na foto e par de preços empilhado", () => {
  it("sem promoção: nenhum selo, nenhum preço riscado, um preço só", () => {
    const html = card(SEM_PROMOCAO);

    expect(html).toContain(`R$${NBSP}100,00`);
    expect(html).not.toMatch(/<s[ >]/);
    expect(html).not.toContain("bg-promo-fundo");
    expect(html).not.toContain("De R$");
  });

  it("em promoção: selo, preço de tabela riscado e efetivo em destaque", () => {
    const html = card(EM_PROMOCAO);

    expect(html).toContain("-20%");
    expect(html).toContain("bg-promo-fundo");
    expect(html).toContain(`<s aria-hidden="true"`);
    expect(html).toContain(`R$${NBSP}100,00`);
    expect(html).toContain(`R$${NBSP}80,00`);
  });

  it("em promoção: o botão '+' anuncia de/por — não só o preço cheio", () => {
    expect(card(EM_PROMOCAO)).toContain(
      `aria-label="Adicionar Feijoada completa ao carrinho, De R$${NBSP}100,00 por R$${NBSP}80,00"`,
    );
  });

  it("sem promoção: o botão '+' anuncia só o preço efetivo, sem 'de/por'", () => {
    expect(card(SEM_PROMOCAO)).toContain(
      `aria-label="Adicionar Feijoada completa ao carrinho, R$${NBSP}100,00"`,
    );
  });

  it("em promoção E esgotado: os dois selos coexistem, e esgotado vence a compra", () => {
    const html = card(PROMOCAO_ESGOTADA);

    // Fatos independentes: o preço está reduzido E o produto acabou.
    expect(html).toContain("-20%");
    expect(html).toContain("Esgotado");
    // Mas a afordância de compra continua fechada (contrato do D13).
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Feijoada completa esgotado"');
    // O rótulo do esgotado VENCE o de preço no botão: não se convida a comprar
    // o que não se pode comprar.
    expect(html).not.toContain("Adicionar Feijoada completa ao carrinho");
  });

  it("o selo fica no canto SUPERIOR ESQUERDO da foto, sem colidir com a pílula", () => {
    const html = card(PROMOCAO_ESGOTADA);

    expect(html).toContain("absolute left-2 top-2 z-[2]");
    // A pílula "Esgotado" continua no rodapé-centro, onde sempre esteve.
    expect(html).toContain("bottom-[10px] left-1/2");
  });
});

describe("233 ItemProdutoLista — selo em segunda linha e par à direita", () => {
  it("sem promoção: a linha é a de hoje — um preço só, sem selo", () => {
    const html = linha(SEM_PROMOCAO);

    expect(html).toContain(`R$${NBSP}100,00`);
    expect(html).not.toMatch(/<s[ >]/);
    expect(html).not.toContain("bg-promo-fundo");
  });

  it("em promoção: selo inline + par de preços, e o aria-label anuncia de/por", () => {
    const html = linha(EM_PROMOCAO);

    expect(html).toContain("-20%");
    expect(html).toContain("bg-promo-fundo");
    expect(html).toContain(`R$${NBSP}100,00`);
    expect(html).toContain(`R$${NBSP}80,00`);
    expect(html).toContain(
      `aria-label="Ver detalhes de Feijoada completa, De R$${NBSP}100,00 por R$${NBSP}80,00"`,
    );
  });

  it("em promoção: o selo NÃO entra entre o nome e a linha pontilhada", () => {
    const html = linha(EM_PROMOCAO);

    const fimDoNome = html.indexOf("Feijoada completa");
    const pontilhado = html.indexOf("border-dotted");
    const selo = html.indexOf("bg-promo-fundo");
    expect(fimDoNome).toBeLessThan(pontilhado);
    // O selo vem DEPOIS do pontilhado no DOM: é a segunda linha, não um chip
    // espremido no meio do alinhamento pontilhado.
    expect(selo).toBeGreaterThan(pontilhado);
  });

  it("em promoção E esgotado: mostra os dois e segue sem afordância de clique", () => {
    const html = linha(PROMOCAO_ESGOTADA);

    expect(html).toContain("-20%");
    expect(html).toContain("Esgotado");
    expect(html).toContain("Feijoada completa esgotado");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("Ver detalhes de");
  });

  it("o alvo de toque é 44px LITERAL nos dois estados, nunca `min-h-11`", () => {
    for (const html of [linha(EM_PROMOCAO), linha(PROMOCAO_ESGOTADA)]) {
      expect(html).toContain("min-h-[44px]");
      expect(html).not.toContain("min-h-11");
    }
  });
});

describe("233 SecaoCatalogo — grid, lista e o caminho da busca", () => {
  function categorias(exibirImagens: boolean): CategoriaComProdutos[] {
    return [
      {
        id: "cat-1",
        nome: "Pratos",
        exibir_imagens: exibirImagens,
        produtos: [EM_PROMOCAO, SEM_PROMOCAO],
      },
    ];
  }

  it("a promoção chega ao grid de cards", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} categorias={categorias(true)} />,
    );
    expect(html).toContain("-20%");
    expect(html).toContain(`R$${NBSP}80,00`);
  });

  it("a promoção chega à lista textual", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} categorias={categorias(false)} />,
    );
    expect(html).toContain("-20%");
    expect(html).toContain(`R$${NBSP}80,00`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Guardas estáticas — o que não dá para renderizar (modal em portal) e o que a
// issue exige por construção.
// ───────────────────────────────────────────────────────────────────────────

const DIR_VITRINE = join(process.cwd(), "src/components/vitrine");
const fonte = (arquivo: string) =>
  readFileSync(join(DIR_VITRINE, arquivo), "utf8");

describe("233 ProdutoModal — asserções estáticas (o Dialog não renderiza em SSR)", () => {
  const modal = fonte("ProdutoModal.tsx");

  it("usa o SeloDesconto inline, no mesmo lugar do selo 'Esgotado'", () => {
    expect(modal).toContain('<SeloDesconto rotulo={produto.seloDesconto} ancoragem="inline" />');
  });

  it("o preço unitário sai de `PrecoProduto tamanho=\"modal\"`", () => {
    expect(modal).toContain('<PrecoProduto produto={produto} tamanho="modal" />');
  });

  it("o ✕ do cabeçalho é 44×44 literal — `size-7` (33,6px) sai", () => {
    expect(modal).toContain("size-[44px]");
    expect(modal).not.toContain("size-7 ");
  });

  it("nenhuma aritmética nova: o subtotal continua partindo de `precoEfetivo`", () => {
    expect(modal).toContain("preco: produto.precoEfetivo");
  });
});

describe("233 — nenhuma superfície formata preço por conta própria (M1)", () => {
  it("card e linha não importam `formatarMoeda`: o par vem de `PrecoProduto`", () => {
    for (const arquivo of ["CardProduto.tsx", "ItemProdutoLista.tsx"]) {
      expect(fonte(arquivo)).not.toContain("formatarMoeda");
    }
  });

  it("`filtrarCatalogo` é verificado, não reescrito: repassa o objeto inteiro", () => {
    // Se alguém re-montar um shape reduzido no filtro, o selo sumiria SÓ na
    // busca. A trava dura é o tipo obrigatório (M2); esta guarda é o aviso.
    const busca = readFileSync(
      join(process.cwd(), "src/lib/utils/buscarProdutos.ts"),
      "utf8",
    );
    expect(busca).toContain("...categoria");
    expect(busca).not.toMatch(/produtos:\s*[^.\n]*\.map\(/);
  });
});
