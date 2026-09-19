import { describe, it, expect } from "vitest";

import {
  rotuloAlcance,
  fraseAlcanceDoPainel,
  fraseAlcanceDaEdicao,
  perguntaDeRemocao,
} from "./alcance-do-grupo";

/**
 * Copy do alcance (issue 216) — função pura, testada sem jsdom. É aqui que a
 * regra "nomear até 2, contar a partir de 3" vive; a UI só imprime o resultado.
 */

describe("rotuloAlcance", () => {
  it("sem categoria de produto: string vazia (a UI não imprime nada)", () => {
    expect(rotuloAlcance([])).toBe("");
  });

  it("uma categoria: nomeia", () => {
    expect(rotuloAlcance(["Pizzas"])).toBe("Pizzas");
  });

  it("duas categorias: nomeia as duas com `e`, sem vírgula", () => {
    expect(rotuloAlcance(["Pizzas", "Esfihas"])).toBe("Pizzas e Esfihas");
  });

  it("três ou mais: cai na CONTAGEM (a lista de nomes estouraria 360px)", () => {
    expect(rotuloAlcance(["Pizzas", "Esfihas", "Doces"])).toBe(
      "3 categorias de produto",
    );
    expect(rotuloAlcance(["A", "B", "C", "D"])).toBe("4 categorias de produto");
  });
});

describe("fraseAlcanceDoPainel", () => {
  it("é NULA com alcance 0 ou 1 — o aviso que dispara sempre vira papel de parede", () => {
    expect(fraseAlcanceDoPainel([], "Bordas")).toBeNull();
    expect(fraseAlcanceDoPainel(["Pizzas"], "Bordas")).toBeNull();
  });

  it("nomeia o grupo e conta as categorias a partir de 2", () => {
    expect(fraseAlcanceDoPainel(["Pizzas", "Esfihas", "Doces"], "Bordas")).toBe(
      "Itens da biblioteca da loja. Editar ou remover vale para as 3 " +
        "categorias de produto que usam Bordas.",
    );
  });
});

describe("fraseAlcanceDaEdicao", () => {
  it("é NULA com alcance 0 ou 1", () => {
    expect(fraseAlcanceDaEdicao([])).toBeNull();
    expect(fraseAlcanceDaEdicao(["Pizzas"])).toBeNull();
  });

  it("conta a partir de 2", () => {
    expect(fraseAlcanceDaEdicao(["Pizzas", "Esfihas"])).toBe(
      "Vale para 2 categorias de produto.",
    );
  });
});

describe("perguntaDeRemocao", () => {
  it("alcance 1: nomeia a única categoria afetada (remoção é irreversível)", () => {
    expect(
      perguntaDeRemocao({
        nomeItem: "Catupiry",
        alcance: ["Pizzas"],
        ehUltimoDoGrupo: false,
        grupoNome: "Bordas",
      }),
    ).toBe("Remover “Catupiry”? Ele sai de Pizzas.");
  });

  it("alcance 2: nomeia as duas", () => {
    expect(
      perguntaDeRemocao({
        nomeItem: "Catupiry",
        alcance: ["Pizzas", "Esfihas"],
        ehUltimoDoGrupo: false,
        grupoNome: "Bordas",
      }),
    ).toBe("Remover “Catupiry”? Ele sai de Pizzas e Esfihas.");
  });

  it("alcance 3+: conta", () => {
    expect(
      perguntaDeRemocao({
        nomeItem: "Chocolate",
        alcance: ["Pizzas", "Esfihas", "Doces"],
        ehUltimoDoGrupo: false,
        grupoNome: "Bordas",
      }),
    ).toBe("Remover “Chocolate”? Ele sai de 3 categorias de produto.");
  });

  it("alcance 0: pergunta sem a sentença de alcance", () => {
    expect(
      perguntaDeRemocao({
        nomeItem: "Catupiry",
        alcance: [],
        ehUltimoDoGrupo: false,
        grupoNome: "Bordas",
      }),
    ).toBe("Remover “Catupiry”?");
  });

  it("último item do grupo: acrescenta a segunda sentença", () => {
    expect(
      perguntaDeRemocao({
        nomeItem: "Catupiry",
        alcance: ["Pizzas"],
        ehUltimoDoGrupo: true,
        grupoNome: "Bordas",
      }),
    ).toBe(
      "Remover “Catupiry”? Ele sai de Pizzas. É o último opcional de Bordas.",
    );
  });
});
