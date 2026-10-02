import { describe, it, expect } from "vitest";
import {
  schemaPaginaClientes,
  schemaLimiteClientes,
  POR_PAGINA_CLIENTES,
  LIMITE_MAXIMO_CLIENTES,
  MAX_PAGINA_CLIENTES,
} from "./paginacao";

describe("paginacao bordas (346)", () => {
  it.each([null, "Infinity", "NaN", "-0.5", "1,5", {}, [], 1.5, -3, 101, Number.MAX_SAFE_INTEGER * 2])(
    "%j → 0",
    (v) => {
      expect(schemaPaginaClientes.parse(v)).toBe(0);
    },
  );
  it("aceita número e '100.0'", () => {
    expect(schemaPaginaClientes.parse(7)).toBe(7);
    expect(schemaPaginaClientes.parse("100.0")).toBe(MAX_PAGINA_CLIENTES);
  });
  it("limite: 1 e 100 ok; fracionário, string, NaN, negativo recusados", () => {
    expect(schemaLimiteClientes.safeParse(1).success).toBe(true);
    for (const v of [1.5, "50", NaN, -1, null, undefined, Infinity]) {
      expect(schemaLimiteClientes.safeParse(v).success).toBe(false);
    }
  });
  it("página padrão cabe no teto do limite", () => {
    expect(schemaLimiteClientes.safeParse(POR_PAGINA_CLIENTES).success).toBe(true);
    expect(POR_PAGINA_CLIENTES).toBeLessThanOrEqual(LIMITE_MAXIMO_CLIENTES);
  });
});
