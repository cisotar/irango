// Complemento da 371: round-trip por loja e defesa contra storage corrompido.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ESTADO_INICIAL, lerEstadoWizard, salvarEstadoWizard } from "./estado";

const LOJA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOJA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mapa = new Map<string, string>();

beforeEach(() => {
  mapa.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
      removeItem: (k: string) => void mapa.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("wizard por loja: round-trip (371)", () => {
  it("duas lojas guardam estados independentes e sobrescrever A não toca B", () => {
    salvarEstadoWizard(LOJA_A, { ...ESTADO_INICIAL, nome: "Ana" });
    salvarEstadoWizard(LOJA_B, { ...ESTADO_INICIAL, nome: "Beto" });
    salvarEstadoWizard(LOJA_A, { ...ESTADO_INICIAL, nome: "Ana2" });

    expect(lerEstadoWizard(LOJA_A)?.nome).toBe("Ana2");
    expect(lerEstadoWizard(LOJA_B)?.nome).toBe("Beto");
  });

  it("JSON corrompido de uma loja devolve null sem lançar", () => {
    mapa.set(`irango:checkout:${LOJA_A}`, "{quebrado");
    expect(lerEstadoWizard(LOJA_A)).toBeNull();
  });
});
