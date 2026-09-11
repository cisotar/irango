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
import { dentroDoBrasil } from "./geocodingCepCliente";

export type Coordenadas = { latitude: number; longitude: number };

/**
 * Versão do VALOR gravado no cache de coordenadas (issue 185, D4/V3). Qualquer
 * valor sem `v === VERSAO_CACHE_GEOCODE` é tratado como MISS — foi assim que o
 * cache envenenado pelo CEP cru se auto-corrige, sem `DEL` em produção.
 */
export const VERSAO_CACHE_GEOCODE = 2;

/**
 * TTL do cache de coordenadas: 180 dias (issue 185, D4). "Sem TTL" foi o que
 * transformou um erro de query num defeito permanente por CEP — todo
 * envenenamento futuro passa a ter prazo de validade sem intervenção humana.
 */
export const TTL_CACHE_GEOCODE_SEGUNDOS = 15_552_000;

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

// (185/D3) A cacheabilidade NÃO é mais inferida do FORMATO da consulta: a chave
// (o CEP) e a consulta (o texto resolvido pelo ViaCEP) são coisas separadas e
// chegam separadas em `geocodificarCepResolvido`. O predicado antigo
// (`cepCacheavel`) desligaria o cache em silêncio agora que a consulta é
// textual — toda resolução disputaria a trava de 1 req/s (fail-closed) e o
// segundo checkout do mesmo segundo ficaria sem frete.

function chaveCache(cep: string): string {
  return `irango:geocode:${cep}`;
}

// Aceita o valor do Redis como objeto OU JSON-string (@upstash/redis pode
// devolver qualquer um). Valida Number.isFinite nos dois campos E a versão do
// valor (185/D4/V3). Qualquer falha/lixo (Redis down, JSON inválido, NaN, shape
// errado, valor legado sem `v`) = miss (null).
async function lerCacheCoordenadas(cep: string): Promise<Coordenadas | null> {
  try {
    redisSingleton ??= Redis.fromEnv();
    const bruto = await redisSingleton.get(chaveCache(cep));
    if (bruto == null) return null;
    const obj: unknown = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
    if (typeof obj !== "object" || obj == null) return null;
    const { latitude, longitude, v } = obj as Record<string, unknown>;
    // Valor gravado antes do fix (sem `v`, ou `v` antigo) pode carregar coords
    // envenenadas pelo CEP cru → MISS, refaz e sobrescreve a MESMA chave.
    if (v !== VERSAO_CACHE_GEOCODE) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    // Number.isFinite não estreita `unknown` → cast seguro após a guarda acima.
    return { latitude: latitude as number, longitude: longitude as number };
  } catch {
    // fail-open: cache indisponível/corrompido → miss; segue trava+fetch.
    return null;
  }
}

// SET versionado COM TTL de 180 dias (185/D4 — substitui o cache permanente da
// RN-F2). Só no caminho de sucesso (RN-F10 — sem cache negativo). Falha de
// gravação é engolida: o par já foi computado e é retornado normalmente
// (fail-open de escrita).
async function gravarCacheCoordenadas(
  cep: string,
  coords: Coordenadas,
): Promise<void> {
  try {
    redisSingleton ??= Redis.fromEnv();
    await redisSingleton.set(
      chaveCache(cep),
      { ...coords, v: VERSAO_CACHE_GEOCODE },
      { ex: TTL_CACHE_GEOCODE_SEGUNDOS },
    );
  } catch {
    // Engole: gravação é best-effort, não afeta o retorno.
  }
}

/**
 * Motivo da ausência de coords (issue 004). Discrimina falha **transitória**
 * (re-tentar resolve: trava 1 req/s excedida, timeout, 5xx, Redis/credenciais/UA
 * indisponíveis) de **endereço não localizável** (Nominatim 200 com lista vazia
 * ou coords não-finitas — problema do dado, não do canal).
 */
export type MotivoGeocoding = "nao_encontrado" | "transitorio";

/** Resultado discriminado do geocoding com motivo (issue 004). */
export type ResultadoGeocoding =
  | { coords: Coordenadas }
  | { coords: null; motivo: MotivoGeocoding };

// Portões 2/3 + fetch + parse, SEM cache (a decisão de cachear é do caller, que
// é quem tem a chave — 185/D3). `restringirBrasil` acrescenta `countrycodes=br`;
// só o caminho do CEP do cliente passa `true` (o caminho da loja é a issue 186).
async function consultarNominatim(
  ua: string,
  consulta: string,
  opcoes: { restringirBrasil: boolean },
): Promise<ResultadoGeocoding> {
  try {
    // Portão 2: a trava global. fixedWindow(1,"1 s") com identificador fixo
    // garante que só 1 req/s sai entre TODAS as lambdas (balde compartilhado).
    const { success } = await obterLimitador().limit("nominatim-global");
    // Portão 3: limite excedido → transitório (re-tentar fora da janela resolve).
    if (!success) return { coords: null, motivo: "transitorio" };

    const pais = opcoes.restringirBrasil ? "&countrycodes=br" : "";
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1${pais}&q=${encodeURIComponent(consulta)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": ua },
    });
    // HTTP não-ok (5xx, 429, etc.): canal indisponível → transitório.
    if (!resp.ok) return { coords: null, motivo: "transitorio" };

    const body = (await resp.json()) as Array<{ lat?: string; lon?: string }>;
    const primeiro = Array.isArray(body) ? body[0] : null;
    // Nominatim respondeu 200 mas sem resultado → endereço não localizável.
    if (!primeiro) return { coords: null, motivo: "nao_encontrado" };

    const latitude = Number(primeiro.lat);
    const longitude = Number(primeiro.lon);
    // 200 com coords não-finitas: também é "não encontrado" (dado imprestável).
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { coords: null, motivo: "nao_encontrado" };
    }

    return { coords: { latitude, longitude } };
  } catch (e) {
    // Genérico no servidor; NUNCA logar o par (lat,lng) nem a consulta do
    // cliente (§14/§19/§21). Exceção (limit lança, timeout, fetch reject) =
    // canal indisponível → transitório.
    console.error("[geocodificarEndereco]", e);
    return { coords: null, motivo: "transitorio" };
  }
}

/**
 * Geocodifica uma `consulta` livre ("rua, número, cidade, UF") via Nominatim,
 * retornando o MOTIVO quando não há coords (issue 004). Usada pelo lado da LOJA
 * (salvarPerfil/admin), onde o endereço é digitado pelo lojista e a precisão de
 * logradouro vale o risco de `nao_encontrado` (185/D5).
 *
 * NÃO lê nem grava cache (185/D3): cacheabilidade deixou de ser inferida do
 * formato da consulta. Em runtime nada muda para a loja — endereço completo
 * nunca casou os 8 dígitos do predicado antigo.
 *
 * Política anti-ban INALTERADA (seguranca.md §12-A): qualquer estado em que a
 * trava global de 1 req/s não pôde ser verificada/concedida ⇒ NÃO chama o
 * Nominatim. Esses estados (sem UA/credenciais, trava negada/indisponível,
 * timeout, HTTP não-ok) são `transitorio`; só Nominatim 200-sem-resultado é
 * `nao_encontrado`. Nunca propaga exceção; nunca loga o par (lat,lng) (§14/§21).
 */
export async function geocodificarEnderecoComMotivo(
  consulta: string,
): Promise<ResultadoGeocoding> {
  // Portão 0: User-Agent é pré-condição da trava anti-ban — Nominatim bane
  // requisições sem UA identificado. Ausente/vazio → não chama (transitório:
  // re-tentar com a env corrigida resolve).
  const ua = userAgent();
  if (!ua) return { coords: null, motivo: "transitorio" };

  // Portão 1: sem credenciais Upstash não há trava global → fail-closed.
  // NÃO toca o Redis (oposto de rateLimit.ts, que retornaria permitido:true).
  if (!credenciaisNominatim()) return { coords: null, motivo: "transitorio" };

  return consultarNominatim(ua, consulta, { restringirBrasil: false });
}

/**
 * Geocodifica o CEP de um cliente (issue 185). Dona ÚNICA do cache CEP→coords.
 *
 * A causa raiz da 185 era mandar o CEP CRU como busca livre ao Nominatim, que
 * não indexa CEP brasileiro. Aqui o CEP é só a CHAVE de cache; a CONSULTA vem do
 * `montarConsulta` — um thunk que resolve o endereço no ViaCEP (servidor) e
 * monta "<bairro>, <cidade> - <uf>, Brasil". O thunk só é invocado DEPOIS do
 * miss de cache, o que mantém o teto de chamadas externas: cache hit ⇒ 0 idas ao
 * ViaCEP e 0 ao Nominatim.
 *
 * Ordem OBRIGATÓRIA dos portões (§Teto do plano; §12-A):
 *   UA → credenciais Upstash → GET cache → thunk (ViaCEP) → trava 1 req/s →
 *   fetch Nominatim → guard `dentroDoBrasil` → SET cache versionado com TTL.
 *
 * FAIL-CLOSED: thunk `null` (ViaCEP fora do ar, CEP inexistente, resposta sem
 * cidade/UF) ⇒ `transitorio` SEM chamar o Nominatim — jamais cai no CEP cru como
 * consulta de consolo. Teto de 1 chamada ao Nominatim por resolução: sem cadeia
 * de tentativas, sem retry (a trava negaria a segunda chamada na mesma janela).
 */
export async function geocodificarCepResolvido(
  cep: string,
  montarConsulta: () => Promise<string | null>,
): Promise<ResultadoGeocoding> {
  // Portões 0 e 1: idênticos ao caminho da loja (§12-A).
  const ua = userAgent();
  if (!ua) return { coords: null, motivo: "transitorio" };
  if (!credenciaisNominatim()) return { coords: null, motivo: "transitorio" };

  // A chave é o CEP normalizado: com e sem máscara resolvem a MESMA entrada.
  // CEP malformado → nada a resolver, sem NENHUMA I/O externa.
  const digitos = limparCep(cep);
  if (!/^\d{8}$/.test(digitos)) return { coords: null, motivo: "transitorio" };

  // Portão de cache (leitura) ANTES do ViaCEP: é o que sustenta o teto de
  // chamadas. Miss/lixo/Redis down → fail-open, segue (RN-F4/F5 preservados).
  const cacheado = await lerCacheCoordenadas(digitos);
  if (cacheado) return { coords: cacheado };

  let consulta: string | null;
  try {
    consulta = await montarConsulta();
  } catch (e) {
    // ViaCEP lançou: canal indisponível → transitório, sem propagar exceção.
    console.error("[geocodificarCepResolvido]", e);
    return { coords: null, motivo: "transitorio" };
  }
  // Sem endereço resolvido no servidor não há o que geocodificar. NUNCA cair no
  // CEP cru aqui — é exatamente a regressão que a issue 185 corrige.
  if (!consulta) return { coords: null, motivo: "transitorio" };

  const r = await consultarNominatim(ua, consulta, { restringirBrasil: true });
  if (r.coords == null) return r;

  // Defesa em profundidade (D1): par fora do Brasil é falha do dado do OSM, não
  // distância válida → nao_encontrado e NADA é gravado (sem cache negativo).
  if (!dentroDoBrasil(r.coords.latitude, r.coords.longitude)) {
    return { coords: null, motivo: "nao_encontrado" };
  }

  await gravarCacheCoordenadas(digitos, r.coords);
  return r;
}
