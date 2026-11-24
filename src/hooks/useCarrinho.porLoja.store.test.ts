// Cobertura complementar da 371: snapshot estável POR LOJA, alternância de duas
// lojas no mesmo módulo e evento `storage` escopado pela chave da loja.
// environment: node. `useSyncExternalStore` é interceptado para capturar
// (subscribe, getSnapshot) reais do hook — o render SSR só devolveria VAZIO.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ItemCarrinho } from "@/types/dominio";

type Capt = { subscribe: (cb: () => void) => () => void; getSnapshot: () => ItemCarrinho[] };
const capt: { atual?: Capt } = {};

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useSyncExternalStore: (
      subscribe: Capt["subscribe"],
      getSnapshot: Capt["getSnapshot"],
      getServer: () => ItemCarrinho[],
    ) => {
      capt.atual = { subscribe, getSnapshot };
      return getServer();
    },
  };
});

type Mod = typeof import("./useCarrinho");
const LOJA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOJA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const mapa = new Map<string, string>();
const handlers = new Set<(e: { key: string | null }) => void>();

beforeEach(() => {
  mapa.clear();
  handlers.clear();
  (globalThis as unknown as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
      removeItem: (k: string) => void mapa.delete(k),
    },
    addEventListener: (_: string, h: (e: { key: string | null }) => void) => handlers.add(h),
    removeEventListener: (_: string, h: (e: { key: string | null }) => void) => handlers.delete(h),
  };
  vi.resetModules();
});

function hook(mod: Mod, lojaId: string) {
  let api!: ReturnType<Mod["useCarrinho"]>;
  function Sonda() {
    api = mod.useCarrinho(lojaId);
    return null;
  }
  renderToStaticMarkup(createElement(Sonda));
  return { api, ...(capt.atual as Capt) };
}

const it1 = (produtoId: string) => ({ produtoId, nome: "X", preco: 10 });

describe("useCarrinho por loja: store (371)", () => {
  it("snapshot é estável por loja e mutar A não troca a referência de B", async () => {
    const mod = await import("./useCarrinho");
    const a = hook(mod, LOJA_A);
    const b = hook(mod, LOJA_B);
    const antesB = b.getSnapshot();
    expect(b.getSnapshot()).toBe(antesB);

    a.api.adicionar(it1(P1));

    expect(a.getSnapshot()).toHaveLength(1);
    expect(a.getSnapshot()).toBe(a.getSnapshot());
    expect(b.getSnapshot()).toBe(antesB);
    expect(b.getSnapshot()).toHaveLength(0);
  });

  it("alternar A, B, A no mesmo módulo preserva cada carrinho", async () => {
    const mod = await import("./useCarrinho");
    hook(mod, LOJA_A).api.adicionar(it1(P1), 2);
    hook(mod, LOJA_B).api.adicionar(it1(P2));
    hook(mod, LOJA_A).api.adicionar(it1(P1));

    expect(hook(mod, LOJA_A).getSnapshot()).toMatchObject([{ produtoId: P1, quantidade: 3 }]);
    expect(hook(mod, LOJA_B).getSnapshot()).toMatchObject([{ produtoId: P2, quantidade: 1 }]);
  });

  it("evento storage com chave de A relê A e ignora B e chave legada", async () => {
    const mod = await import("./useCarrinho");
    const a = hook(mod, LOJA_A);
    const b = hook(mod, LOJA_B);
    const avisos = vi.fn();
    a.subscribe(avisos);
    expect(handlers.size).toBe(1);
    const [h] = [...handlers];
    // Materializa os snapshots (leitura preguiçosa) ANTES de mexer no storage.
    expect(a.getSnapshot()).toHaveLength(0);
    expect(b.getSnapshot()).toHaveLength(0);

    mapa.set(
      mod.chaveCarrinho(LOJA_A),
      JSON.stringify([{ ...it1(P1), quantidade: 4 }]),
    );
    mapa.set(mod.chaveCarrinho(LOJA_B), JSON.stringify([{ ...it1(P2), quantidade: 9 }]));
    const antesB = b.getSnapshot();

    h({ key: "irango:carrinho" }); // legada: ignorada
    h({ key: mod.chaveCarrinho(LOJA_B) }); // outra loja: este handler é de A
    expect(avisos).not.toHaveBeenCalled();
    expect(a.getSnapshot()).toHaveLength(0);

    h({ key: mod.chaveCarrinho(LOJA_A) });
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(a.getSnapshot()).toMatchObject([{ produtoId: P1, quantidade: 4 }]);
    expect(b.getSnapshot()).toBe(antesB);
  });

  it("unsubscribe remove o listener de storage", async () => {
    const mod = await import("./useCarrinho");
    const off = hook(mod, LOJA_A).subscribe(() => {});
    expect(handlers.size).toBe(1);
    off();
    expect(handlers.size).toBe(0);
  });

  it("limparCarrinho(A) avisa assinantes e getSnapshot(A) vira vazio sem afetar B", async () => {
    const mod = await import("./useCarrinho");
    const a = hook(mod, LOJA_A);
    const b = hook(mod, LOJA_B);
    a.api.adicionar(it1(P1));
    b.api.adicionar(it1(P2));
    const avisos = vi.fn();
    a.subscribe(avisos);

    mod.limparCarrinho(LOJA_A);

    expect(avisos).toHaveBeenCalled();
    expect(a.getSnapshot()).toEqual([]);
    expect(b.getSnapshot()).toHaveLength(1);
  });

  it("JSON corrompido ou não-array no storage de uma loja vira carrinho vazio", async () => {
    mapa.set(`irango:carrinho:${LOJA_A}`, "{nao-json");
    mapa.set(`irango:carrinho:${LOJA_B}`, JSON.stringify({ x: 1 }));
    const mod = await import("./useCarrinho");
    expect(hook(mod, LOJA_A).getSnapshot()).toEqual([]);
    expect(hook(mod, LOJA_B).getSnapshot()).toEqual([]);
  });
});
