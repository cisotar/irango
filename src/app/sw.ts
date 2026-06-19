/// <reference lib="webworker" />
//
// Service Worker source (issue 006). Compilado pelo @serwist/turbopack via
// esbuild e servido same-origin pelo route handler de Serwist. Consome o array
// PURO de regras de `runtimeCaching.ts` (fonte única, testada no vitest) e o
// adapta para as estratégias concretas do Serwist, preservando a ORDEM — a
// regra NetworkOnly de /painel* fica em primeiro e nunca cacheia rota
// autenticada (RN-6 / seguranca.md §10).

import {
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type RuntimeCaching,
  type RouteMatchCallback,
} from "serwist";
import {
  runtimeCachingRules,
  type HandlerStrategy,
  type RuntimeCachingRule,
} from "@/lib/pwa/runtimeCaching";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[];
};

// Mapa nome → instância de estratégia do Serwist (preserva o cacheName da regra).
function criarEstrategia(
  handler: HandlerStrategy,
  cacheName: string | undefined,
) {
  switch (handler) {
    // NetworkOnly nunca cacheia → não aceita (nem precisa de) cacheName.
    case "NetworkOnly":
      return new NetworkOnly();
    case "CacheFirst":
      return new CacheFirst({ cacheName });
    case "NetworkFirst":
      return new NetworkFirst({ cacheName });
    case "StaleWhileRevalidate":
      return new StaleWhileRevalidate({ cacheName });
  }
}

// Adapta o matcher polimórfico das regras puras para o RouteMatchCallback do
// Serwist (que recebe { url, request, sameOrigin }).
function criarMatcher(
  urlPattern: RuntimeCachingRule["urlPattern"],
): RouteMatchCallback {
  if (typeof urlPattern === "function") {
    return ({ url }) => urlPattern(url);
  }
  if (urlPattern instanceof RegExp) {
    return ({ url }) => urlPattern.test(url.href) || urlPattern.test(url.pathname);
  }
  return ({ url }) =>
    url.pathname.startsWith(urlPattern) || url.href.startsWith(urlPattern);
}

const runtimeCaching: RuntimeCaching[] = runtimeCachingRules.map((rule) => ({
  matcher: criarMatcher(rule.urlPattern),
  handler: criarEstrategia(rule.handler, rule.options?.cacheName),
}));

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();
