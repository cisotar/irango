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

    return { latitude, longitude };
  } catch (e) {
    // Genérico no servidor; NUNCA logar o par (lat,lng) do cliente (§Segurança).
    console.error("[geocodificarEndereco]", e);
    return null;
  }
}
