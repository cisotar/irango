// RED (TDD red-first) — issue 003. `lojaTemRaioSemCoords` ainda NÃO existe em
// freteDegradado.ts, então a importação falha e todas as expectativas ficam
// vermelhas.
//
// Contrato (issue 003 / RN-2-C): classifica a CAUSA do frete indisponível —
// "a loja tem zona raio_km ativa mas está sem coords (par NULL)" vs. "endereço
// genuinamente fora de área". Função PURA, sem I/O: recebe as zonas já
// hidratadas e um booleano de presença de coords da loja (derivado no servidor;
// nunca o par lat/lng cru — seguranca.md §19). NÃO decide taxa, só classifica.

import { describe, it, expect } from "vitest";

import { lojaTemRaioSemCoords } from "./freteDegradado";
import type { ZonaComTaxa } from "./calcularFrete";

function zonaRaio(ativo = true, comTaxa = true): ZonaComTaxa {
  return {
    id: "z-raio",
    tipo: "raio_km",
    ativo,
    taxa: comTaxa
      ? {
          taxa: 9,
          pedido_minimo_gratis: null,
          raio_max_km: 5,
          cep_inicio: null,
          cep_fim: null,
        }
      : null,
    bairros: [],
  };
}

function zonaBairro(): ZonaComTaxa {
  return {
    id: "z-bairro",
    tipo: "bairro",
    ativo: true,
    taxa: {
      taxa: 7,
      pedido_minimo_gratis: null,
      raio_max_km: null,
      cep_inicio: null,
      cep_fim: null,
    },
    bairros: [{ nome: "Centro" }],
  };
}

describe("lojaTemRaioSemCoords (issue 003)", () => {
  it("zona raio_km ativa + temCoords=false → true", () => {
    expect(lojaTemRaioSemCoords([zonaRaio()], false)).toBe(true);
  });

  it("zona raio_km ativa + temCoords=true → false", () => {
    expect(lojaTemRaioSemCoords([zonaRaio()], true)).toBe(false);
  });

  it("zona raio_km INATIVA + temCoords=false → false", () => {
    expect(lojaTemRaioSemCoords([zonaRaio(false)], false)).toBe(false);
  });

  it("zona raio_km sem taxa + temCoords=false → false", () => {
    expect(lojaTemRaioSemCoords([zonaRaio(true, false)], false)).toBe(false);
  });

  it("só zonas bairro/faixa_cep (sem raio) + temCoords=false → false", () => {
    expect(lojaTemRaioSemCoords([zonaBairro()], false)).toBe(false);
  });

  it("sem zonas + temCoords=false → false", () => {
    expect(lojaTemRaioSemCoords([], false)).toBe(false);
  });

  it("mix: bairro + raio ativa, temCoords=false → true (basta uma raio sem coords)", () => {
    expect(lojaTemRaioSemCoords([zonaBairro(), zonaRaio()], false)).toBe(true);
  });
});
