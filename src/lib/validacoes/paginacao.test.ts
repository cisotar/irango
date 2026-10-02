import { describe, it, expect } from "vitest";
import { schemaPaginaClientes, schemaLimiteClientes, MAX_PAGINA_CLIENTES } from "./paginacao";

describe("schemaPaginaClientes (346)", () => {
  it.each([["0", 0], ["3", 3], [String(MAX_PAGINA_CLIENTES), MAX_PAGINA_CLIENTES]])("%s → %d", (v, n) => {
    expect(schemaPaginaClientes.parse(v)).toBe(n);
  });
  it.each([undefined, "", "-1", "1.5", "abc", String(MAX_PAGINA_CLIENTES + 1), "1e9"])("%s → 0", (v) => {
    expect(schemaPaginaClientes.parse(v)).toBe(0);
  });
});

describe("schemaLimiteClientes (346)", () => {
  it("teto 100", () => {
    expect(schemaLimiteClientes.safeParse(100).success).toBe(true);
    expect(schemaLimiteClientes.safeParse(101).success).toBe(false);
    expect(schemaLimiteClientes.safeParse(0).success).toBe(false);
  });
});
