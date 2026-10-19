// Issue 325 — forma de frete ativa (`lojas.forma_frete`) e zonas guardadas por forma (módulo puro).
import { schemaZonasEntrega } from "@/lib/validacoes/entrega";
import { describe, expect, it } from "vitest";

import {
  FORMAS_FRETE,
  ROTULO_FORMA,
  ROTULO_FORMA_FRASE,
  rotuloDoTipo,
  precisaConfirmarSubstituicao,
  zonasResumoDoPayload,
  type FormaFrete,
} from "./formaFrete";
// [325 · forma ativa] Escrito na fase RED, quando `formaAtivaDaLoja` e
// `zonasDaForma` não existiam: resolvidas pelo NAMESPACE para o RED ser
// "export ausente", não import quebrado (precedente 328,
// entregaPagamento.zonasEdicao.test.ts).
import * as modulo from "./formaFrete";
import { entregaDisponivel } from "./modalidadesEntrega";

// 325 (forma ativa): trocar de forma não pergunta mais nada — as zonas da forma
// anterior ficam guardadas. Sobra só a confirmação do km legado fora do formato
// de faixas (D4 da 326).
describe("precisaConfirmarSubstituicao — só km legado fora do formato", () => {
  const casos: Array<[boolean, boolean, boolean, boolean]> = [
    // kmForaDoFormato, jaGravou, confirmou ⇒ pergunta?
    [true, false, false, true],
    [true, true, false, false],
    [true, false, true, false],
    [false, false, false, false],
    [false, true, true, false],
  ];

  it.each(casos)("km fora do formato %s, já gravou %s, confirmou %s ⇒ %s", (kmForaDoFormato, jaGravou, confirmou, esperado) => {
    expect(precisaConfirmarSubstituicao({ kmForaDoFormato, jaGravou, confirmou })).toBe(esperado);
  });
});

describe("zonasResumoDoPayload — zonas efetivas da forma depois de gravar", () => {
  it("km, CEP e bairro viram { ativo, taxa } por faixa/grupo, na ordem", () => {
    expect(
      zonasResumoDoPayload({
        forma: "raio_km",
        incremento: 1,
        faixas: [
          { taxa: 5, pedido_minimo_gratis: null, ativo: true },
          { taxa: 8, pedido_minimo_gratis: 50, ativo: false },
        ],
      }),
    ).toEqual([
      { ativo: true, taxa: 5 },
      { ativo: false, taxa: 8 },
    ]);
    expect(
      zonasResumoDoPayload({
        forma: "faixa_cep",
        faixas: [{ cep_inicio: 1000000, cep_fim: 1099999, taxa: 7, pedido_minimo_gratis: null, ativo: true }],
      }),
    ).toEqual([{ ativo: true, taxa: 7 }]);
    expect(
      zonasResumoDoPayload({
        forma: "bairro",
        grupos: [{ bairros: ["Centro"], taxa: 0, pedido_minimo_gratis: null, ativo: false }],
      }),
    ).toEqual([{ ativo: false, taxa: 0 }]);
  });

  it("payload vazio ⇒ []", () => {
    expect(zonasResumoDoPayload({ forma: "bairro", grupos: [] })).toEqual([]);
  });

  it("loja com km ativo grava CEP pela 1ª vez: a disponibilidade sai do payload, não da carga vazia", () => {
    const loja = { aceita_entrega: true, modo_frete: "automatico", taxa_entrega_fora_zona: null };
    const zonasCepDaCarga: { ativo: boolean; taxa: unknown }[] = [];
    expect(entregaDisponivel(loja, zonasCepDaCarga)).toBe(false);
    const gravadas = zonasResumoDoPayload({
      forma: "faixa_cep",
      faixas: [{ cep_inicio: 1000000, cep_fim: 1099999, taxa: 7, pedido_minimo_gratis: null, ativo: true }],
    });
    expect(entregaDisponivel(loja, gravadas)).toBe(true);
  });
});

describe("rotuloDoTipo e formas", () => {
  it("cada tipo do banco tem o rótulo da sua forma; tipo desconhecido aparece cru", () => {
    expect(rotuloDoTipo("raio_km")).toBe("Faixas de distância (km)");
    expect(rotuloDoTipo("faixa_cep")).toBe("Faixas de CEP");
    expect(rotuloDoTipo("bairro")).toBe("Bairros");
    expect(rotuloDoTipo("legado_x")).toBe("legado_x");
  });

  it("FORMAS_FRETE cobre exatamente as formas que a action aceita, cada uma com rótulo", () => {
    const minimo: Record<string, object> = {
      raio_km: { incremento: 1, faixas: [] },
      faixa_cep: { faixas: [] },
      bairro: { grupos: [] },
    };
    expect([...FORMAS_FRETE].sort()).toEqual(Object.keys(minimo).sort());
    for (const forma of FORMAS_FRETE) {
      expect(schemaZonasEntrega.safeParse({ forma, versao: 0, ...minimo[forma] }).success).toBe(true);
      expect(ROTULO_FORMA[forma]).toBeTruthy();
      expect(ROTULO_FORMA_FRASE[forma]).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 325 (escrito na fase RED), forma ATIVA como coluna (`lojas.forma_frete`, D1/D6).
// Zonas das três formas ficam guardadas; só as da forma ativa valem.
//
// CONTRATO (src/lib/utils/formaFrete.ts):
//   formaAtivaDaLoja(valor: string | null | undefined): FormaFrete
//     — valor do enum → ele; null/undefined/fora do enum → "raio_km".
//   zonasDaForma<T extends { tipo: string }>(zonas: readonly T[], forma: FormaFrete): T[]
//     — só as zonas daquele tipo, na ordem recebida, mesmos objetos.
//   A tela abre na forma ATIVA (`useState(forma)`, já estreitada no servidor).
// ═══════════════════════════════════════════════════════════════════════════

type ZonaTipo = { tipo: string; ativo: boolean; taxa: unknown | null };

function formaAtivaDaLoja(valor: string | null | undefined): FormaFrete {
  const fn = (modulo as unknown as { formaAtivaDaLoja?: (v: string | null | undefined) => FormaFrete }).formaAtivaDaLoja;
  if (typeof fn !== "function") {
    throw new Error("[RED 325] `src/lib/utils/formaFrete.ts` ainda não exporta `formaAtivaDaLoja` (D6).");
  }
  return fn(valor);
}

function zonasDaForma<T extends { tipo: string }>(zonas: readonly T[], forma: FormaFrete): T[] {
  const fn = (modulo as unknown as { zonasDaForma?: (z: readonly T[], f: FormaFrete) => T[] }).zonasDaForma;
  if (typeof fn !== "function") {
    throw new Error("[RED 325] `src/lib/utils/formaFrete.ts` ainda não exporta `zonasDaForma` (D6).");
  }
  return fn(zonas, forma);
}

describe("[325/F7] formaAtivaDaLoja — lojas.forma_frete estreitado para o enum", () => {
  it.each<[string, FormaFrete]>([
    ["raio_km", "raio_km"],
    ["faixa_cep", "faixa_cep"],
    ["bairro", "bairro"],
  ])("%s ⇒ %s", (valor, esperado) => {
    expect(formaAtivaDaLoja(valor)).toBe(esperado);
  });

  it.each<[string, string | null | undefined]>([
    ["null (banco sem a coluna)", null],
    ["undefined (coluna fora do select)", undefined],
    ["lixo 'cidade'", "cidade"],
    ["string vazia", ""],
    ["caixa diferente 'BAIRRO'", "BAIRRO"],
    ["'mista' (não é forma ativa)", "mista"],
    ["'nenhuma' (não é forma ativa)", "nenhuma"],
  ])("%s ⇒ raio_km", (_n, valor) => {
    expect(formaAtivaDaLoja(valor)).toBe("raio_km");
  });
});

describe("[325/F7] zonasDaForma — só as zonas da forma ativa valem", () => {
  const km1 = { id: "k1", tipo: "raio_km", ativo: true, taxa: { taxa: 8 } };
  const bairro1 = { id: "b1", tipo: "bairro", ativo: true, taxa: { taxa: 5 } };
  const km2 = { id: "k2", tipo: "raio_km", ativo: false, taxa: { taxa: 9 } };
  const cep1 = { id: "c1", tipo: "faixa_cep", ativo: true, taxa: { taxa: 7 } };
  const guardadas = [km1, bairro1, km2, cep1];

  it("filtra pelo tipo, na ordem recebida, com os mesmos objetos (inclusive inativas)", () => {
    const r = zonasDaForma(guardadas, "raio_km");
    expect(r).toEqual([km1, km2]);
    expect(r[0]).toBe(km1);
    expect(zonasDaForma(guardadas, "bairro")).toEqual([bairro1]);
    expect(zonasDaForma(guardadas, "faixa_cep")).toEqual([cep1]);
  });

  it("forma sem zona guardada ⇒ []; lista vazia ⇒ []", () => {
    expect(zonasDaForma([km1], "bairro")).toEqual([]);
    expect(zonasDaForma([], "raio_km")).toEqual([]);
  });

  it("não muta a lista recebida", () => {
    const copia = [...guardadas];
    zonasDaForma(guardadas, "bairro");
    expect(guardadas).toEqual(copia);
  });

  it("loja bairro só com km guardado → entregaDisponivel false", () => {
    const loja = { aceita_entrega: true, modo_frete: "automatico", taxa_entrega_fora_zona: null, forma_frete: "bairro" };
    const zonas: ZonaTipo[] = [km1, { ...km1, id: "k3" }];
    expect(entregaDisponivel(loja, zonasDaForma(zonas, formaAtivaDaLoja(loja.forma_frete)))).toBe(false);
  });

  it("espelho: loja raio_km com o MESMO km guardado → entregaDisponivel true", () => {
    const loja = { aceita_entrega: true, modo_frete: "automatico", taxa_entrega_fora_zona: null, forma_frete: "raio_km" };
    const zonas: ZonaTipo[] = [km1, bairro1];
    expect(entregaDisponivel(loja, zonasDaForma(zonas, formaAtivaDaLoja(loja.forma_frete)))).toBe(true);
  });
});
