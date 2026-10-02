import { describe, it, expect } from "vitest";
import { telefoneCliente } from "./telefoneCliente";

// Telefones fictícios.
describe("telefoneCliente bordas (346)", () => {
  it.each([
    "11900000000",
    "(11) 90000-0000",
    "+55 11 90000-0000",
    "5511900000000",
    "21 3000-0000",
    "552130000000",
    "55900000000",
    "5555900000000",
  ])("válido %s → href https://wa.me/55<10|11 dígitos> sem query", (t) => {
    const { href } = telefoneCliente(t);
    expect(href).toMatch(/^https:\/\/wa\.me\/55[1-9]{2}\d{8,9}$/);
  });

  it("DDD 55 não perde o prefixo nem duplica", () => {
    expect(telefoneCliente("55900000000")).toEqual({
      texto: "(55) 90000-0000",
      href: "https://wa.me/5555900000000",
    });
    expect(telefoneCliente("5555900000000").href).toBe("https://wa.me/5555900000000");
  });

  it.each(["", "   ", "abc", "5501900000000", "(00) 90000-0000", "119000000000", "123"])(
    "inválido %j → href null",
    (t) => {
      expect(telefoneCliente(t).href).toBeNull();
    },
  );

  it("undefined → vazio sem link; inválido preserva o gravado (trim) sem máscara", () => {
    expect(telefoneCliente(undefined)).toEqual({ texto: "", href: null });
    expect(telefoneCliente("  (01) 9999-9999 ")).toEqual({ texto: "(01) 9999-9999", href: null });
  });
});
