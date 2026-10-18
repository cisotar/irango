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
