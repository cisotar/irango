/**
 * Ambiente: vitest `environment: node`, sem jsdom — mesma estratégia já usada em
 * `SecaoCatalogo.test.tsx` e `ItemProdutoLista.test.tsx`: `renderToStaticMarkup`
 * e asserção sobre o HTML gerado. O selo não é interativo, então não há clique
 * a simular: o que se prova é o markup.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SeloDesconto } from "./SeloDesconto";

describe("SeloDesconto", () => {
  it("sem rótulo (null), não renderiza NENHUM DOM", () => {
    expect(
      renderToStaticMarkup(<SeloDesconto rotulo={null} ancoragem="foto" />),
    ).toBe("");
    expect(
      renderToStaticMarkup(<SeloDesconto rotulo={null} ancoragem="inline" />),
    ).toBe("");
  });

  it("imprime o rótulo pronto do servidor, sem reformatar", () => {
    const html = renderToStaticMarkup(
      <SeloDesconto rotulo="-R$ 10,00" ancoragem="inline" />,
    );
    expect(html).toContain("-R$ 10,00");
  });

  it("usa os tokens de promoção — cor de sistema, nunca do tema da loja", () => {
    const html = renderToStaticMarkup(
      <SeloDesconto rotulo="-20%" ancoragem="inline" />,
    );
    expect(html).toContain("bg-promo-fundo");
    expect(html).toContain("text-promo-texto");
    expect(html).toContain("border-promo-borda");
    // O par de contraste é (texto do selo × fundo do selo): o selo pinta fundo
    // opaco próprio e borda de 1,5px.
    expect(html).toContain("border-[1.5px]");
    for (const temaDaLoja of ["cor-primaria", "cor-destaque", "cor-fundo"]) {
      expect(html).not.toContain(temaDaLoja);
    }
  });

  it("não é interativo: sem botão, sem title, sem tooltip", () => {
    const html = renderToStaticMarkup(
      <SeloDesconto rotulo="-20%" ancoragem="foto" />,
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("title=");
    expect(html).not.toContain("role=");
    expect(html).not.toContain("tabindex");
  });

  it("ancoragem 'foto' sobrepõe; 'inline' fica no fluxo do texto", () => {
    const foto = renderToStaticMarkup(
      <SeloDesconto rotulo="-20%" ancoragem="foto" />,
    );
    const inline = renderToStaticMarkup(
      <SeloDesconto rotulo="-20%" ancoragem="inline" />,
    );
    expect(foto).toContain("absolute");
    expect(foto).toContain("z-[2]");
    expect(inline).not.toContain("absolute");
  });
});
