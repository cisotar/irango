import { describe, it, expect } from "vitest";
// Conversão máscara ↔ inteiro de CEP (issue 183), módulo puro `payloadZona.ts`.
// A montagem do payload por zona (do form de zona antigo) saiu com a issue
// 327; as conversões de CEP ficam para os editores de zona.
//
// Risco central que este arquivo trava: `Number("01000000") === 1000000`
// (7 dígitos). A ida funciona porque calcularFrete normaliza o CEP do cliente
// do mesmo jeito; a VOLTA para a máscara precisa de padStart(8, "0"), senão
// uma segunda edição reexibe/regrava a faixa errada.
//
// FORA DA RESPONSABILIDADE: validação (schemaZonasEntrega), persistência
// (Server Actions), match de zona (calcularFrete).
import { cepParaInteiro, cepInteiroParaMascara } from "./payloadZona";

describe("cepParaInteiro", () => {
  it("converte máscara com zero à esquerda para inteiro de 7 dígitos", () => {
    expect(cepParaInteiro("01000-000")).toBe(1000000);
  });

  it("converte CEP sem zero à esquerda", () => {
    expect(cepParaInteiro("20000-000")).toBe(20000000);
  });

  it("aceita CEP sem máscara", () => {
    expect(cepParaInteiro("01099999")).toBe(1099999);
  });

  it("retorna null para CEP vazio", () => {
    expect(cepParaInteiro("")).toBeNull();
  });

  it("retorna null para CEP incompleto (menos de 8 dígitos)", () => {
    expect(cepParaInteiro("0100")).toBeNull();
  });

  it("retorna null para CEP com mais de 8 dígitos", () => {
    expect(cepParaInteiro("010000000")).toBeNull();
  });
});

describe("cepInteiroParaMascara — round-trip preserva o zero à esquerda", () => {
  it("repadroniza para 8 dígitos antes de mascarar", () => {
    expect(cepInteiroParaMascara(1000000)).toBe("01000-000");
  });

  it("mascara CEP de 8 dígitos sem alterar", () => {
    expect(cepInteiroParaMascara(20000000)).toBe("20000-000");
  });

  it("round-trip máscara → inteiro → máscara é idempotente", () => {
    const original = "01099-999";
    const ida = cepParaInteiro(original);
    expect(cepInteiroParaMascara(ida)).toBe(original);
  });

  it("devolve string vazia para null (zona sem faixa)", () => {
    expect(cepInteiroParaMascara(null)).toBe("");
  });
});
