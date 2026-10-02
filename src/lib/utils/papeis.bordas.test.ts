import { describe, it, expect } from "vitest";
import { ehPapel, destinoPadraoPorPapel, PAPEIS, type Papel } from "./papeis";

describe("ehPapel — bordas (issue 332)", () => {
  const invalidos: unknown[] = [
    undefined,
    " lojista",
    "cliente ",
    "Cliente",
    ["lojista"],
    { papel: "lojista" },
    "__proto__",
    "constructor",
    "toString",
    0,
    true,
  ];
  for (const v of invalidos) {
    it(`recusa ${typeof v === "string" ? JSON.stringify(v) : Object.prototype.toString.call(v)}`, () => {
      expect(ehPapel(v)).toBe(false);
    });
  }

  it("todo item de PAPEIS é aceito (lista e guard não divergem)", () => {
    for (const p of PAPEIS) expect(ehPapel(p)).toBe(true);
  });
});

describe("destinoPadraoPorPapel — bordas (issue 332)", () => {
  it("ordem dos papéis não muda o destino", () => {
    expect(destinoPadraoPorPapel({ ehAdmin: false, papeis: ["cliente", "lojista"] })).toBe("/painel");
  });

  it("não muta a lista recebida", () => {
    const papeis: readonly Papel[] = Object.freeze(["cliente", "lojista"] as Papel[]);
    expect(() => destinoPadraoPorPapel({ ehAdmin: false, papeis })).not.toThrow();
    expect([...papeis]).toEqual(["cliente", "lojista"]);
  });

  it("admin vence mesmo sem nenhum papel", () => {
    expect(destinoPadraoPorPapel({ ehAdmin: true, papeis: [] })).toBe("/admin");
  });
});
