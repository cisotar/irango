import { describe, it, expect } from "vitest";
import { digitosNacionais, campoTelefoneComDdd } from "./telefone";

// Telefones fictícios.
describe("telefone bordas (346)", () => {
  it.each([
    ["5555900000000", "55900000000"], // 55 + DDD 55 celular (13 dígitos)
    ["555530000000", "5530000000"], // 55 + DDD 55 fixo (12 dígitos)
    ["55900000000", "55900000000"], // 11 dígitos: DDD 55, NÃO descarta prefixo
    ["5530000000", "5530000000"], // 10 dígitos: DDD 55, NÃO descarta prefixo
    ["+55 (11) 3000-0000", "1130000000"],
    ["(11)90000-0000", "11900000000"],
    ["11 9 0000 0000", "11900000000"],
  ])("%s → %s", (v, d) => {
    expect(digitosNacionais(v)).toBe(d);
  });

  it.each([
    "5501900000000", // 13 dígitos, DDD 01 após o 55
    "5511", // curto
    "55119000000000", // 14 dígitos
  ])("%s → inválido", (v) => {
    expect(digitosNacionais(v)).toBeNull();
  });

  it.each(["(00) 90000-0000", "(01) 90000-0000", "(11) 9000-000", "0011900000000"])(
    "DDD 0X / curto %s → inválido",
    (v) => {
      expect(campoTelefoneComDdd.safeParse(v).success).toBe(false);
    },
  );

  it("formato bruto: letras, ponto, + no meio e >20 chars são recusados mesmo com dígitos certos", () => {
    expect(campoTelefoneComDdd.safeParse("11 9000a0000").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse("11.90000.0000").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse("11+900000000").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse("++5511900000000").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse("+55 (11) 9 0000 - 0000   ").success).toBe(false); // 26 chars
  });

  it("campoTelefoneComDdd faz trim e recusa vazio/só espaços/sem DDD", () => {
    expect(campoTelefoneComDdd.safeParse("  (11) 90000-0000  ")).toMatchObject({
      success: true,
      data: "(11) 90000-0000",
    });
    expect(campoTelefoneComDdd.safeParse("   ").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse("90000-0000").success).toBe(false);
    expect(campoTelefoneComDdd.safeParse(null).success).toBe(false);
    expect(campoTelefoneComDdd.safeParse(undefined).success).toBe(false);
  });
});
