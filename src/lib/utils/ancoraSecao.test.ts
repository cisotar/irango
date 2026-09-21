/**
 * [263/RN-16] As três irmãs aditivas de `ancoraCategoria`.
 *
 * Arquivo SEPARADO de propósito: o critério de aceite da issue exige que a
 * suíte de `ancoraCategoria` passe **sem edição** — se ela precisou mudar, a
 * extensão deixou de ser aditiva e virou reescrita.
 */
import { describe, it, expect } from "vitest";

import {
  ancoraCardapio,
  ancoraCategoria,
  ancoraSecao,
  idNaSecao,
} from "./ancoraCategoria";

describe("263 ancoraCardapio — o terceiro namespace", () => {
  it("emite `cardapio-<id>`", () => {
    expect(ancoraCardapio("uuid-inverno")).toBe("cardapio-uuid-inverno");
  });

  it("os três prefixos são disjuntos POR CONSTRUÇÃO, não por sorte de uuid", () => {
    // O MESMO uuid nas duas tabelas: `cardapios.id` e `categorias.id` podendo
    // colidir é exatamente a premissa que o desenho se recusa a assumir.
    const mesmoUuid = "11111111-1111-1111-1111-111111111111";
    const deCardapio = ancoraCardapio(mesmoUuid);
    const deCategoria = ancoraCategoria(mesmoUuid, 0);

    expect(deCardapio).not.toBe(deCategoria);
    expect(deCardapio.startsWith("cardapio-")).toBe(true);
    expect(deCategoria.startsWith("cat-")).toBe(true);
    expect(ancoraCategoria(null, 0).startsWith("grupo-")).toBe(true);
  });
});

describe("263 ancoraSecao — o despachante é a fonte única", () => {
  it("seção de cardápio → `cardapio-<id>`, e o índice é ignorado", () => {
    const secao = { id: "c-1", tipo: "cardapio" as const };
    expect(ancoraSecao(secao, 0)).toBe("cardapio-c-1");
    expect(ancoraSecao(secao, 9)).toBe("cardapio-c-1");
  });

  it("seção de categoria → exatamente o que `ancoraCategoria` já emitia", () => {
    expect(ancoraSecao({ id: "cat-1", tipo: "categoria" }, 3)).toBe(
      ancoraCategoria("cat-1", 3),
    );
    expect(ancoraSecao({ id: null, tipo: "categoria" }, 3)).toBe(
      ancoraCategoria(null, 3),
    );
  });

  it("cardápio sem id cai no caminho de categoria — nunca `cardapio-null`", () => {
    expect(ancoraSecao({ id: null, tipo: "cardapio" }, 2)).toBe("grupo-2");
  });
});

describe("263 idNaSecao — id de DOM escopado pela seção", () => {
  it("compõe âncora da seção + id do produto", () => {
    expect(idNaSecao("cardapio-c-1", "p-1")).toBe("cardapio-c-1:p-1");
  });

  it("o MESMO produto em duas seções produz dois ids DIFERENTES (D16-a)", () => {
    const naSecaoDoCardapio = idNaSecao(
      ancoraSecao({ id: "c-1", tipo: "cardapio" }, 0),
      "lasanha",
    );
    const naCategoria = idNaSecao(
      ancoraSecao({ id: "cat-massas", tipo: "categoria" }, 1),
      "lasanha",
    );
    expect(naSecaoDoCardapio).not.toBe(naCategoria);
  });
});
