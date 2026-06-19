// Regras de runtime caching do Service Worker (issue 006 — fase GREEN).
//
// Invariante crítico (RN-6 / seguranca.md §10): o SW NUNCA cacheia /painel/*.
// O Serwist avalia as regras EM ORDEM e usa a PRIMEIRA que casar (Decisão D4).
// Logo a regra NetworkOnly de /painel* tem de estar no índice 0 — qualquer
// regra de cache vem depois e nunca chega a casar uma rota autenticada.
//
// Este módulo é PURO de propósito (Decisão D3): só monta a estrutura de regras
// (matcher polimórfico + nome da estratégia), sem depender de globais de Service
// Worker. Assim a invariante de ordem/exclusão é asserção unitária no vitest
// (ver runtimeCaching.test.ts). O `src/app/sw.ts` adapta cada regra para a
// estratégia concreta do Serwist (NetworkOnly, CacheFirst, ...).
//
// Defesa-em-profundidade contra cache poisoning local (servir resposta
// autenticada de uma sessão a outra no mesmo dispositivo). A defesa REAL do
// dado continua sendo RLS + cookies HttpOnly no servidor — o SW é só UX.

/** Nomes de estratégia do Serwist usados nas regras. */
export type EstrategiaHandler =
  | "NetworkOnly"
  | "CacheFirst"
  | "NetworkFirst"
  | "StaleWhileRevalidate";

export type RegraRuntimeCaching = {
  /** Matcher polimórfico: RegExp, prefixo de string ou predicado sobre a URL. */
  urlPattern: RegExp | string | ((url: URL) => boolean);
  handler: EstrategiaHandler;
  options?: { cacheName?: string };
};

// Storage público do Supabase (imagens de produto/loja). Imutável-por-conteúdo
// na prática: a troca de imagem revalida em background (StaleWhileRevalidate).
const STORAGE_PUBLICO = "/storage/v1/object/public/";

const ehNavegacao = (url: URL): boolean => {
  // Documento HTML: pathname sem extensão de arquivo e fora das rotas técnicas.
  if (url.pathname.startsWith("/_next/")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  const ultimoSegmento = url.pathname.split("/").pop() ?? "";
  return !ultimoSegmento.includes(".");
};

export const runtimeCachingRules: RegraRuntimeCaching[] = [
  // [0] NetworkOnly /painel* — PRIMEIRA. Nunca cacheia rota autenticada (RN-6).
  {
    urlPattern: (url) => url.pathname.startsWith("/painel"),
    handler: "NetworkOnly",
    options: { cacheName: "painel-network-only" },
  },
  // [1] Assets imutáveis do Next (hash no nome → CacheFirst seguro).
  {
    urlPattern: (url) => url.pathname.startsWith("/_next/static/"),
    handler: "CacheFirst",
    options: { cacheName: "next-static-assets" },
  },
  // [2] Fontes + imagens públicas do storage Supabase → revalida em background.
  {
    urlPattern: (url) =>
      /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname) ||
      url.pathname.includes(STORAGE_PUBLICO),
    handler: "StaleWhileRevalidate",
    options: { cacheName: "fontes-e-imagens" },
  },
  // [3] Navegação / HTML dinâmico → rede primeiro; cache só fallback de
  // resiliência. Catálogo/preço nunca são verdade do cache (RN-6 / §10).
  {
    urlPattern: ehNavegacao,
    handler: "NetworkFirst",
    options: { cacheName: "navegacao-html" },
  },
];
