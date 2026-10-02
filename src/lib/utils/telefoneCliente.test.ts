import { describe, it, expect } from "vitest";
import { telefoneCliente } from "./telefoneCliente";

// Telefones fictícios.
describe("telefoneCliente (346 D4)", () => {
  it("celular → (DD) NNNNN-NNNN + wa.me com 55", () => {
    expect(telefoneCliente("11900000000")).toEqual({
      texto: "(11) 90000-0000",
      href: "https://wa.me/5511900000000",
    });
  });
  it("fixo → (DD) NNNN-NNNN", () => {
    expect(telefoneCliente("(21) 3000-0000")).toEqual({
      texto: "(21) 3000-0000",
      href: "https://wa.me/552130000000",
    });
  });
  it("+55 gravado não duplica o 55", () => {
    expect(telefoneCliente("+55 11 90000-0000").href).toBe("https://wa.me/5511900000000");
  });
  it.each(["90000-0000", "12345678", "(01) 90000-0000"])("legado sem DDD %s → como gravado, sem link", (t) => {
    expect(telefoneCliente(` ${t} `)).toEqual({ texto: t, href: null });
  });
  it("null → vazio sem link", () => {
    expect(telefoneCliente(null)).toEqual({ texto: "", href: null });
  });
});
