/**
 * Issue 202 — copy do modo-busca. `environment: node`, sem DOM: o módulo é puro
 * de propósito, e é aqui que singular/plural e as aspas curvas ficam travados
 * antes de qualquer JSX depender deles.
 */
import { describe, it, expect } from "vitest";

import {
  contarProdutos,
  textoAnuncioBusca,
  textoResumoBusca,
} from "./resumoBusca";

describe("202 contarProdutos", () => {
  it("soma os produtos de todas as categorias", () => {
    expect(
      contarProdutos([
        { produtos: [1, 2, 3] },
        { produtos: [4] },
        { produtos: [] },
      ]),
    ).toBe(4);
  });

  it("catálogo sem categoria nenhuma conta zero", () => {
    expect(contarProdutos([])).toBe(0);
  });
});

describe("202 textoResumoBusca", () => {
  it("flexiona no singular com exatamente 1 resultado", () => {
    expect(textoResumoBusca(1, "pao")).toBe(
      "1 produto encontrado para “pao”",
    );
  });

  it("flexiona no plural com 2 ou mais", () => {
    expect(textoResumoBusca(3, "pao")).toBe(
      "3 produtos encontrados para “pao”",
    );
  });

  it("zero resultados também é plural, e o resumo visível ainda aparece", () => {
    expect(textoResumoBusca(0, "xyz")).toBe(
      "0 produtos encontrados para “xyz”",
    );
  });

  it("usa aspas curvas, nunca aspas retas", () => {
    const texto = textoResumoBusca(2, "pao");
    expect(texto).toContain("“");
    expect(texto).toContain("”");
    expect(texto).not.toContain('"');
  });

  it("repassa o termo como texto puro — nunca escapa nem monta HTML", () => {
    expect(textoResumoBusca(0, "<b>x</b>")).toBe(
      "0 produtos encontrados para “<b>x</b>”",
    );
  });
});

describe("202 textoAnuncioBusca", () => {
  it("zero resultados vira frase inteira, não “0 produtos”", () => {
    expect(textoAnuncioBusca(0, "xyz")).toBe(
      "Nenhum produto encontrado para xyz",
    );
  });

  it("com resultados anuncia só a contagem (o termo o cliente acabou de digitar)", () => {
    expect(textoAnuncioBusca(1, "pao")).toBe("1 produto encontrado");
    expect(textoAnuncioBusca(3, "pao")).toBe("3 produtos encontrados");
  });

  it("não leva aspas curvas: leitor de tela soletra pontuação decorativa", () => {
    expect(textoAnuncioBusca(0, "pao")).not.toContain("“");
  });
});
