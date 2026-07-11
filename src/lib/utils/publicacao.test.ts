import { describe, it, expect } from "vitest";

import { podePublicarLoja } from "./publicacao";

describe("podePublicarLoja — perfil mínimo para a vitrine ir ao ar (RN-8)", () => {
  it("nome preenchido + whatsapp cadastrado → true", () => {
    expect(podePublicarLoja("Burger do Zé", "5511999999999")).toBe(true);
  });

  it("whatsapp ausente (null/undefined/vazio) → false", () => {
    expect(podePublicarLoja("Burger do Zé", null)).toBe(false);
    expect(podePublicarLoja("Burger do Zé", undefined)).toBe(false);
    expect(podePublicarLoja("Burger do Zé", "")).toBe(false);
  });

  it("nome ausente ou só espaços → false", () => {
    expect(podePublicarLoja(null, "5511999999999")).toBe(false);
    expect(podePublicarLoja("", "5511999999999")).toBe(false);
    expect(podePublicarLoja("   ", "5511999999999")).toBe(false);
  });

  it("ambos ausentes → false", () => {
    expect(podePublicarLoja(null, null)).toBe(false);
  });
});
