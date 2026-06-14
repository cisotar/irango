import { describe, expect, it } from "vitest";
import { formatarMoeda } from "./formatarMoeda";

// O Intl usa U+00A0 (no-break space) entre "R$" e o número, não espaço comum.
// Normalizamos nas asserções para deixar a intenção legível.
const norm = (s: string) => s.replace(/ /g, " ");

describe("formatarMoeda", () => {
  it("formata um number em BRL pt-BR (R$ 12,50)", () => {
    expect(norm(formatarMoeda(12.5))).toBe("R$ 12,50");
  });

  it("formata o critério de aceite 12.5 e 0", () => {
    expect(norm(formatarMoeda(12.5))).toBe("R$ 12,50");
    expect(norm(formatarMoeda(0))).toBe("R$ 0,00");
  });

  it("zero vira R$ 0,00", () => {
    expect(norm(formatarMoeda(0))).toBe("R$ 0,00");
  });

  it("arredonda para 2 casas decimais", () => {
    // half-up: 1.235 -> 1,24 (representação IEEE-754 de 1.235 fica acima de 1.235)
    expect(norm(formatarMoeda(1.235))).toBe("R$ 1,24");
    expect(norm(formatarMoeda(1.999))).toBe("R$ 2,00");
    expect(norm(formatarMoeda(0.994))).toBe("R$ 0,99");
  });

  it("usa separador de milhar em valores grandes", () => {
    expect(norm(formatarMoeda(1234.56))).toBe("R$ 1.234,56");
    expect(norm(formatarMoeda(1000000))).toBe("R$ 1.000.000,00");
  });

  it("preenche casas decimais ausentes", () => {
    expect(norm(formatarMoeda(5))).toBe("R$ 5,00");
    expect(norm(formatarMoeda(5.1))).toBe("R$ 5,10");
  });

  // Domínio nunca produz preço negativo (valor é autoritativo do servidor),
  // mas a função é pura e determinística: o sinal vem antes do símbolo (pt-BR).
  it("negativo: sinal antes do símbolo (-R$)", () => {
    expect(norm(formatarMoeda(-12.5))).toBe("-R$ 12,50");
  });
});
