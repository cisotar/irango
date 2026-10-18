// Issue 325 — forma de frete ativa, derivada do `tipo` das zonas (módulo puro).
import { schemaZonasEntrega } from "@/lib/validacoes/entrega";
import { describe, expect, it } from "vitest";

import {
  formaGravadaDasZonas,
  formaInicialDaTela,
  FORMAS_FRETE,
  ROTULO_FORMA,
  ROTULO_FORMA_FRASE,
  rotuloDoTipo,
  precisaConfirmarSubstituicao,
  type FormaFrete,
  type FormaGravada,
} from "./formaFrete";
// [325 · forma ativa] `formaAtivaDaLoja` e `zonasDaForma` ainda não existem:
// resolvidas pelo NAMESPACE para o RED ser "export ausente", não import
// quebrado (precedente 328, entregaPagamento.zonasEdicao.test.ts).
import * as modulo from "./formaFrete";
import { entregaDisponivel } from "./modalidadesEntrega";

describe("formaGravadaDasZonas", () => {
  it("[] ⇒ nenhuma", () => {
    expect(formaGravadaDasZonas([])).toBe("nenhuma");
  });

  it("tipos iguais ⇒ o tipo (inclusive zona inativa, que conta)", () => {
    expect(formaGravadaDasZonas([{ tipo: "raio_km" }, { tipo: "raio_km" }])).toBe("raio_km");
    expect(formaGravadaDasZonas([{ tipo: "faixa_cep" }])).toBe("faixa_cep");
    expect(formaGravadaDasZonas([{ tipo: "bairro" }, { tipo: "bairro" }])).toBe("bairro");
  });

  it("tipos misturados ⇒ mista", () => {
    expect(formaGravadaDasZonas([{ tipo: "raio_km" }, { tipo: "bairro" }])).toBe("mista");
    expect(formaGravadaDasZonas([{ tipo: "faixa_cep" }, { tipo: "faixa_cep" }, { tipo: "raio_km" }])).toBe(
      "mista",
    );
  });

  it("tipo fora do enum ⇒ mista (pede confirmação em vez de assumir)", () => {
    expect(formaGravadaDasZonas([{ tipo: "cidade" }])).toBe("mista");
  });
});

describe("formaInicialDaTela", () => {
  it("nenhuma e mista abrem em faixas de km", () => {
    expect(formaInicialDaTela("nenhuma")).toBe("raio_km");
    expect(formaInicialDaTela("mista")).toBe("raio_km");
  });

  it("forma gravada abre nela mesma", () => {
    expect(formaInicialDaTela("raio_km")).toBe("raio_km");
    expect(formaInicialDaTela("faixa_cep")).toBe("faixa_cep");
    expect(formaInicialDaTela("bairro")).toBe("bairro");
  });
});

describe("precisaConfirmarSubstituicao — tabela verdade", () => {
  const casos: Array<[FormaFrete, FormaGravada, boolean, boolean]> = [
    // nenhuma ⇒ nunca pergunta
    ["raio_km", "nenhuma", false, false],
    ["raio_km", "nenhuma", true, false],
    ["faixa_cep", "nenhuma", false, false],
    ["bairro", "nenhuma", false, false],
    // mesma forma ⇒ não pergunta
    ["raio_km", "raio_km", false, false],
    ["faixa_cep", "faixa_cep", false, false],
    ["bairro", "bairro", false, false],
    // km fora do formato só importa no próprio km
    ["raio_km", "raio_km", true, true],
    ["faixa_cep", "faixa_cep", true, false],
    // outra forma ⇒ pergunta
    ["raio_km", "faixa_cep", false, true],
    ["faixa_cep", "raio_km", false, true],
    ["bairro", "raio_km", false, true],
    ["faixa_cep", "bairro", false, true],
    // mista ⇒ pergunta em qualquer forma
    ["raio_km", "mista", false, true],
    ["faixa_cep", "mista", false, true],
    ["bairro", "mista", false, true],
  ];

  it.each(casos)("editor %s, gravada %s, km fora do formato %s ⇒ %s", (editor, gravada, fora, esperado) => {
    expect(precisaConfirmarSubstituicao(editor, gravada, fora)).toBe(esperado);
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

describe("formaGravadaDasZonas — bordas", () => {
  it("uma zona de outro tipo no meio ou no fim torna a loja mista", () => {
    expect(formaGravadaDasZonas([{ tipo: "bairro" }, { tipo: "bairro" }, { tipo: "raio_km" }])).toBe("mista");
  });

  it("uma única zona de tipo desconhecido ⇒ mista (pede confirmação)", () => {
    expect(formaGravadaDasZonas([{ tipo: "legado_x" }])).toBe("mista");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fase RED — 325, forma ATIVA como coluna (`lojas.forma_frete`, D1/D6).
// Zonas das três formas ficam guardadas; só as da forma ativa valem.
//
// CONTRATO (src/lib/utils/formaFrete.ts):
//   formaAtivaDaLoja(valor: string | null | undefined): FormaFrete
//     — valor do enum → ele; null/undefined/fora do enum → "raio_km".
//   zonasDaForma<T extends { tipo: string }>(zonas: readonly T[], forma: FormaFrete): T[]
//     — só as zonas daquele tipo, na ordem recebida, mesmos objetos.
//   formaInicialDaTela(forma_frete: string | null | undefined): FormaFrete
//     — a tela abre na forma ATIVA da loja, não na forma derivada das zonas.
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

/** Assinatura NOVA de `formaInicialDaTela` (recebe `lojas.forma_frete`, não a forma gravada). */
const formaInicialDaTelaNova = modulo.formaInicialDaTela as unknown as (v: string | null | undefined) => FormaFrete;

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

describe("[325/F8] formaInicialDaTela — a tela abre na forma ATIVA (lojas.forma_frete)", () => {
  it.each<[string, FormaFrete]>([
    ["raio_km", "raio_km"],
    ["faixa_cep", "faixa_cep"],
    ["bairro", "bairro"],
  ])("forma_frete %s ⇒ abre em %s (independe das zonas guardadas)", (valor, esperado) => {
    expect(formaInicialDaTelaNova(valor)).toBe(esperado);
  });

  it.each<[string, string | null | undefined]>([
    ["null", null],
    ["undefined", undefined],
    ["fora do enum 'cidade'", "cidade"],
  ])("forma_frete %s ⇒ abre em raio_km", (_n, valor) => {
    expect(formaInicialDaTelaNova(valor)).toBe("raio_km");
  });
});
