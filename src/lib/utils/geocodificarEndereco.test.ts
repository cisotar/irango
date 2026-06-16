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
  class Redis {
    static fromEnv = vi.fn(() => new Redis());
  }
  return { Redis };
});

import { geocodificarEndereco } from "./geocodificarEndereco";

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
  vi.restoreAllMocks();
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
