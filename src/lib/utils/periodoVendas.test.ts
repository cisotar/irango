import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) da issue 357 — `src/lib/utils/periodoVendas.ts` (puro).
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.3 e §8.6; RN-V06, V07, V11, V18.
 *
 * Contrato usado aqui:
 *   montarContextoVendas(loja {timezone, dia_inicio_ciclo}, filtros, agora) → { janela, cicloAtual, … }
 *     janela = { deDia, ateDia, inicio, fim } com [inicio, fim) em ISO UTC no fuso da loja.
 *   rotuloIntervalo({deDia, ateDia}) → "05/out a 04/nov" | "05/dez/2026 a 04/jan/2027"
 *   inicioDaSemanaIso, diasInclusivos, ehDiaLocalValido, janelaDoRanking.
 *
 * RED: o módulo ainda não existe; import dinâmico por caso. Datas fictícias.
 */

type Intervalo = { deDia: string; ateDia: string };
type Janela = Intervalo & { inicio: string; fim: string };
type Preset = "hoje" | "semana" | "mes" | "mes_anterior" | "ano" | "personalizado";
type Filtros = {
  periodo: Preset;
  de: string | null;
  ate: string | null;
  entrega: "entrega" | "retirada" | "ambos";
  concluidos: boolean;
};
type Contexto = {
  janela: Janela;
  rotuloPeriodo: string;
  cicloAtual: Intervalo & { rotulo: string };
  diaInicioCiclo: number;
};
type Mod = {
  montarContextoVendas: (loja: { timezone: string; dia_inicio_ciclo: number }, f: Filtros, agora: Date) => Contexto;
  rotuloIntervalo: (i: Intervalo) => string;
  inicioDaSemanaIso: (dia: string) => string;
  diasInclusivos: (de: string, ate: string) => number;
  ehDiaLocalValido: (dia: string) => boolean;
  janelaDoRanking: (
    periodo: "semana" | "mes" | "ano" | "tudo",
    agora: Date,
    timezone: string,
    diaInicioCiclo: number,
  ) => { inicio: string | null; fim: string; rotulo: string };
};

async function carregar(): Promise<Mod> {
  return (await import("./periodoVendas")) as unknown as Mod;
}

const SP = "America/Sao_Paulo";
const MAO = "America/Manaus";
const A = new Date("2026-10-07T15:00:00Z"); // quarta-feira

const filtros = (periodo: Preset): Filtros => ({
  periodo,
  de: null,
  ate: null,
  entrega: "ambos",
  concluidos: false,
});

async function janela(periodo: Preset, agora = A, diaInicioCiclo = 1, timezone = SP): Promise<Janela> {
  const { montarContextoVendas } = await carregar();
  return montarContextoVendas({ timezone, dia_inicio_ciclo: diaInicioCiclo }, filtros(periodo), agora).janela;
}

async function rotuloDoPreset(periodo: Preset, agora: Date, diaInicioCiclo: number): Promise<string> {
  const { rotuloIntervalo } = await carregar();
  const j = await janela(periodo, agora, diaInicioCiclo);
  return rotuloIntervalo({ deDia: j.deDia, ateDia: j.ateDia });
}

const contem = (j: Janela, instante: string) => {
  const x = Date.parse(instante);
  return Date.parse(j.inicio) <= x && x < Date.parse(j.fim);
};

describe("presets → janela no fuso da loja", () => {
  it("hoje em A (SP) → [2026-10-07T03:00Z, 2026-10-08T03:00Z)", async () => {
    expect(await janela("hoje")).toEqual({
      deDia: "2026-10-07",
      ateDia: "2026-10-07",
      inicio: "2026-10-07T03:00:00.000Z",
      fim: "2026-10-08T03:00:00.000Z",
    });
  });

  it("RN-V11 semana em A → segunda 2026-10-05 a domingo 2026-10-11", async () => {
    expect(await janela("semana")).toEqual({
      deDia: "2026-10-05",
      ateDia: "2026-10-11",
      inicio: "2026-10-05T03:00:00.000Z",
      fim: "2026-10-12T03:00:00.000Z",
    });
  });

  it("RN-V07 ciclo dia 5 em A → mes 2026-10-05..2026-11-04 ('05/out a 04/nov'); mes_anterior '05/set a 04/out'", async () => {
    const { montarContextoVendas } = await carregar();
    const ctx = montarContextoVendas({ timezone: SP, dia_inicio_ciclo: 5 }, filtros("mes"), A);
    expect(ctx.janela).toEqual({
      deDia: "2026-10-05",
      ateDia: "2026-11-04",
      inicio: "2026-10-05T03:00:00.000Z",
      fim: "2026-11-05T03:00:00.000Z",
    });
    expect(ctx.cicloAtual.rotulo).toBe("05/out a 04/nov");
    expect(ctx.diaInicioCiclo).toBe(5);
    expect(await rotuloDoPreset("mes", A, 5)).toBe("05/out a 04/nov");
    expect(await rotuloDoPreset("mes_anterior", A, 5)).toBe("05/set a 04/out");
  });

  it("ciclo dia 5 em 2026-10-03 → '05/set a 04/out'; ciclo dia 1 em A → '01/out a 31/out'", async () => {
    expect(await rotuloDoPreset("mes", new Date("2026-10-03T15:00:00Z"), 5)).toBe("05/set a 04/out");
    expect(await rotuloDoPreset("mes", A, 1)).toBe("01/out a 31/out");
  });

  it("virada de ano: dia 5 em 2027-01-03 → '05/dez/2026 a 04/jan/2027'; mes_anterior '05/nov a 04/dez'", async () => {
    const agora = new Date("2027-01-03T15:00:00Z");
    expect(await rotuloDoPreset("mes", agora, 5)).toBe("05/dez/2026 a 04/jan/2027");
    expect(await rotuloDoPreset("mes_anterior", agora, 5)).toBe("05/nov a 04/dez");
  });

  it("dia 28: em 2026-03-10 → 2026-02-28..2026-03-27; em 2026-02-27 → 2026-01-28..2026-02-27", async () => {
    const marco = await janela("mes", new Date("2026-03-10T15:00:00Z"), 28);
    expect([marco.deDia, marco.ateDia]).toEqual(["2026-02-28", "2026-03-27"]);
    const fev = await janela("mes", new Date("2026-02-27T15:00:00Z"), 28);
    expect([fev.deDia, fev.ateDia]).toEqual(["2026-01-28", "2026-02-27"]);
  });

  it("ano em A → [2026-01-01T03:00Z, 2027-01-01T03:00Z)", async () => {
    const j = await janela("ano");
    expect([j.inicio, j.fim]).toEqual(["2026-01-01T03:00:00.000Z", "2027-01-01T03:00:00.000Z"]);
  });

  it("RN-V06 limites: às 2026-10-05T01:00Z (22h local) hoje = 2026-10-04 e contém 02:30Z; a semana de A não contém", async () => {
    const hoje = await janela("hoje", new Date("2026-10-05T01:00:00Z"));
    expect(hoje).toEqual({
      deDia: "2026-10-04",
      ateDia: "2026-10-04",
      inicio: "2026-10-04T03:00:00.000Z",
      fim: "2026-10-05T03:00:00.000Z",
    });
    expect(contem(hoje, "2026-10-05T02:30:00Z")).toBe(true);
    expect(contem(await janela("semana"), "2026-10-05T02:30:00Z")).toBe(false);
  });

  it("Manaus: hoje em A começa às 04:00Z", async () => {
    expect((await janela("hoje", A, 1, MAO)).inicio).toBe("2026-10-07T04:00:00.000Z");
  });
});

describe("calendário puro", () => {
  it("inicioDaSemanaIso: segunda-feira ISO", async () => {
    const { inicioDaSemanaIso } = await carregar();
    expect(inicioDaSemanaIso("2026-10-04")).toBe("2026-09-28");
    expect(inicioDaSemanaIso("2026-10-05")).toBe("2026-10-05");
    expect(inicioDaSemanaIso("2026-12-31")).toBe("2026-12-28");
    expect(inicioDaSemanaIso("2027-01-03")).toBe("2026-12-28");
  });

  it("diasInclusivos: 2026-01-01..2027-01-01 = 366; ..2027-01-02 = 367", async () => {
    const { diasInclusivos } = await carregar();
    expect(diasInclusivos("2026-01-01", "2027-01-01")).toBe(366);
    expect(diasInclusivos("2026-01-01", "2027-01-02")).toBe(367);
  });

  it("ehDiaLocalValido: 2026-02-29 false, 2028-02-29 true, 2026-13-01 false, 2026-1-01 false", async () => {
    const { ehDiaLocalValido } = await carregar();
    expect(ehDiaLocalValido("2026-02-29")).toBe(false);
    expect(ehDiaLocalValido("2028-02-29")).toBe(true);
    expect(ehDiaLocalValido("2026-13-01")).toBe(false);
    expect(ehDiaLocalValido("2026-1-01")).toBe(false);
  });
});

describe("RN-V18 janelaDoRanking (A, SP, ciclo dia 5)", () => {
  it("tudo → inicio null, fim = início de amanhã local, rótulo 'desde o início'", async () => {
    const { janelaDoRanking } = await carregar();
    expect(janelaDoRanking("tudo", A, SP, 5)).toEqual({
      inicio: null,
      fim: "2026-10-08T03:00:00.000Z",
      rotulo: "desde o início",
    });
  });

  it("semana → inicio 2026-10-05T03:00Z", async () => {
    const { janelaDoRanking } = await carregar();
    expect(janelaDoRanking("semana", A, SP, 5).inicio).toBe("2026-10-05T03:00:00.000Z");
  });

  it("mes → ciclo atual [2026-10-05T03:00Z, 2026-11-05T03:00Z)", async () => {
    const { janelaDoRanking } = await carregar();
    const j = janelaDoRanking("mes", A, SP, 5);
    expect([j.inicio, j.fim]).toEqual(["2026-10-05T03:00:00.000Z", "2026-11-05T03:00:00.000Z"]);
  });

  it("ano → inicio 2026-01-01T03:00Z", async () => {
    const { janelaDoRanking } = await carregar();
    expect(janelaDoRanking("ano", A, SP, 5).inicio).toBe("2026-01-01T03:00:00.000Z");
  });
});
