import { describe, it, expect } from "vitest";
import { digitosNacionais, telefoneComDddValido } from "./telefone";

// Telefones fictícios.
describe("telefone com DDD (346 D4b/D4c)", () => {
  it.each([
    ["(11) 90000-0000", "11900000000"],
    ["2130000000", "2130000000"],
    ["+55 (11) 90000-0000", "11900000000"],
    ["5511900000000", "11900000000"],
    ["552130000000", "2130000000"],
  ])("%s → %s", (v, d) => {
    expect(digitosNacionais(v)).toBe(d);
    expect(telefoneComDddValido(v)).toBe(true);
  });
  it.each(["90000-0000", "12345678", "(01) 90000-0000", "119000000000", "550130000000", "", "abc"])(
    "%s → inválido",
    (v) => {
      expect(digitosNacionais(v)).toBeNull();
      expect(telefoneComDddValido(v)).toBe(false);
    },
  );
  it("null/undefined → null", () => {
    expect(digitosNacionais(null)).toBeNull();
    expect(digitosNacionais(undefined)).toBeNull();
  });
});
