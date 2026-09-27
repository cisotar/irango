/**
 * [302] Os três estados AO VIVO do modal sazonal no painel ("Ativo",
 * "Rascunho", "Fora da janela").
 *
 * `environment: node`, sem jsdom: o estado é função pura de `(modal, agora)`,
 * então os rótulos e a escada de precedência são afirmáveis byte a byte — que é
 * o ponto de tirá-los do `.tsx`. A janela é comparada instante × instante
 * (RN-02), sem fuso.
 */

import { describe, it, expect } from "vitest";

import { estadoDoModalSazonal } from "./estadoModalSazonal";

const INICIO = "2026-06-01T00:00:00-03:00";
const FIM = "2026-06-15T00:00:00-03:00";

function modal(over: Partial<{ ativo: boolean; exibicao_inicio: string; exibicao_fim: string }> = {}) {
  return {
    ativo: true,
    exibicao_inicio: INICIO,
    exibicao_fim: FIM,
    ...over,
  };
}

describe("estadoDoModalSazonal", () => {
  it("inativo é Rascunho (neutro), mesmo dentro da janela", () => {
    const agora = new Date("2026-06-07T12:00:00-03:00");
    expect(estadoDoModalSazonal(modal({ ativo: false }), agora)).toEqual({
      tom: "neutro",
      rotulo: "Rascunho",
    });
  });

  it("ativo e dentro da janela é Ativo (verde)", () => {
    const agora = new Date("2026-06-07T12:00:00-03:00");
    expect(estadoDoModalSazonal(modal(), agora)).toEqual({
      tom: "verde",
      rotulo: "Ativo",
    });
  });

  it("ativo mas antes da janela é Fora da janela (âmbar)", () => {
    const agora = new Date("2026-05-01T12:00:00-03:00");
    expect(estadoDoModalSazonal(modal(), agora)).toEqual({
      tom: "ambar",
      rotulo: "Fora da janela",
    });
  });

  it("ativo mas depois da janela é Fora da janela (âmbar)", () => {
    const agora = new Date("2026-07-01T12:00:00-03:00");
    expect(estadoDoModalSazonal(modal(), agora)).toEqual({
      tom: "ambar",
      rotulo: "Fora da janela",
    });
  });
});
