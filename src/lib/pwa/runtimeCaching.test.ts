import { describe, it, expect } from "vitest";
// RED-first (issue 006): este módulo NÃO EXISTE AINDA. O import abaixo deve
// quebrar a resolução até a fase GREEN criar `./runtimeCaching`.
import { runtimeCachingRules, type RuntimeCachingRule } from "./runtimeCaching";

// ===========================================================================
// CONTRATO (issue 006 — Plano Técnico, D3/D4/D5)
//
// src/lib/pwa/runtimeCaching.ts exporta:
//
//   export type RuntimeCachingRule = {
//     urlPattern: RegExp | string | ((url: URL) => boolean);
//     handler: string; // 'NetworkOnly' | 'CacheFirst' | 'NetworkFirst' | 'StaleWhileRevalidate'
//     options?: object;
//   };
//   export const runtimeCachingRules: RuntimeCachingRule[];
//
// Invariante crítico (RN-6 / §10): o Service Worker NUNCA cacheia /painel/*.
// O Serwist avalia as regras EM ORDEM e usa a PRIMEIRA que casar (D4). Logo:
//   - a regra NetworkOnly de /painel* tem de estar no índice 0;
//   - nenhuma regra de cache pode casar /painel/* ANTES dela.
//
// Este é o teste de defesa-em-profundidade contra cache poisoning local
// (servir resposta autenticada de uma sessão a outra no mesmo dispositivo).
// A defesa real do dado continua sendo RLS + cookies HttpOnly no servidor.
// ===========================================================================

// --- Helper: avalia o urlPattern polimórfico contra uma URL (espelha a
// --- semântica do Serwist/Workbox, não a lógica das regras). ---
function casa(rule: RuntimeCachingRule, href: string): boolean {
  const url = new URL(href, "https://irango.app");
  const p = rule.urlPattern;
  if (typeof p === "function") return p(url);
  if (p instanceof RegExp) return p.test(url.href) || p.test(url.pathname);
  // string → match por prefixo de pathname/href (forma usada pelo Workbox p/ strings)
  return url.pathname.startsWith(p) || url.href.startsWith(p);
}

// Índice da PRIMEIRA regra que casa a URL (-1 se nenhuma) — é a regra que o SW
// efetivamente aplicaria.
function indicePrimeiroMatch(href: string): number {
  return runtimeCachingRules.findIndex((r) => casa(r, href));
}

const ROTA_PAINEL = "/painel/pedidos"; // rota autenticada — NUNCA pode ir a cache
const CHUNK_ESTATICO = "/_next/static/chunks/main.js"; // imutável por hash
const NAV_VITRINE = "/loja/pizzaria-test"; // navegação HTML pública

const ESTRATEGIAS_DE_CACHE = ["CacheFirst", "StaleWhileRevalidate"];

// ===========================================================================
// 1. Existe pelo menos uma regra NetworkOnly (nunca cacheia)
// ===========================================================================
describe("runtimeCaching — regra que nunca cacheia", () => {
  it("existe pelo menos uma regra com handler NetworkOnly", () => {
    const networkOnly = runtimeCachingRules.filter(
      (r) => r.handler === "NetworkOnly",
    );
    expect(networkOnly.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 2. A regra NetworkOnly casa /painel/pedidos
// ===========================================================================
describe("runtimeCaching — NetworkOnly cobre rota autenticada", () => {
  it("a regra NetworkOnly casa /painel/pedidos", () => {
    const networkOnly = runtimeCachingRules.filter(
      (r) => r.handler === "NetworkOnly",
    );
    const algumaCasaPainel = networkOnly.some((r) => casa(r, ROTA_PAINEL));
    expect(algumaCasaPainel).toBe(true);
  });
});

// ===========================================================================
// 3. A regra NetworkOnly é a PRIMEIRA do array (índice 0)
// ===========================================================================
describe("runtimeCaching — ordem do isolamento", () => {
  it("a regra do índice 0 é NetworkOnly", () => {
    expect(runtimeCachingRules[0]?.handler).toBe("NetworkOnly");
  });

  it("a regra do índice 0 casa /painel/pedidos", () => {
    expect(casa(runtimeCachingRules[0], ROTA_PAINEL)).toBe(true);
  });
});

// ===========================================================================
// 4. Nenhuma regra de cache casa /painel/pedidos ANTES da NetworkOnly
//    (semântica "primeira que casa vence" do Serwist).
// ===========================================================================
describe("runtimeCaching — /painel/* nunca chega a uma regra de cache", () => {
  it("a PRIMEIRA regra que casa /painel/pedidos é NetworkOnly", () => {
    const idx = indicePrimeiroMatch(ROTA_PAINEL);
    expect(idx).toBeGreaterThanOrEqual(0); // alguma regra casa
    expect(runtimeCachingRules[idx]?.handler).toBe("NetworkOnly");
  });

  it("nenhuma regra de cache (CacheFirst/StaleWhileRevalidate) casa /painel/pedidos", () => {
    const cacheCasandoPainel = runtimeCachingRules.filter(
      (r) => ESTRATEGIAS_DE_CACHE.includes(r.handler) && casa(r, ROTA_PAINEL),
    );
    expect(cacheCasandoPainel).toEqual([]);
  });
});

// ===========================================================================
// 5. Existe CacheFirst para _next/static/chunks/main.js (imutável)
// ===========================================================================
describe("runtimeCaching — assets imutáveis", () => {
  it("existe regra CacheFirst que casa /_next/static/chunks/main.js", () => {
    const cacheFirst = runtimeCachingRules.filter(
      (r) => r.handler === "CacheFirst",
    );
    const algumaCasaChunk = cacheFirst.some((r) => casa(r, CHUNK_ESTATICO));
    expect(algumaCasaChunk).toBe(true);
  });

  it("a PRIMEIRA regra que casa o chunk estático NÃO é NetworkOnly", () => {
    // garante que _next/static não foi acidentalmente coberto pela regra do painel
    const idx = indicePrimeiroMatch(CHUNK_ESTATICO);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(runtimeCachingRules[idx]?.handler).not.toBe("NetworkOnly");
  });
});

// ===========================================================================
// 6. Navegação HTML é network-first (NetworkFirst) para /loja/[slug]
// ===========================================================================
describe("runtimeCaching — navegação HTML é network-first", () => {
  it("existe regra NetworkFirst que casa /loja/pizzaria-test", () => {
    const networkFirst = runtimeCachingRules.filter(
      (r) => r.handler === "NetworkFirst",
    );
    const algumaCasaNav = networkFirst.some((r) => casa(r, NAV_VITRINE));
    expect(algumaCasaNav).toBe(true);
  });
});
