import { describe, it, expect } from "vitest";

import { calcularFimDoPreset } from "./calcularFimDoPreset";
import { horaLocalNoFuso, instanteNoFuso } from "./fusoLoja";

/**
 * [253] `calcularFimDoPreset` — RN-04, design §9.3.
 *
 * Todos os casos são escritos em HORÁRIO LOCAL DA LOJA (o que o lojista digita)
 * e conferidos em horário local da loja: o preset é uma promessa de calendário,
 * não de UTC. A conversão nos dois sentidos é de `fusoLoja`, nunca reescrita.
 */

const SP = "America/Sao_Paulo";
/** Fuso com meia-hora de offset — prova que o clamp não depende de -03:00. */
const INDIA = "Asia/Kolkata";

const emSP = (local: string) => new Date(instanteNoFuso(local, SP));
const localSP = (d: Date) => horaLocalNoFuso(d.toISOString(), SP);

describe("253 — calcularFimDoPreset: diário e semanal são dias de 24h", () => {
  it("10/10 00:00 + diario === 11/10 00:00", () => {
    expect(localSP(calcularFimDoPreset(emSP("2026-10-10T00:00"), "diario", SP))).toBe(
      "2026-10-11T00:00",
    );
  });

  it("10/10 00:00 + semanal === 17/10 00:00 (fim exclusivo, 7 dias de 24h)", () => {
    const fim = calcularFimDoPreset(emSP("2026-10-10T00:00"), "semanal", SP);
    expect(localSP(fim)).toBe("2026-10-17T00:00");
    expect(fim.getTime() - emSP("2026-10-10T00:00").getTime()).toBe(7 * 86_400_000);
  });

  it("preserva a hora do dia, não só a data", () => {
    expect(localSP(calcularFimDoPreset(emSP("2026-09-19T11:00"), "semanal", SP))).toBe(
      "2026-09-26T11:00",
    );
  });
});

describe("253 — mensal: o CLAMP de fim de mês (a armadilha do setMonth)", () => {
  it("31/01/2026 + mensal === 28/02/2026 — e NÃO 03/03", () => {
    const fim = calcularFimDoPreset(emSP("2026-01-31T11:00"), "mensal", SP);
    expect(localSP(fim)).toBe("2026-02-28T11:00");
    // A asserção negativa que dá nome à issue: `setMonth` cairia aqui.
    expect(localSP(fim).startsWith("2026-03")).toBe(false);
  });

  it("31/01/2028 + mensal === 29/02/2028 (ano bissexto)", () => {
    expect(localSP(calcularFimDoPreset(emSP("2028-01-31T11:00"), "mensal", SP))).toBe(
      "2028-02-29T11:00",
    );
  });

  it("2100 NÃO é bissexto: 31/01/2100 + mensal === 28/02/2100", () => {
    expect(localSP(calcularFimDoPreset(emSP("2100-01-31T11:00"), "mensal", SP))).toBe(
      "2100-02-28T11:00",
    );
  });

  it("31/03 + mensal === 30/04 (mês de 30 dias)", () => {
    expect(localSP(calcularFimDoPreset(emSP("2026-03-31T09:30"), "mensal", SP))).toBe(
      "2026-04-30T09:30",
    );
  });

  it("dia que existe nos dois meses passa intacto: 15/01 → 15/02", () => {
    expect(localSP(calcularFimDoPreset(emSP("2026-01-15T23:59"), "mensal", SP))).toBe(
      "2026-02-15T23:59",
    );
  });

  it("dezembro vira janeiro do ano seguinte: 31/12/2026 → 31/01/2027", () => {
    expect(localSP(calcularFimDoPreset(emSP("2026-12-31T20:00"), "mensal", SP))).toBe(
      "2027-01-31T20:00",
    );
  });

  it("o clamp é do calendário LOCAL, em qualquer fuso (offset :30)", () => {
    const inicio = new Date(instanteNoFuso("2026-01-31T00:30", INDIA));
    const fim = calcularFimDoPreset(inicio, "mensal", INDIA);
    expect(horaLocalNoFuso(fim.toISOString(), INDIA)).toBe("2026-02-28T00:30");
  });
});

describe("253 — a função não lê relógio e recusa entrada inválida", () => {
  it("o mesmo `inicio` devolve sempre o mesmo `fim` (determinismo)", () => {
    const inicio = emSP("2026-01-31T11:00");
    const a = calcularFimDoPreset(inicio, "mensal", SP);
    const b = calcularFimDoPreset(inicio, "mensal", SP);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("`inicio` inválido estoura em vez de gravar um prazo NaN", () => {
    expect(() => calcularFimDoPreset(new Date("lixo"), "mensal", SP)).toThrow();
  });

  it("nunca devolve um fim <= início", () => {
    for (const preset of ["diario", "semanal", "mensal"] as const) {
      const inicio = emSP("2026-01-31T11:00");
      expect(calcularFimDoPreset(inicio, preset, SP).getTime()).toBeGreaterThan(
        inicio.getTime(),
      );
    }
  });
});
