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
  VEREDITO_CEP_NAO_EXISTE,
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

  // Caso que motivou a divergência 1 do `executar` (ver plano da 180-B): a
  // loja NÃO tem coords (misconfiguração que existe independente do bairro
  // ter casado), mas o bairro do cliente CASOU uma zona específica. `zonaId`
  // não-null tira o ramo `resultado.zonaId == null` do jogo antes mesmo de
  // `temCoordsLoja` ser consultado — a falta de coords da loja é irrelevante
  // quando o frete já é fato conhecido pelo bairro.
  it("loja SEM coords mas o bairro do cliente CASOU uma zona específica → { tipo:'ok' }, não VEREDITO_LOJA_SEM_COORDS", () => {
    expect(
      classificarFrete({
        resultado: resultadoZonaEspecifica(),
        zonas: [zonaBairro(), zonaRaio()],
        causaDistancia: "sem_cep",
        temCoordsLoja: false,
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
// =============================================================================
// RED — auditoria de segurança da 180-B, os TRÊS achados na fonte única
//
// A invariante que os três violam:
//   "o caminho 'frete a combinar' só pode ser alcançado por falha GENUÍNA do
//    serviço externo de geocoding — nunca por input do cliente, nunca pelo
//    nosso próprio throttle, nunca por configuração quebrada nossa."
//
// Hoje as três coisas colapsam em `transitorio`/`esgotado` e viram frete
// zerado. Cada uma ganha uma causa própria, e nenhuma delas classifica como
// a_combinar: o comportamento volta a ser o pré-180-B (fallback fora-de-zona
// quando a loja tem um, recusa quando não tem).
//
//   cep_inexistente ..... achado 1 — o ViaCEP AFIRMOU que o CEP não existe
//   throttle_interno .... achado 2 — o balde de burst NOSSO negou
//   indisponivel_config . achado 3 — falta env var NOSSA (chave/credenciais)
//
// `causaDistancia` é `CausaDistancia`, um union de literais: os três valores
// novos ainda não existem nele, então o cast pelo `unknown` é o que mantém o
// RED por ASSERÇÃO em vez de por type-check (o cast SAI na fase GREEN, quando
// os literais entrarem no union).
// =============================================================================

import type { CausaDistancia } from "@/lib/actions/distanciaFrete";

/** Causa que ainda não existe no union — cast só enquanto durar o RED. */
function causaNova(c: string): CausaDistancia {
  return c as unknown as CausaDistancia;
}

describe("[auditoria 180-B] causas que NÃO podem virar 'a combinar'", () => {
  // ── Achado 1 (ALTA): CEP inexistente vira frete grátis ─────────────────────
  it("[achado 1] 'cep_inexistente' + loja COM fallback → cobra o fallback (NÃO a_combinar)", () => {
    // Exploração que este teste fecha: comprador a 12 km, fora do raio, digita
    // rua/número/bairro reais e um CEP de formato válido que não existe. Hoje
    // sai a_combinar → taxa_entrega NULL → frete zero, a pedido do cliente.
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("cep_inexistente"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  // LITERAL ATUALIZADO na fase GREEN (decisão de UX do `executar`): o `tdd`
  // havia travado o veredito genérico "indisponivel", que a UI renderiza como
  // "não atendemos seu bairro". Isso é MENTIRA sobre a causa — o bairro
  // canônico foi descartado pelo fail-closed da 064 justamente porque o CEP não
  // existe, e o cliente pode consertar o CEP. Corrigir a mentira no caminho
  // a-combinar e deixá-la de pé no caminho indisponível seria meia correção,
  // que é exatamente o que esta issue existe para não fazer.
  it("[achado 1] 'cep_inexistente' + loja SEM fallback → indisponivel PELO CEP (nunca a_combinar)", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("cep_inexistente"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: VEREDITO_CEP_NAO_EXISTE });
  });

  // ── Achado 2 (ALTA): balde de burst global de chave fixa ───────────────────
  it("[achado 2] 'throttle_interno' + loja COM fallback → cobra o fallback (NÃO a_combinar)", () => {
    // 2-3 IPs saturando a janela de 10/s zeravam o frete de TODA loja com zona
    // raio_km. Throttle nosso não é outage do canal externo.
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("throttle_interno"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("[achado 2] 'throttle_interno' + loja SEM fallback → indisponivel, NÃO a_combinar", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("throttle_interno"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: "indisponivel" });
  });

  // ── Achado 3 (MÉDIA): config ausente vira frete grátis silencioso ──────────
  it("[achado 3] 'indisponivel_config' + loja COM fallback → cobra o fallback (NÃO a_combinar)", () => {
    // Perder GOOGLE_GEOCODING_API_KEY ou UPSTASH_REDIS_REST_* fazia TODO pedido
    // de entrega de TODA loja nascer sem frete, sem erro na UI e sem alarme.
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("indisponivel_config"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "ok" });
  });

  it("[achado 3] 'indisponivel_config' + loja SEM fallback → indisponivel, NÃO a_combinar", () => {
    expect(
      classificarFrete({
        resultado: resultadoForaDeArea(),
        zonas: [zonaRaio()],
        causaDistancia: causaNova("indisponivel_config"),
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "indisponivel", veredito: "indisponivel" });
  });

  // ── Uma zona ESPECÍFICA casou: nada muda em nenhum dos três ────────────────
  it("qualquer das três causas + zona específica casou → 'ok' (o frete é fato conhecido)", () => {
    for (const c of [
      "cep_inexistente",
      "throttle_interno",
      "indisponivel_config",
    ]) {
      expect(
        classificarFrete({
          resultado: resultadoZonaEspecifica(),
          zonas: [zonaRaio(), zonaBairro()],
          causaDistancia: causaNova(c),
          temCoordsLoja: true,
        }),
      ).toEqual({ tipo: "ok" });
    }
  });
});

// =============================================================================
// NÃO-REGRESSÃO: os a_combinar LEGÍTIMOS continuam legítimos.
// Falha genuína do serviço externo é exatamente o caso que a 180-B existe para
// cobrir — apertar os três achados não pode reabrir o dano original (cobrar do
// cliente o fallback fora-de-zona por um problema de infraestrutura NOSSO).
// =============================================================================
describe("[auditoria 180-B] não-regressão: falha genuína do canal SEGUE a_combinar", () => {
  it("'transitorio' (timeout do Google / ViaCEP caído) → a_combinar RETRIÁVEL", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: "transitorio",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_RETRIAVEL });
  });

  it("'nao_encontrado' (ZERO_RESULTS num CEP que o ViaCEP RESOLVEU) → a_combinar CEP", () => {
    // Endereço REAL que o geocoder não indexa: o cliente não tem culpa e não
    // tem como consertar trocando o CEP. Segue a_combinar.
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: "nao_encontrado",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_CEP });
  });

  it("'esgotado' (teto diário REAL batido) → a_combinar ESGOTADO", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: "esgotado",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_ESGOTADO });
  });

  it("'erro' (exceção interna) → a_combinar RETRIÁVEL", () => {
    expect(
      classificarFrete({
        resultado: resultadoFallback(20),
        zonas: [zonaRaio()],
        causaDistancia: "erro",
        temCoordsLoja: true,
      }),
    ).toEqual({ tipo: "a_combinar", veredito: VEREDITO_A_COMBINAR_RETRIAVEL });
  });
});
