import { describe, it, expect } from "vitest";
import { mesDeReferencia, nomeDoMes } from "./mesDeReferencia";

// Issue 347 (D2): "mês corrente" no fuso da loja, nunca no fuso do servidor.
describe("mesDeReferencia", () => {
  // 31/jan 23h em São Paulo (UTC-3) = 1/fev 02h UTC.
  const virada = new Date("2026-02-01T02:00:00.000Z");

  it("31/jan 23h em America/Sao_Paulo → 1 (janeiro)", () => {
    expect(mesDeReferencia(virada, "America/Sao_Paulo")).toBe(1);
  });
  it("mesmo instante em UTC → 2 (fevereiro)", () => {
    expect(mesDeReferencia(virada, "UTC")).toBe(2);
  });
  it("meio do mês trivial", () => {
    expect(mesDeReferencia(new Date("2026-07-15T15:00:00.000Z"), "America/Sao_Paulo")).toBe(7);
  });
  it("dezembro → 12 (não 0)", () => {
    expect(mesDeReferencia(new Date("2026-12-10T12:00:00.000Z"), "America/Sao_Paulo")).toBe(12);
  });
});

describe("nomeDoMes", () => {
  it("pt-BR minúsculo", () => {
    expect(nomeDoMes(1)).toBe("janeiro");
    expect(nomeDoMes(3)).toBe("março");
    expect(nomeDoMes(12)).toBe("dezembro");
  });
});
