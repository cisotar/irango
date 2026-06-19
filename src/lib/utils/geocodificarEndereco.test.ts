import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// RED (issue 003, crítica — TDD red-first): este módulo ainda NÃO existe.
// A fase GREEN (executar) cria src/lib/utils/geocodificarEndereco.ts — util
// server-only que geocodifica via Nominatim com User-Agent identificado,
// AbortSignal.timeout e trava global FAIL-CLOSED de 1 req/s.
//
// Invariante central (oposta a rateLimit.ts, que é fail-OPEN): qualquer estado
// em que a trava global de 1 req/s NÃO pôde ser verificada e concedida ⇒ NÃO
// chamar o Nominatim ⇒ retornar null. Sem trava, N lambdas concorrentes da
// Vercel martelam o OSM em paralelo e o IP do iRango é banido (RN-5/RN-6).
//
// @upstash/ratelimit, @upstash/redis e `fetch` global são mockados — sem rede.
// ---------------------------------------------------------------------------

// `limit` controla o success de cada cenário; os testes redefinem por caso.
const limitMock = vi.fn();

// `get`/`set` de INSTÂNCIA do Redis — controlados por caso para os testes de
// cache (issue 001, crítica — camada CEP→coords). Hoje a implementação NÃO os
// usa; estes mocks ficam aqui para as asserções de cache (devem permanecer
// não-chamados até a fase GREEN existir). Por padrão get = miss (null).
const getMock = vi.fn();
const setMock = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  // Ratelimit é instanciado via `new Ratelimit({...})`; expomos um stub cuja
  // instância chama o limitMock controlado pelo teste. `fixedWindow` é
  // referenciado na construção do limitador, então precisa existir como estático.
  class Ratelimit {
    limit = limitMock;
    static fixedWindow = vi.fn(() => ({ __fixed: true }));
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  // A instância do Redis precisa expor get/set para a camada de cache CEP→coords
  // (issue 001). O singleton do módulo é criado via Redis.fromEnv(); todas as
  // instâncias delegam aos mesmos getMock/setMock controláveis pelo teste.
  class Redis {
    get = getMock;
    set = setMock;
    static fromEnv = vi.fn(() => new Redis());
  }
  return { Redis };
});

import {
  geocodificarEndereco,
  geocodificarEnderecoComMotivo,
} from "./geocodificarEndereco";

const ENV_BACKUP = { ...process.env };

const UA = "iRango/1.0 (+https://irango.app; contato@irango.app)";

function nominatimOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  limitMock.mockReset();
  getMock.mockReset();
  setMock.mockReset();
  vi.restoreAllMocks();
  // Por padrão o cache é MISS (chave inexistente) e a gravação resolve.
  getMock.mockResolvedValue(null);
  setMock.mockResolvedValue("OK");
  // Estado feliz por padrão: credenciais Upstash + User-Agent presentes.
  process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-fake";
  process.env.NOMINATIM_USER_AGENT = UA;
  // Por padrão, a trava global concede (success:true).
  limitMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

// ── FAIL-CLOSED: sem User-Agent ──────────────────────────────────────────────
// Nominatim bane requisições sem User-Agent identificado. Ausência da env =
// pré-condição da trava anti-ban falhou → não chama (D7).
describe("geocodificarEndereco — fail-closed: User-Agent ausente", () => {
  it("sem NOMINATIM_USER_AGENT → null e fetch NUNCA chamado", async () => {
    delete process.env.NOMINATIM_USER_AGENT;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NOMINATIM_USER_AGENT vazio/só-espaços → null e fetch NUNCA chamado", async () => {
    process.env.NOMINATIM_USER_AGENT = "   ";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: credenciais Upstash ausentes ────────────────────────────────
// Oposto de rateLimit.ts (que retorna permitido:true). Sem Redis não há trava
// global → não pode chamar (D5 portão 1). Nem o Redis é tocado.
describe("geocodificarEndereco — fail-closed: credenciais Upstash ausentes", () => {
  it("sem UPSTASH_* → null, fetch NÃO chamado, limit NÃO chamado", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: Redis indisponível (limit lança) ────────────────────────────
// D5 portão 2: a trava global não pôde ser verificada → null, NÃO chama fetch.
describe("geocodificarEndereco — fail-closed: Redis caiu", () => {
  it("limit() rejeita (Redis down) → null, fetch NÃO chamado, console.error chamado", async () => {
    limitMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(erroSpy).toHaveBeenCalled();
  });

  it("limit() lança síncrono (TypeError) → null, sem propagar exceção", async () => {
    limitMock.mockImplementation(() => {
      throw new TypeError("payload inesperado");
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: limite global excedido ──────────────────────────────────────
// D5 portão 3: success:false → null imediato, sem fetch, sem latência.
describe("geocodificarEndereco — fail-closed: limite global excedido", () => {
  it("limit() success:false → null e fetch NÃO chamado", async () => {
    limitMock.mockResolvedValue({ success: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Caminho de sucesso + User-Agent + identificador global ───────────────────
describe("geocodificarEndereco — sucesso", () => {
  it("200 com [{lat,lon}] → { latitude, longitude } numéricos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    const r = await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(r).toEqual({ latitude: -23.5, longitude: -46.6 });
    expect(typeof r?.latitude).toBe("number");
    expect(typeof r?.longitude).toBe("number");
  });

  it("envia header User-Agent igual à env na requisição fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.5", lon: "-46.6" }]));

    await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(UA);
  });

  it("usa o identificador global fixo 'nominatim-global' na trava", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    await geocodificarEndereco("01001-000, São Paulo, SP");

    expect(limitMock).toHaveBeenCalledWith("nominatim-global");
  });
});

// ── Falhas de I/O: nunca lança, sempre null ──────────────────────────────────
describe("geocodificarEndereco — falhas de I/O viram null (nunca exceção)", () => {
  it("HTTP não-ok (500) → null sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await expect(
      geocodificarEndereco("01001-000, São Paulo, SP"),
    ).resolves.toBeNull();
  });

  it("HTTP 429 (já limitado pelo OSM) → null sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );

    await expect(
      geocodificarEndereco("01001-000, São Paulo, SP"),
    ).resolves.toBeNull();
  });

  it("timeout/abort do fetch → null sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      geocodificarEndereco("01001-000, São Paulo, SP"),
    ).resolves.toBeNull();
  });

  it("JSON array vazio [] → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimOk([]));

    await expect(
      geocodificarEndereco("01001-000, São Paulo, SP"),
    ).resolves.toBeNull();
  });

  it("lat/lon não-numéricos (NaN) → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "abc", lon: "xyz" }]),
    );

    await expect(
      geocodificarEndereco("01001-000, São Paulo, SP"),
    ).resolves.toBeNull();
  });

  it("lat/lon string '0'/'0' → coordenadas numéricas válidas (Gulf of Guinea, não null)", async () => {
    // Number('0') = 0, Number.isFinite(0) = true. lat=0 lon=0 é um ponto real.
    // Esse caso garante que a verificação isFinite não rejeita zero por engano.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "0", lon: "0" }]),
    );

    const r = await geocodificarEndereco("Gulf of Guinea");

    expect(r).toEqual({ latitude: 0, longitude: 0 });
  });

  it("resposta JSON não é array (objeto) → null sem lançar", async () => {
    // Nominatim às vezes retorna { error: '...' } em vez de []. O código usa
    // Array.isArray() — se isso for removido por acidente, este caso falha.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk({ error: "Unable to geocode" }),
    );

    await expect(
      geocodificarEndereco("endereço inválido"),
    ).resolves.toBeNull();
  });

  it("AbortSignal.timeout é passado ao fetch (timeout configurado)", async () => {
    // Prova que a implementação não usa fetch sem AbortSignal — sem isso, uma
    // chamada lenta ao Nominatim travaria a lambda indefinidamente.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.5", lon: "-46.6" }]));

    await geocodificarEndereco("01001-000, São Paulo, SP");

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeDefined();
    // AbortSignal.timeout retorna um AbortSignal (typeof !== 'undefined')
    expect(typeof init?.signal).not.toBe("undefined");
  });
});

// =============================================================================
// CACHE CEP→coords no Redis (issue 001, crítica — TDD red-first)
// RN-F1..F10 de specs/fix-frete-raio-cache-geocoding.md.
//
// Estes casos descrevem comportamento que AINDA NÃO existe em
// geocodificarEndereco.ts (camada de cache acima da trava). Devem FALHAR até a
// fase GREEN inserir o cache. O CEP usado é "12900-000" → 8 dígitos "12900000"
// → chave "irango:geocode:12900000".
// =============================================================================

const CHAVE_CEP = "irango:geocode:12900000";

// ── RN-F3: cache HIT pula trava E fetch ──────────────────────────────────────
describe("cache CEP — RN-F3: hit retorna coords sem trava nem fetch", () => {
  it("get retorna par válido → coords sem chamar limit() nem fetch", async () => {
    // Cache quente: a chave do CEP já tem o par geocodificado.
    getMock.mockResolvedValue({ latitude: -23.1857, longitude: -45.8869 });
    // Stub determinístico do fetch: prova que o hit NÃO o chama (e impede que o
    // caminho sem-cache atinja a rede de verdade).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimOk([{ lat: "-99", lon: "-99" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    // hit NÃO disputa o token de 1 req/s nem bate no Nominatim (RN-F3).
    expect(limitMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lê a chave irango:geocode:<8 dígitos> derivada do CEP", async () => {
    getMock.mockResolvedValue({ latitude: -23.1857, longitude: -45.8869 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      nominatimOk([{ lat: "-99", lon: "-99" }]),
    );

    await geocodificarEndereco("12900-000");

    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
  });

  it("hit com valor JSON-string serializado também é aceito", async () => {
    // @upstash/redis pode devolver o valor como string (sem auto-deserialize).
    getMock.mockResolvedValue(
      JSON.stringify({ latitude: -23.1857, longitude: -45.8869 }),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimOk([{ lat: "-99", lon: "-99" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── RN-F2 / RN-F10: cache MISS → geocodifica → grava SET sem TTL ─────────────
describe("cache CEP — RN-F2: miss válido grava o par após sucesso", () => {
  it("miss + Nominatim ok → set(chave, par) chamado uma vez", async () => {
    getMock.mockResolvedValue(null); // miss explícito
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]),
    );

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("grava na chave irango:geocode:<8 dígitos> com o par {latitude,longitude}", async () => {
    getMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]),
    );

    await geocodificarEndereco("12900-000");

    expect(setMock).toHaveBeenCalledTimes(1);
    const [chave, valor] = setMock.mock.calls[0]!;
    expect(chave).toBe(CHAVE_CEP);
    // valor pode ser objeto ou JSON-string; ambos devem decodificar pro par.
    const par = typeof valor === "string" ? JSON.parse(valor) : valor;
    expect(par).toEqual({ latitude: -23.1857, longitude: -45.8869 });
  });

  it("set lança (Redis down na gravação) → coords retornadas normalmente (fail-open de escrita)", async () => {
    // Bug real: se o try/catch em gravarCacheCoordenadas for removido por acidente,
    // a exceção do set propaga e retorna null mesmo o Nominatim tendo respondido.
    getMock.mockResolvedValue(null);
    setMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]),
    );

    const r = await geocodificarEndereco("12900-000");

    // A falha de gravação NÃO anula o resultado já calculado.
    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
  });

  it("NÃO grava com TTL (SET simples, cache permanente — RN-F2)", async () => {
    getMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]),
    );

    await geocodificarEndereco("12900-000");

    expect(setMock).toHaveBeenCalledTimes(1);
    // Nenhum argumento de expiração ({ ex }/{ px }/{ ttl }) nem segundos extras.
    const opts = setMock.mock.calls[0]![2];
    if (opts && typeof opts === "object") {
      expect(opts).not.toHaveProperty("ex");
      expect(opts).not.toHaveProperty("px");
      expect(opts).not.toHaveProperty("exat");
      expect(opts).not.toHaveProperty("pxat");
    } else {
      // sem terceiro argumento = SET simples, ok.
      expect(opts).toBeUndefined();
    }
  });
});

// ── RN-F10: sem cache negativo ───────────────────────────────────────────────
describe("cache CEP — RN-F10: miss do Nominatim nunca grava cache negativo", () => {
  it("Nominatim retorna [] (vazio) → set NUNCA chamado", async () => {
    getMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimOk([]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toBeNull();
    // Confirma que estamos no caminho CEP-cacheável (cache consultado), mas
    // miss do Nominatim NÃO vira cache negativo.
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("Nominatim HTTP 500 → set NUNCA chamado", async () => {
    getMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await geocodificarEndereco("12900-000");

    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("Nominatim lat/lon não-numérico (NaN) → set NUNCA chamado", async () => {
    getMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "abc", lon: "xyz" }]),
    );

    await geocodificarEndereco("12900-000");

    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(setMock).not.toHaveBeenCalled();
  });
});

// ── RN-F6 / RN-F7: consulta NÃO-CEP não toca o cache ─────────────────────────
describe("cache CEP — RN-F6/F7: endereço completo não lê nem grava cache", () => {
  it("consulta de endereço completo da loja → get e set NUNCA chamados", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    // Endereço completo: normalizado por \D NÃO resulta em exatamente 8 dígitos.
    const r = await geocodificarEndereco("Rua das Flores, 100, São Paulo, SP");

    expect(r).toEqual({ latitude: -23.5, longitude: -46.6 });
    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("consulta com CEP embutido + endereço (mais de 8 dígitos) não cacheia", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    // "12900-000, Rua X, 100" → \D removido = "12900000100" (11 dígitos) ≠ 8.
    await geocodificarEndereco("12900-000, Rua X, 100");

    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});

// ── RN-F4: cache fail-open na leitura ────────────────────────────────────────
describe("cache CEP — RN-F4: leitura de cache falha → fail-open (segue trava+fetch)", () => {
  it("get lança (Redis down) → ignora cache, segue limit()+fetch, retorna coords", async () => {
    getMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    // O cache FOI consultado (prova que existe a camada) e, ao falhar, abriu.
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    // fail-open: o cache caiu mas a trava e o fetch correram normalmente.
    expect(limitMock).toHaveBeenCalledWith("nominatim-global");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("get retorna lixo não-parseável → tratado como miss, segue para fetch", async () => {
    getMock.mockResolvedValue("}{ não é json");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("get retorna shape inválido ({latitude:NaN}) → miss, segue para fetch", async () => {
    getMock.mockResolvedValue({ latitude: Number.NaN, longitude: 10 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("get retorna shape parcial sem longitude ({latitude:-23.5}) → miss, segue para fetch", async () => {
    // Testa destructuring de chave ausente: longitude = undefined →
    // Number.isFinite(undefined) = false → deve virar miss, não retornar {latitude, longitude:undefined}.
    getMock.mockResolvedValue({ latitude: -23.5 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("get retorna undefined (driver alternativo sem miss → null) → tratado como miss", async () => {
    // Alguns drivers Redis retornam undefined para chave ausente. A implementação
    // usa `bruto == null` (loose equality), que cobre undefined. Se alguém mudar
    // para === null, este teste falha antes de chegarmos à produção.
    getMock.mockResolvedValue(undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.1857", lon: "-45.8869" }]));

    const r = await geocodificarEndereco("12900-000");

    expect(r).toEqual({ latitude: -23.1857, longitude: -45.8869 });
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── RN-F5: trava fail-closed preservada mesmo com cache ──────────────────────
describe("cache CEP — RN-F5: miss + trava nega → null sem fetch (fail-closed)", () => {
  it("cache miss + limit success:false → null e fetch NUNCA chamado", async () => {
    getMock.mockResolvedValue(null); // miss → tem que passar pela trava
    limitMock.mockResolvedValue({ success: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEndereco("12900-000");

    expect(r).toBeNull();
    // O cache foi consultado (miss), mas a trava fail-closed barrou o fetch.
    expect(getMock).toHaveBeenCalledWith(CHAVE_CEP);
    expect(fetchSpy).not.toHaveBeenCalled();
    // E nada é gravado em cache num caminho que nem chegou ao Nominatim.
    expect(setMock).not.toHaveBeenCalled();
  });
});

// ── Normalização: hífen e sem hífen → mesma chave ────────────────────────────
describe("cache CEP — normalização: CEP com e sem hífen → mesma chave", () => {
  it('"01310-100" → chave irango:geocode:01310100', async () => {
    getMock.mockResolvedValue({ latitude: -23.5614, longitude: -46.6559 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      nominatimOk([{ lat: "-99", lon: "-99" }]),
    );

    await geocodificarEndereco("01310-100");

    expect(getMock).toHaveBeenCalledWith("irango:geocode:01310100");
  });

  it('"01310100" (sem hífen) → MESMA chave irango:geocode:01310100', async () => {
    getMock.mockResolvedValue({ latitude: -23.5614, longitude: -46.6559 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      nominatimOk([{ lat: "-99", lon: "-99" }]),
    );

    await geocodificarEndereco("01310100");

    expect(getMock).toHaveBeenCalledWith("irango:geocode:01310100");
  });
});

// =============================================================================
// geocodificarEnderecoComMotivo (issue 004) — distingue transitório de
// não-encontrado SEM afrouxar a trava anti-ban. RED até a fase GREEN existir.
//   - lista vazia / coords não-finitas (Nominatim 200 sem resultado) → nao_encontrado
//   - trava excedida / timeout / 5xx / sem credenciais/UA → transitorio
//   - sucesso → { coords }
// =============================================================================
describe("geocodificarEnderecoComMotivo (issue 004)", () => {
  it("sucesso → { coords } com par finito", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );
    const r = await geocodificarEnderecoComMotivo("Rua X, 100, São Paulo, SP");
    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
  });

  it("Nominatim 200 lista vazia → { coords:null, motivo:'nao_encontrado' }", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimOk([]));
    const r = await geocodificarEnderecoComMotivo("endereço inexistente");
    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
  });

  it("lat/lon não-finitos (200) → { coords:null, motivo:'nao_encontrado' }", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "abc", lon: "xyz" }]),
    );
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
  });

  it("trava excedida (limit success:false) → { coords:null, motivo:'transitorio' }", async () => {
    limitMock.mockResolvedValue({ success: false });
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("HTTP 500 → { coords:null, motivo:'transitorio' }", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("timeout/abort → { coords:null, motivo:'transitorio' }", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("sem credenciais Upstash → { coords:null, motivo:'transitorio' } sem fetch", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sem User-Agent → { coords:null, motivo:'transitorio' } sem fetch", async () => {
    delete process.env.NOMINATIM_USER_AGENT;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await geocodificarEnderecoComMotivo("Rua X, São Paulo, SP");
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Não-vazamento de credenciais ao cliente (seguranca.md §7) ────────────────
describe("geocodificarEndereco — não-vazamento de secrets ao cliente", () => {
  it("o código-fonte do módulo não referencia NEXT_PUBLIC_", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("./geocodificarEndereco.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/NEXT_PUBLIC_/);
  });
});
