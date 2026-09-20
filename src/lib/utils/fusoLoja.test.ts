import { describe, it, expect } from "vitest";
import { partesNoFuso, paraMinutos, instanteNoFuso } from "./fusoLoja";

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

/**
 * Fase RED da issue 230 — RN-03, o PRIMEIRO dos dois lugares de borda em que o
 * fuso da loja entra: a ESCRITA. O lojista digita "31/12 23:59" num
 * `datetime-local`; o que vai para `produtos.desconto_fim` é o instante absoluto
 * correspondente NAQUELE fuso. A coluna é `timestamptz` e a comparação de
 * vigência (`precoEfetivo`) segue sendo instante ↔ instante, sem fuso.
 *
 * `instanteNoFuso` é STUB (`throw "TODO: GREEN"`) — todo caso abaixo FALHA hoje.
 */
describe("instanteNoFuso (RN-03 — escrita do prazo no fuso da loja)", () => {
  it('"31/12 23:59" em America/Sao_Paulo grava o instante correto (UTC-3)', () => {
    // 2026-12-31T23:59 local em SP (sem horário de verão desde 2019) = UTC-03:00.
    expect(instanteNoFuso("2026-12-31T23:59", SP)).toBe(
      "2027-01-01T02:59:00.000Z",
    );
  });

  it("usa o fuso RECEBIDO, não um offset fixo de -3 (Manaus é UTC-4)", () => {
    // Prova que a conversão não é "-3h" hardcoded: mesmo horário local, outro
    // fuso, outro instante. Sem esta asserção, a implementação errada passa.
    expect(instanteNoFuso("2026-12-31T23:59", "America/Manaus")).toBe(
      "2027-01-01T03:59:00.000Z",
    );
  });

  it("não depende do fuso do runtime (meio de ano, os dois fusos)", () => {
    expect(instanteNoFuso("2026-07-15T12:00", SP)).toBe(
      "2026-07-15T15:00:00.000Z",
    );
    expect(instanteNoFuso("2026-07-15T12:00", "America/Manaus")).toBe(
      "2026-07-15T16:00:00.000Z",
    );
  });

  it("volta pelo mesmo primitivo: partesNoFuso do instante devolve os minutos locais digitados", () => {
    // Ida e volta com o primitivo que já existe — se as duas pontas
    // discordarem, uma das duas está errada.
    const instante = new Date(instanteNoFuso("2026-12-31T23:59", SP));
    expect(partesNoFuso(instante, SP).minutos).toBe(paraMinutos("23:59"));
  });
});
