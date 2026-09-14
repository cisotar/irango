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

// =============================================================================
// RED (TDD red-first) — issue 180-B, teste nº 9 do plano.
//
// `classificarFrete` e `distanciaEraNecessaria` são STUBS (`throw TODO: GREEN`)
// — toda expectativa abaixo é VERMELHA por asserção, não por import quebrado.
//
// A invariante que esta função existe para garantir:
//   "o valor cobrado só pode derivar de FATO conhecido sobre o endereço;
//    AUSÊNCIA de conhecimento não é um fato sobre o endereço."
//
// Predicado do plano (§D3):
//   a_combinar ⟺ causa ∈ {nao_encontrado, transitorio, esgotado, erro,
//                         loja_sem_coords}
//              ∧ resultado.zonaId == null
//              ∧ distanciaEraNecessaria(zonas)
//
// ⚠ AMBIGUIDADE DO PLANO (reportada pelo `tdd`, decidir antes do GREEN):
//   o predicado acima inclui `loja_sem_coords` no conjunto de a_combinar, MAS
//   duas passagens em prosa do MESMO plano dizem o contrário — §D3 ("a loja sem
//   coords mantém VEREDITO_LOJA_SEM_COORDS, que já existe") e a seção Cenários
//   ("Loja sem coords (180-A/005) → VEREDITO_LOJA_SEM_COORDS mantido. Não vira
//   a combinar."). Os testes abaixo codificam a PROSA (indisponivel_loja), que
//   aparece duas vezes e é a que a seção de cenários — a mais próxima de
//   critério de aceite — afirma. Se a decisão for a outra, é UM teste a virar.
// =============================================================================

import {
  classificarFrete,
  distanciaEraNecessaria,
  VEREDITO_A_COMBINAR_RETRIAVEL,
  VEREDITO_A_COMBINAR_ESGOTADO,
  VEREDITO_A_COMBINAR_CEP,
  VEREDITO_LOJA_SEM_COORDS,
} from "./freteDegradado";
import type { ResultadoFrete } from "./calcularFrete";

/** Saída de `calcularFrete` quando o FALLBACK fora-de-zona foi aplicado. */
function resultadoFallback(taxa = 15): ResultadoFrete {
  return { atendido: true, taxa, zonaId: null, gratis: false };
}

/** Saída de `calcularFrete` quando uma zona ESPECÍFICA casou. */
function resultadoZonaEspecifica(zonaId = "z-bairro", taxa = 7): ResultadoFrete {
  return { atendido: true, taxa, zonaId, gratis: false };
}

/** Saída de `calcularFrete` quando NADA casou e não há fallback. */
function resultadoForaDeArea(): ResultadoFrete {
  return { atendido: false, taxa: 0, zonaId: null, gratis: false };
}

describe("distanciaEraNecessaria (180-B) — a distância importava para ESTA loja?", () => {
  it("zona raio_km ativa e com taxa → true", () => {
    expect(distanciaEraNecessaria([zonaRaio()])).toBe(true);
  });

  it("zona raio_km INATIVA → false (nunca casaria de qualquer forma)", () => {
    expect(distanciaEraNecessaria([zonaRaio(false)])).toBe(false);
  });

  it("zona raio_km SEM taxa → false (mesmo predicado de zonaAtende)", () => {
    expect(distanciaEraNecessaria([zonaRaio(true, false)])).toBe(false);
  });

  it("só zonas bairro → false (o fallback fora-de-zona ali é regra legítima)", () => {
    expect(distanciaEraNecessaria([zonaBairro()])).toBe(false);
  });

  it("sem zonas → false", () => {
    expect(distanciaEraNecessaria([])).toBe(false);
  });
});

describe("classificarFrete (180-B) — matriz causa × zona casou × raio necessário", () => {
  // ── causa "ok": nada muda, sem regressão ───────────────────────────────────
  it("causa 'ok' + fallback aplicado → { tipo:'ok' } (fallback legítimo segue valendo)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(),
        zonas: [zonaRaio()],
        causaDistancia: "ok",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("causa 'ok' + endereço genuinamente FORA de área (sem fallback) → indisponivel", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: "ok",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: "indisponivel" });
  });

  // ── O CORAÇÃO: distância necessária e DESCONHECIDA nunca vira preço ────────
  it("causa 'transitorio' + nenhuma zona casou + raio necessário → a_combinar RETRIÁVEL (PRECEDE o fallback)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_RETRIAVEL });
  });

  it("causa 'esgotado' → a_combinar ESGOTADO (mesma invariante, texto diferente)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "esgotado",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_ESGOTADO });
  });

  it("causa 'nao_encontrado' → a_combinar CEP (D4: também vira a combinar)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "nao_encontrado",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_CEP });
  });

  it("causa 'erro' (exceção interna) → a_combinar RETRIÁVEL", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "erro",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_RETRIAVEL });
  });

  it("a_combinar PRECEDE também o 'indisponivel': sem fallback, geocoding caído NÃO diz 'não atendemos seu bairro'", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_RETRIAVEL });
  });

  // ── Os dois lados da precedência: o fallback legítimo NÃO pode regredir ────
  it("geocoding caído mas loja SEM zona de raio → { tipo:'ok' } (fallback fora-de-zona é regra de negócio)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaBairro()],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("geocoding caído mas zona raio INATIVA → { tipo:'ok' } (a distância nunca importou)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio(false)],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("geocoding caído mas uma zona ESPECÍFICA casou (bairro) → { tipo:'ok' } (o frete é fato conhecido)", () => {
    expect(
      classificarFrete({
        resultado: resultadoZonaEspecifica(),
        zonas: [zonaBairro(), zonaRaio()],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  // ── sem_cep e loja_sem_coords: casos que NÃO viram a combinar ──────────────
  it("causa 'sem_cep' + fallback aplicado → { tipo:'ok' } (sem CEP o caminho de raio nem se aplica)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "sem_cep",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("causa 'sem_cep' + fora de área + loja com raio SEM coords → VEREDITO_LOJA_SEM_COORDS (005 preservado)", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: "sem_cep",
        temCoordsLoja: false,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: VEREDITO_LOJA_SEM_COORDS });
  });

  it("causa 'loja_sem_coords' → VEREDITO_LOJA_SEM_COORDS, NÃO a combinar (misconfiguração da loja, não do canal)", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(15),
        zonas: [zonaRaio()],
        causaDistancia: "loja_sem_coords",
        temCoordsLoja: false,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: VEREDITO_LOJA_SEM_COORDS });
  });

  // ── §19: o par (lat,lng) nunca atravessa — só enum/booleano ────────────────
  it("§19: o veredito é só enum — nenhuma coordenada, nenhum km, nenhum detalhe técnico atravessa", () => {
    const v = classificarFrete({
      resultado: resultadoFallback(15),
      zonas: [zonaRaio()],
      causaDistancia: "transitorio",
      temCoordsLoja: true,
    });
    const serializado = JSON.stringify(v);
    expect(serializado).not.toMatch(/latitude|longitude|lat"|lng"|-22\.|-46\./);
    expect(Object.keys(v).sort()).toEqual(["tipo", "veredito"]);
  });
});
