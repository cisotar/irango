// RED — issue 371: estado do wizard de checkout isolado por loja.
// environment: node — `window.sessionStorage` falso instalado por teste.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ESTADO_INICIAL,
  chaveWizard,
  lerEstadoWizard,
  salvarEstadoWizard,
} from "./estado";

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

describe("estado do wizard por loja (371)", () => {
  it("R5 salvar em A não aparece ao ler B", () => {
    salvarEstadoWizard(LOJA_A, { ...ESTADO_INICIAL, nome: "Fulano", codigoCupom: "X10" });

    expect(lerEstadoWizard(LOJA_B)).toBeNull();
    expect(lerEstadoWizard(LOJA_A)?.nome).toBe("Fulano");
  });

  it("R6 chave legada global `irango:checkout` nunca é lida", () => {
    mapa.set("irango:checkout", JSON.stringify({ ...ESTADO_INICIAL, nome: "Legado" }));

    expect(lerEstadoWizard(LOJA_B)).toBeNull();
  });

  it("R6b chave legada é removida ao carregar o módulo, sem tocar chaves por loja", async () => {
    mapa.set("irango:checkout", "{}");
    mapa.set(`irango:checkout:${LOJA_A}`, "{}");
    vi.resetModules();
    await import("./estado");

    expect(mapa.has("irango:checkout")).toBe(false);
    expect(mapa.has(`irango:checkout:${LOJA_A}`)).toBe(true);
  });

  it("R8b chaveWizard = prefixo + uuid exato (sem slug/PII)", () => {
    expect(chaveWizard(LOJA_A)).toBe(`irango:checkout:${LOJA_A}`);
  });
});
