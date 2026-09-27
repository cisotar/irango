import { describe, it, expect } from "vitest";

import {
  ROTULO_SEM_VOLTA,
  avisoCategoriaQueNuncaAbre,
  avisoFrequenciaQueNuncaAbre,
  avisoPeriodoEncerrado,
  rotuloForaDaFrequencia,
  rotuloFrequencia,
} from "./descreverVigencia";
import { FREQUENCIA_PERMANENTE, type Frequencia } from "./frequencia";
import { instanteNoFuso } from "./fusoLoja";

/**
 * [323] As frases da frequência de exibição (C7): chip do painel, pílula da
 * vitrine e os avisos RN-1 / RN-7 / RN-8. Resultados escritos à mão.
 */

const SP = "America/Sao_Paulo";
const MANAUS = "America/Manaus";
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));

/** Sábado 17/10/2026 12:00, no fuso da loja. */
const SABADO_MEIO_DIA = emSP("2026-10-17T12:00");

const freq = (over: Partial<Frequencia> = {}): Frequencia => ({
  ...FREQUENCIA_PERMANENTE,
  ...over,
});

describe("323 — rotuloFrequencia (chip do painel)", () => {
  it("permanente ⇒ null (sem chip)", () => {
    expect(rotuloFrequencia(freq())).toBeNull();
  });

  it("RN-8: `[]` ⇒ 'Nunca disponível', sozinho, mesmo com horário e período", () => {
    expect(
      rotuloFrequencia(
        freq({ dias_semana: [], hora_inicio: "11:00", hora_fim: "15:00", periodo_fim: "2026-12-31" }),
      ),
    ).toBe("Nunca disponível");
  });

  it("`null` em dias NÃO é 'Nunca disponível' (D13)", () => {
    expect(rotuloFrequencia(freq({ hora_inicio: "11:00", hora_fim: "15:00" }))).toBe(
      "11:00–15:00",
    );
  });

  it("os três eixos, na ordem dias · horário · período", () => {
    expect(
      rotuloFrequencia(
        freq({
          dias_semana: [1, 2, 3, 4, 5],
          hora_inicio: "11:00:00",
          hora_fim: "15:00:00",
          periodo_inicio: "2026-12-01",
          periodo_fim: "2026-12-31",
        }),
      ),
    ).toBe("seg a sex · 11:00–15:00 · 01/12 a 31/12");
  });

  it("período meio-aberto: 'desde' e 'até'", () => {
    expect(rotuloFrequencia(freq({ periodo_inicio: "2026-12-01" }))).toBe("desde 01/12");
    expect(rotuloFrequencia(freq({ periodo_fim: "2026-12-31" }))).toBe("até 31/12");
  });

  it("um dia só ⇒ a forma curta ('sáb')", () => {
    expect(rotuloFrequencia(freq({ dias_semana: [6] }))).toBe("sáb");
  });
});

describe("323 — rotuloForaDaFrequencia (pílula da vitrine)", () => {
  it("categoria seg a sex, produto sem restrição, no sábado ⇒ 'Só seg a sex'", () => {
    expect(
      rotuloForaDaFrequencia(freq(), freq({ dias_semana: [1, 2, 3, 4, 5] }), SABADO_MEIO_DIA, SP),
    ).toBe("Só seg a sex");
  });

  it("produto das 18:00 às 23:00, ao meio-dia ⇒ 'Das 18:00 às 23:00'", () => {
    expect(
      rotuloForaDaFrequencia(
        freq({ hora_inicio: "18:00", hora_fim: "23:00" }),
        null,
        SABADO_MEIO_DIA,
        SP,
      ),
    ).toBe("Das 18:00 às 23:00");
  });

  it("período que ainda não começou ⇒ 'A partir de 01/12' (vence dia e hora)", () => {
    expect(
      rotuloForaDaFrequencia(
        freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31", dias_semana: [2] }),
        null,
        SABADO_MEIO_DIA,
        SP,
      ),
    ).toBe("A partir de 01/12");
  });

  it("RN-8: produto `[]` ou categoria `[]` ⇒ ROTULO_SEM_VOLTA", () => {
    expect(rotuloForaDaFrequencia(freq({ dias_semana: [] }), null, SABADO_MEIO_DIA, SP)).toBe(
      ROTULO_SEM_VOLTA,
    );
    expect(
      rotuloForaDaFrequencia(freq(), freq({ dias_semana: [] }), SABADO_MEIO_DIA, SP),
    ).toBe(ROTULO_SEM_VOLTA);
  });

  it("RN-1: interseção vazia (categoria seg–sex × produto só sáb) ⇒ ROTULO_SEM_VOLTA", () => {
    expect(
      rotuloForaDaFrequencia(
        freq({ dias_semana: [6] }),
        freq({ dias_semana: [1, 2, 3, 4, 5] }),
        SABADO_MEIO_DIA,
        SP,
      ),
    ).toBe(ROTULO_SEM_VOLTA);
  });

  it("nunca passa do teto de 32 caracteres da pílula", () => {
    const texto = rotuloForaDaFrequencia(
      freq({ dias_semana: [0, 2, 4] }),
      null,
      SABADO_MEIO_DIA,
      SP,
    );
    expect(texto).toBe("Só ter, qui e dom");
    expect(texto.length).toBeLessThanOrEqual(32);
  });
});

describe("323 — avisoFrequenciaQueNuncaAbre (RN-1/RN-8, painel)", () => {
  it("produto `[]` ⇒ null (o chip 'Nunca disponível' já diz)", () => {
    expect(avisoFrequenciaQueNuncaAbre(freq({ dias_semana: [] }), freq())).toBeNull();
  });

  it("categoria `[]` ⇒ manda marcar os dias na categoria", () => {
    expect(avisoFrequenciaQueNuncaAbre(freq(), freq({ dias_semana: [] }))).toBe(
      "Este item nunca vai ficar disponível: a categoria está sem nenhum dia marcado. Marque os dias na categoria.",
    );
  });

  it("RN-1: dias disjuntos ⇒ manda ajustar item ou categoria", () => {
    expect(
      avisoFrequenciaQueNuncaAbre(freq({ dias_semana: [6] }), freq({ dias_semana: [1, 2, 3, 4, 5] })),
    ).toBe(
      "Este item nunca vai ficar disponível: os dias e horários dele não batem com os da categoria. Ajuste a frequência do item ou da categoria.",
    );
  });

  it("período de 3 dias sem nenhum dos dias marcados ⇒ manda ajustar dias ou período", () => {
    // 2026-10-12 (seg) a 2026-10-14 (qua); item só sábado.
    expect(
      avisoFrequenciaQueNuncaAbre(
        freq({ dias_semana: [6], periodo_inicio: "2026-10-12", periodo_fim: "2026-10-14" }),
        null,
      ),
    ).toBe(
      "Este item nunca vai ficar disponível: o período marcado não tem nenhum dos dias escolhidos. Ajuste os dias ou o período.",
    );
  });

  it("sobreposição ⇒ null; permanente × permanente ⇒ null", () => {
    expect(
      avisoFrequenciaQueNuncaAbre(freq({ dias_semana: [5, 6] }), freq({ dias_semana: [1, 5] })),
    ).toBeNull();
    expect(avisoFrequenciaQueNuncaAbre(freq(), freq())).toBeNull();
  });
});

describe("323 — avisoCategoriaQueNuncaAbre", () => {
  it("`[]` ⇒ null; período sem os dias ⇒ o texto da categoria", () => {
    expect(avisoCategoriaQueNuncaAbre(freq({ dias_semana: [] }))).toBeNull();
    expect(
      avisoCategoriaQueNuncaAbre(
        freq({ dias_semana: [0], periodo_inicio: "2026-10-12", periodo_fim: "2026-10-14" }),
      ),
    ).toBe(
      "Esta categoria nunca vai ficar disponível: o período marcado não tem nenhum dos dias escolhidos. Ajuste os dias ou o período.",
    );
    expect(avisoCategoriaQueNuncaAbre(freq({ dias_semana: [1, 2] }))).toBeNull();
  });
});

describe("323 — avisoPeriodoEncerrado (RN-7, dia civil da loja)", () => {
  const NATAL = freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
  const VIRADA = new Date("2027-01-01T03:30:00.000Z");

  it("na virada: São Paulo já encerrou, Manaus ainda não", () => {
    expect(avisoPeriodoEncerrado(NATAL, VIRADA, SP)).toBe(
      "Período encerrado em 31/12: não aparece mais na vitrine. Mude o período para voltar a vender.",
    );
    expect(avisoPeriodoEncerrado(NATAL, VIRADA, MANAUS)).toBeNull();
  });

  it("sem período, ou antes do fim ⇒ null", () => {
    expect(avisoPeriodoEncerrado(freq(), VIRADA, SP)).toBeNull();
    expect(avisoPeriodoEncerrado(NATAL, emSP("2026-12-31T23:59"), SP)).toBeNull();
  });
});
