// RED — issue 371: carrinho isolado por loja.
//
// Causa: chave global `irango:carrinho` + store de módulo único. sessionStorage é
// copiado ao abrir aba por link → a loja B mostrava itens da loja A. Aqui a chave
// passa a ser `irango:carrinho:<lojaId>` e cada loja tem o próprio estado.
//
// environment: node, sem jsdom. A API real do hook é capturada por render SSR
// (mesmo molde de useCarrinho.test.ts). `vi.resetModules()` + reimport simula
// "aba nova com sessionStorage copiado" (store de módulo recriada).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ItemCarrinho } from "@/types/dominio";

type ModuloCarrinho = typeof import("./useCarrinho");

const LOJA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOJA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROD_A = "11111111-1111-4111-8111-111111111111";
const PROD_B = "22222222-2222-4222-8222-222222222222";
const LEGADO = "irango:carrinho";

const mapa = new Map<string, string>();
const removidas: string[] = [];

beforeEach(() => {
  mapa.clear();
  removidas.length = 0;
  (globalThis as unknown as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
      removeItem: (k: string) => {
        removidas.push(k);
        mapa.delete(k);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.resetModules();
});

async function carregar(): Promise<ModuloCarrinho> {
  return import("./useCarrinho");
}

function api(mod: ModuloCarrinho, lojaId: string) {
  let capturada: ReturnType<ModuloCarrinho["useCarrinho"]> | undefined;
  function Sonda() {
    capturada = mod.useCarrinho(lojaId);
    return null;
  }
  renderToStaticMarkup(createElement(Sonda));
  if (!capturada) throw new Error("hook não renderizou");
  return capturada;
}

function item(produtoId: string): Omit<ItemCarrinho, "quantidade"> {
  return { produtoId, nome: "X", preco: 10 };
}

function guardado(chave: string): ItemCarrinho[] | null {
  const bruto = mapa.get(chave);
  return bruto ? (JSON.parse(bruto) as ItemCarrinho[]) : null;
}

describe("useCarrinho por loja (371)", () => {
  it("R1 adicionar na loja A grava só a chave de A", async () => {
    const mod = await carregar();
    api(mod, LOJA_A).adicionar(item(PROD_A));

    expect(guardado(`irango:carrinho:${LOJA_A}`)).toHaveLength(1);
    expect(mapa.has(`irango:carrinho:${LOJA_B}`)).toBe(false);
  });

  it("R2 sessão copiada com carrinho de A: adicionar em B não herda nem apaga A", async () => {
    mapa.set(
      `irango:carrinho:${LOJA_A}`,
      JSON.stringify([{ ...item(PROD_A), quantidade: 2 }]),
    );
    const mod = await carregar();

    api(mod, LOJA_B).adicionar(item(PROD_B));

    const b = guardado(`irango:carrinho:${LOJA_B}`);
    expect(b).toHaveLength(1);
    expect(b?.[0].produtoId).toBe(PROD_B);
    const a = guardado(`irango:carrinho:${LOJA_A}`);
    expect(a).toHaveLength(1);
    expect(a?.[0].quantidade).toBe(2);
  });

  it("R3 limpar/remover em B não altera A", async () => {
    const mod = await carregar();
    api(mod, LOJA_A).adicionar(item(PROD_A));
    api(mod, LOJA_B).adicionar(item(PROD_B));

    api(mod, LOJA_B).remover(PROD_B);
    api(mod, LOJA_B).adicionar(item(PROD_B));
    api(mod, LOJA_B).limpar();

    expect(guardado(`irango:carrinho:${LOJA_A}`)).toHaveLength(1);
    expect(guardado(`irango:carrinho:${LOJA_B}`) ?? []).toHaveLength(0);
  });

  it("R4 carrinho legado global é descartado (nunca adotado) e removido", async () => {
    mapa.set(LEGADO, JSON.stringify([{ ...item(PROD_A), quantidade: 3 }]));
    const mod = await carregar();

    api(mod, LOJA_B).adicionar(item(PROD_B));

    const b = guardado(`irango:carrinho:${LOJA_B}`);
    expect(b).toHaveLength(1);
    expect(b?.[0].produtoId).toBe(PROD_B);
    expect(mapa.has(LEGADO)).toBe(false);
  });

  it("R4b legado removido por igualdade exata: chave por loja sobrevive", async () => {
    mapa.set(`irango:carrinho:${LOJA_A}`, JSON.stringify([{ ...item(PROD_A), quantidade: 1 }]));
    mapa.set(LEGADO, "[]");
    const mod = await carregar();
    api(mod, LOJA_B).limpar();

    expect(removidas).toContain(LEGADO);
    expect(removidas).not.toContain(`irango:carrinho:${LOJA_A}`);
    expect(mapa.has(`irango:carrinho:${LOJA_A}`)).toBe(true);
  });

  it("R9 limparCarrinho(A) zera memória e storage de A, sem tocar B", async () => {
    const mod = await carregar();
    api(mod, LOJA_A).adicionar(item(PROD_A));
    api(mod, LOJA_B).adicionar(item(PROD_B));

    mod.limparCarrinho(LOJA_A);

    expect(guardado(`irango:carrinho:${LOJA_A}`) ?? []).toHaveLength(0);
    expect(guardado(`irango:carrinho:${LOJA_B}`)).toHaveLength(1);
    // Memória: re-renderizar A não traz os itens de volta.
    api(mod, LOJA_A).adicionar(item(PROD_A));
    expect(guardado(`irango:carrinho:${LOJA_A}`)).toHaveLength(1);
  });

  it("R8a chaveCarrinho = prefixo + uuid exato (sem slug/PII)", async () => {
    const mod = await carregar();
    expect(mod.chaveCarrinho(LOJA_A)).toBe(`irango:carrinho:${LOJA_A}`);
  });
});
