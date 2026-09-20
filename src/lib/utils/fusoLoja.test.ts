import { describe, it, expect } from "vitest";
import { partesNoFuso, paraMinutos } from "./fusoLoja";

// Primitivo de fuso extraído de lojaAberta.ts (issue 222). Funções PURAS:
// o instante vem SEMPRE do argumento, nunca de Date.now().

const SP = "America/Sao_Paulo";

describe("partesNoFuso", () => {
  it("converte o instante UTC para o dia e os minutos LOCAIS do fuso", () => {
    // 2025-06-10T15:30:00Z = terça 12:30 em São Paulo (UTC-3).
    const partes = partesNoFuso(new Date("2025-06-10T15:30:00Z"), SP);
    expect(partes).toEqual({ diaIndex: 2, minutos: 12 * 60 + 30 });
  });

  it("vira o dia da semana para trás quando o fuso local ainda está no dia anterior", () => {
    // 2025-06-11T02:00:00Z = ainda terça 23:00 em São Paulo.
    const partes = partesNoFuso(new Date("2025-06-11T02:00:00Z"), SP);
    expect(partes).toEqual({ diaIndex: 2, minutos: 23 * 60 });
  });

  it("devolve 0 minutos na meia-noite local (nunca 24h)", () => {
    // 2025-06-11T03:00:00Z = quarta 00:00 em São Paulo.
    const partes = partesNoFuso(new Date("2025-06-11T03:00:00Z"), SP);
    expect(partes).toEqual({ diaIndex: 3, minutos: 0 });
  });

  it("não depende do fuso do runtime: o mesmo instante em fusos diferentes difere", () => {
    const instante = new Date("2025-06-10T15:30:00Z");
    expect(partesNoFuso(instante, "UTC")).toEqual({ diaIndex: 2, minutos: 15 * 60 + 30 });
    expect(partesNoFuso(instante, "America/Manaus")).toEqual({
      diaIndex: 2,
      minutos: 11 * 60 + 30,
    });
  });

  it("cobre domingo (índice 0) e sábado (índice 6)", () => {
    // 2025-06-08 é domingo; 2025-06-14 é sábado.
    expect(partesNoFuso(new Date("2025-06-08T12:00:00Z"), "UTC").diaIndex).toBe(0);
    expect(partesNoFuso(new Date("2025-06-14T12:00:00Z"), "UTC").diaIndex).toBe(6);
  });
});

describe("paraMinutos", () => {
  it('converte "HH:MM" em minutos desde a meia-noite', () => {
    expect(paraMinutos("00:00")).toBe(0);
    expect(paraMinutos("08:30")).toBe(510);
    expect(paraMinutos("23:59")).toBe(1439);
  });

  it("é comparável com os minutos de partesNoFuso na mesma escala", () => {
    const { minutos } = partesNoFuso(new Date("2025-06-10T15:30:00Z"), SP);
    expect(minutos).toBe(paraMinutos("12:30"));
  });
});
