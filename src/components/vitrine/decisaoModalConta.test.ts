import { describe, expect, it } from "vitest";
import {
  chaveDispensaConta,
  decidirModalConta,
  lerDispensa,
  marcarDispensa,
} from "./decisaoModalConta";

function storageEmMemoria(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

function storageQueLanca(): Storage {
  const lanca = () => {
    throw new Error("SecurityError");
  };
  return { length: 0, clear: lanca, getItem: lanca, key: lanca, removeItem: lanca, setItem: lanca };
}

describe("decidirModalConta", () => {
  it("convidado que não dispensou → abre", () => {
    expect(decidirModalConta({ logado: false, dispensado: false })).toBe(true);
  });

  it("logado → não abre", () => {
    expect(decidirModalConta({ logado: true, dispensado: false })).toBe(false);
  });

  it("dispensou nesta aba → não abre", () => {
    expect(decidirModalConta({ logado: false, dispensado: true })).toBe(false);
  });
});

describe("dispensa por loja", () => {
  it("marcar numa loja não dispensa outra", () => {
    const s = storageEmMemoria();
    marcarDispensa(s, "lanches-base");
    expect(lerDispensa(s, "lanches-base")).toBe(true);
    expect(lerDispensa(s, "outra-loja")).toBe(false);
    expect(s.getItem(chaveDispensaConta("lanches-base"))).toBe("1");
  });

  it("storage ausente ou lançando → não dispensado e sem exceção (o aviso abre)", () => {
    expect(lerDispensa(null, "x")).toBe(false);
    expect(lerDispensa(storageQueLanca(), "x")).toBe(false);
    expect(() => marcarDispensa(storageQueLanca(), "x")).not.toThrow();
    expect(() => marcarDispensa(null, "x")).not.toThrow();
  });
});
