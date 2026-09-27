import { describe, it, expect } from "vitest";

import {
  frequenciaComum,
  frequenciaDoRascunho,
  mesmaFrequencia,
  rascunhoDaFrequencia,
  validarRascunhoFrequencia,
} from "./rascunhoFrequencia";
import { FREQUENCIA_PERMANENTE, type Frequencia } from "@/lib/utils/frequencia";
import { MSG_HORA_ORDEM, MSG_HORA_PAR } from "@/lib/validacoes/cardapio";
import { MSG_PERIODO_ORDEM } from "@/lib/validacoes/frequencia";

/** [323] Rascunho do editor de frequência (mockup §2.2, D13). */

const freq = (over: Partial<Frequencia> = {}): Frequencia => ({
  ...FREQUENCIA_PERMANENTE,
  ...over,
});

describe("323 — rascunho ⇄ frequência", () => {
  it("permanente ⇒ os três switches desligados, e volta permanente", () => {
    const r = rascunhoDaFrequencia(freq());
    expect([r.comDias, r.comHorario, r.comPeriodo]).toEqual([false, false, false]);
    expect(frequenciaDoRascunho(r)).toEqual(freq());
  });

  it("hora do Postgres 'HH:MM:SS' vira 'HH:MM' no input", () => {
    const r = rascunhoDaFrequencia(freq({ hora_inicio: "11:00:00", hora_fim: "15:00:00" }));
    expect([r.hora_inicio, r.hora_fim]).toEqual(["11:00", "15:00"]);
  });

  it("RN-8: switch de dias LIGADO sem pílula ⇒ [] (nunca), não null", () => {
    const r = { ...rascunhoDaFrequencia(freq()), comDias: true };
    expect(r.dias).toEqual([]);
    expect(frequenciaDoRascunho(r).dias_semana).toEqual([]);
    expect(frequenciaDoRascunho(r).dias_semana).not.toBeNull();
  });

  it("`[]` salvo reabre com o switch LIGADO e nenhuma pílula", () => {
    const r = rascunhoDaFrequencia(freq({ dias_semana: [] }));
    expect(r.comDias).toBe(true);
    expect(r.dias).toEqual([]);
  });

  it("desligar um eixo não apaga o digitado, mas ele não vai no payload", () => {
    const r = {
      ...rascunhoDaFrequencia(freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" })),
      comPeriodo: false,
    };
    expect(r.periodo_inicio).toBe("2026-12-01");
    expect(frequenciaDoRascunho(r).periodo_inicio).toBeNull();
  });

  it("o payload tem SEMPRE as 5 chaves (D13)", () => {
    expect(Object.keys(frequenciaDoRascunho(rascunhoDaFrequencia(freq()))).sort()).toEqual([
      "dias_semana",
      "hora_fim",
      "hora_inicio",
      "periodo_fim",
      "periodo_inicio",
    ]);
  });
});

describe("323 — validarRascunhoFrequencia (mesmo zod do servidor)", () => {
  const base = rascunhoDaFrequencia(freq());

  it("horário ligado com os dois vazios ⇒ MSG_HORA_PAR", () => {
    const v = validarRascunhoFrequencia({ ...base, comHorario: true });
    expect(v).toEqual({ ok: false, erros: { horario: MSG_HORA_PAR, periodo: null } });
  });

  it("fim antes do início ⇒ MSG_HORA_ORDEM; período invertido ⇒ MSG_PERIODO_ORDEM", () => {
    const v = validarRascunhoFrequencia({
      ...base,
      comHorario: true,
      hora_inicio: "15:00",
      hora_fim: "11:00",
      comPeriodo: true,
      periodo_inicio: "2026-12-31",
      periodo_fim: "2026-12-01",
    });
    expect(v).toEqual({ ok: false, erros: { horario: MSG_HORA_ORDEM, periodo: MSG_PERIODO_ORDEM } });
  });

  it("válido ⇒ os dados normalizados (7 dias ⇒ null; [] continua [])", () => {
    const todos = validarRascunhoFrequencia({ ...base, comDias: true, dias: [0, 1, 2, 3, 4, 5, 6] });
    expect(todos.ok && todos.frequencia.dias_semana).toBeNull();
    const nunca = validarRascunhoFrequencia({ ...base, comDias: true, dias: [] });
    expect(nunca.ok && nunca.frequencia.dias_semana).toEqual([]);
  });

  it("período de um dia só é válido (pontas inclusivas)", () => {
    const v = validarRascunhoFrequencia({
      ...base,
      comPeriodo: true,
      periodo_inicio: "2026-12-24",
      periodo_fim: "2026-12-24",
    });
    expect(v.ok).toBe(true);
  });
});

describe("323 — frequenciaComum (seleção múltipla)", () => {
  it("todas iguais (normalizado) ⇒ a frequência; divergentes ⇒ null; vazia ⇒ null", () => {
    const a = freq({ dias_semana: [6, 1], hora_inicio: "11:00:00", hora_fim: "15:00:00" });
    const b = freq({ dias_semana: [1, 6], hora_inicio: "11:00", hora_fim: "15:00" });
    expect(mesmaFrequencia(a, b)).toBe(true);
    expect(frequenciaComum([a, b])).toBe(a);
    expect(frequenciaComum([a, freq()])).toBeNull();
    expect(frequenciaComum([])).toBeNull();
  });

  it("null ≠ [] (D13)", () => {
    expect(mesmaFrequencia(freq(), freq({ dias_semana: [] }))).toBe(false);
  });
});
