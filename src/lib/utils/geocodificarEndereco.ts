// Geocoding CEP/endereço → coordenadas via Nominatim (OpenStreetMap). Util
// server-only que encapsula a chamada externa com User-Agent identificado,
// AbortSignal.timeout e uma trava global de 1 req/s (issue 003, spec
// zonas-entrega-raio-km §Rate limit Nominatim).
//
// INVERSÃO DE POLÍTICA vs rateLimit.ts — LEIA ANTES DE COPIAR O MOLDE:
//   rateLimit.ts protege o iRango CONTRA o cliente (abuso por IP) → FAIL-OPEN:
//     se o Redis cai, LIBERA (derrubar checkout é pior que perder a trava).
//   Este módulo protege um TERCEIRO (OSM) CONTRA o iRango → FAIL-CLOSED:
//     sem trava global, N lambdas concorrentes da Vercel martelam o Nominatim
//     em paralelo e o IP do iRango é BANIDO (indisponibilidade global, RN-5/6).
//   Invariante: toda chamada ao Nominatim só sai se a trava global de 1 req/s
//   foi efetivamente verificada e concedida. Qualquer estado em que a trava não
//   pode ser verificada (sem User-Agent, sem credenciais, Redis down, exceção)
//   ⇒ NÃO chamar ⇒ null.
//
// server-only: lê credenciais Upstash (UPSTASH_REDIS_REST_*) e NOMINATIM_USER_AGENT
// — variáveis sem prefixo público (seguranca.md §7). O `import "server-only"` quebra
// o build se importado de um Client Component, garantindo que nada vaze ao bundle.
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { limparCep } from "./buscarCep";

export type Coordenadas = { latitude: number; longitude: number };

// Singleton lazy: Redis.fromEnv() lança se as env vars faltam — só instanciamos
// na primeira chamada com credenciais presentes (igual a rateLimit.ts).
let redisSingleton: Redis | null = null;
let limitadorNominatim: Ratelimit | null = null;

function credenciaisNominatim(): boolean {
  return (
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function userAgent(): string | null {
  const ua = process.env.NOMINATIM_USER_AGENT?.trim();
  return ua ? ua : null;
}

// Limitador ISOLADO de LIMITES (que é tipado em minutos): trava GLOBAL de
// 1 req/s com prefixo próprio (não colide com irango:rl:<chave>) e política
// oposta (fail-closed). Por isso vive aqui, não em rateLimit.ts.
function obterLimitador(): Ratelimit {
  if (limitadorNominatim == null) {
    redisSingleton ??= Redis.fromEnv();
    limitadorNominatim = new Ratelimit({
      redis: redisSingleton,
      limiter: Ratelimit.fixedWindow(1, "1 s"),
      prefix: "irango:rl:nominatim",
    });
  }
  return limitadorNominatim;
}

// ── Cache CEP→coords (issue 001, RN-F1..F10) ─────────────────────────────────
// Insumo GEOGRÁFICO apenas (coords do CEP), nunca valor monetário. Usa o MESMO
// redisSingleton da trava (não instancia outro Redis). Política fail-OPEN no
// cache (oposto da trava fail-CLOSED): se o cache cai, ignoramos e seguimos para
// trava+fetch — o cache é otimização, não pré-condição anti-ban.

// Cacheabilidade: a consulta é um CEP sse seus dígitos somam EXATAMENTE 8 e nada
// mais (RN-F6/F7). `distanciaDaLojaAoCep` passa o CEP isolado; `salvarPerfil`
// passa endereço completo (≠ 8 dígitos) → o critério separa os dois caminhos.
function cepCacheavel(consulta: string): string | null {
  const digitos = limparCep(consulta);
  return /^\d{8}$/.test(digitos) ? digitos : null;
}

function chaveCache(cep: string): string {
  return `irango:geocode:${cep}`;
}

// Aceita o valor do Redis como objeto OU JSON-string (@upstash/redis pode
// devolver qualquer um). Valida Number.isFinite nos dois campos. Qualquer
// falha/lixo (Redis down, JSON inválido, NaN, shape errado) = miss (null).
async function lerCacheCoordenadas(cep: string): Promise<Coordenadas | null> {
  try {
    redisSingleton ??= Redis.fromEnv();
    const bruto = await redisSingleton.get(chaveCache(cep));
    if (bruto == null) return null;
    const obj: unknown = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
    if (typeof obj !== "object" || obj == null) return null;
    const { latitude, longitude } = obj as Record<string, unknown>;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude: latitude as number, longitude: longitude as number };
  } catch {
    // fail-open: cache indisponível/corrompido → miss; segue trava+fetch.
    return null;
  }
}

// SET simples SEM TTL (cache permanente, RN-F2). Só no caminho de sucesso
// (RN-F10 — sem cache negativo). Falha de gravação é engolida: o par já foi
// computado e é retornado normalmente (fail-open de escrita).
async function gravarCacheCoordenadas(
  cep: string,
  coords: Coordenadas,
): Promise<void> {
  try {
    redisSingleton ??= Redis.fromEnv();
    await redisSingleton.set(chaveCache(cep), coords);
  } catch {
    // Engole: gravação é best-effort, não afeta o retorno.
  }
}

/**
 * Geocodifica uma `consulta` livre (CEP, ou "rua, número, cidade, UF") via
 * Nominatim. O caller monta a query; este módulo só geocodifica e aplica a
 * política anti-ban (RN-6).
 *
 * Retorna { latitude, longitude } numéricos, ou `null` em QUALQUER falha:
 * sem User-Agent, sem credenciais, Redis down, limite excedido, HTTP não-ok,
 * timeout, JSON vazio, lat/lon não-numérico. Nunca propaga exceção.
 */
export async function geocodificarEndereco(
  consulta: string,
): Promise<Coordenadas | null> {
  // Portão 0: User-Agent é pré-condição da trava anti-ban — Nominatim bane
  // requisições sem UA identificado. Ausente/vazio → null, não toca nada.
  const ua = userAgent();
  if (!ua) return null;

  // Portão 1: sem credenciais Upstash não há trava global → fail-closed.
  // NÃO toca o Redis (oposto de rateLimit.ts, que retornaria permitido:true).
  if (!credenciaisNominatim()) return null;

  // Portão de cache (leitura): só para consultas-CEP. Hit válido retorna SEM
  // disputar a trava de 1 req/s nem bater no Nominatim (RN-F3). Miss/lixo/Redis
  // down → fail-open, segue para a trava (RN-F4/F5 preservados).
  const cep = cepCacheavel(consulta);
  if (cep) {
    const cacheado = await lerCacheCoordenadas(cep);
    if (cacheado) return cacheado;
  }

  try {
    // Portão 2: a trava global. fixedWindow(1,"1 s") com identificador fixo
    // garante que só 1 req/s sai entre TODAS as lambdas (balde compartilhado).
    const { success } = await obterLimitador().limit("nominatim-global");
    // Portão 3: limite excedido → null imediato, sem fetch, sem latência.
    if (!success) return null;

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(consulta)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": ua },
    });
    if (!resp.ok) return null;

    const body = (await resp.json()) as Array<{ lat?: string; lon?: string }>;
    const primeiro = Array.isArray(body) ? body[0] : null;
    if (!primeiro) return null;

    const latitude = Number(primeiro.lat);
    const longitude = Number(primeiro.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const coords: Coordenadas = { latitude, longitude };
    // Grava SÓ no caminho de sucesso e SÓ se a consulta era um CEP (RN-F2/F10).
    if (cep) await gravarCacheCoordenadas(cep, coords);
    return coords;
  } catch (e) {
    // Genérico no servidor; NUNCA logar o par (lat,lng) do cliente (§Segurança).
    console.error("[geocodificarEndereco]", e);
    return null;
  }
}
