import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Portões anti-ban do Nominatim (issue 003) + motivo discriminado (issue 004).
//
// MIGRAÇÃO (issue 185, fase RED): este arquivo cobre agora SÓ
// `geocodificarEnderecoComMotivo` — a consulta textual LIVRE, usada pelo lado da
// LOJA (salvarPerfil/admin). Duas mudanças de contrato do Plano Técnico da 185:
//
//   1. o wrapper `geocodificarEndereco` (Coordenadas | null) é REMOVIDO — sem
//      callers depois que distanciaFrete.ts passa a usar geocodificarCepResolvido;
//   2. `cepCacheavel` é REMOVIDO e `geocodificarEnderecoComMotivo` deixa de ler
//      e gravar cache (D3): a cacheabilidade deixa de ser decidida pelo FORMATO
//      da consulta e passa a ser explícita, em `geocodificarCepResolvido(cep, …)`.
//      Em runtime isso não muda nada para a loja (endereço completo nunca casou
//      os 8 dígitos), mas trava a regressão de o predicado voltar a existir.
//
// O caminho do CEP do cliente (com cache versionado + TTL) é coberto em
// ./geocodificarCepResolvido.test.ts.
//
// @upstash/ratelimit, @upstash/redis e `fetch` global são mockados — sem rede.
// ---------------------------------------------------------------------------

const limitMock = vi.fn();
const getMock = vi.fn();
const setMock = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    limit = limitMock;
    static fixedWindow = vi.fn(() => ({ __fixed: true }));
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    get = getMock;
    set = setMock;
    static fromEnv = vi.fn(() => new Redis());
  }
  return { Redis };
});

import { geocodificarEnderecoComMotivo } from "./geocodificarEndereco";

const ENV_BACKUP = { ...process.env };

const UA = "iRango/1.0 (+https://irango.app; contato@irango.app)";

const ENDERECO_LOJA = "Rua das Flores, 100, São Paulo, SP";

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
describe("geocodificarEnderecoComMotivo — fail-closed: User-Agent ausente", () => {
  it("sem NOMINATIM_USER_AGENT → transitorio e fetch NUNCA chamado", async () => {
    delete process.env.NOMINATIM_USER_AGENT;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NOMINATIM_USER_AGENT vazio/só-espaços → transitorio e fetch NUNCA chamado", async () => {
    process.env.NOMINATIM_USER_AGENT = "   ";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: credenciais Upstash ausentes ────────────────────────────────
// Oposto de rateLimit.ts (que retorna permitido:true). Sem Redis não há trava
// global → não pode chamar (D5 portão 1). Nem o Redis é tocado.
describe("geocodificarEnderecoComMotivo — fail-closed: credenciais Upstash ausentes", () => {
  it("sem UPSTASH_* → transitorio, fetch NÃO chamado, limit NÃO chamado", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: Redis indisponível (limit lança) ────────────────────────────
// D5 portão 2: a trava global não pôde ser verificada → não chama fetch.
describe("geocodificarEnderecoComMotivo — fail-closed: Redis caiu", () => {
  it("limit() rejeita (Redis down) → transitorio, fetch NÃO chamado, console.error chamado", async () => {
    limitMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(erroSpy).toHaveBeenCalled();
  });

  it("limit() lança síncrono (TypeError) → transitorio, sem propagar exceção", async () => {
    limitMock.mockImplementation(() => {
      throw new TypeError("payload inesperado");
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── FAIL-CLOSED: limite global excedido ──────────────────────────────────────
// D5 portão 3: success:false → transitorio imediato, sem fetch, sem latência.
describe("geocodificarEnderecoComMotivo — fail-closed: limite global excedido", () => {
  it("limit() success:false → transitorio e fetch NÃO chamado", async () => {
    limitMock.mockResolvedValue({ success: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Caminho de sucesso + User-Agent + identificador global ───────────────────
describe("geocodificarEnderecoComMotivo — sucesso", () => {
  it("200 com [{lat,lon}] → { coords } numéricas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
  });

  it("envia header User-Agent igual à env na requisição fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.5", lon: "-46.6" }]));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(UA);
  });

  it("usa o identificador global fixo 'nominatim-global' na trava", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(limitMock).toHaveBeenCalledWith("nominatim-global");
  });

  it("AbortSignal.timeout é passado ao fetch (timeout configurado)", async () => {
    // Prova que a implementação não usa fetch sem AbortSignal — sem isso, uma
    // chamada lenta ao Nominatim travaria a lambda indefinidamente.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.5", lon: "-46.6" }]));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeDefined();
  });
});

// ── Falhas de I/O: nunca lança ───────────────────────────────────────────────
describe("geocodificarEnderecoComMotivo — falhas de I/O (nunca exceção)", () => {
  it("HTTP não-ok (500) → transitorio sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual({
      coords: null,
      motivo: "transitorio",
    });
  });

  it("HTTP 429 (já limitado pelo OSM) → transitorio sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual({
      coords: null,
      motivo: "transitorio",
    });
  });

  it("timeout/abort do fetch → transitorio sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual({
      coords: null,
      motivo: "transitorio",
    });
  });

  it("JSON array vazio [] → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimOk([]));

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual({
      coords: null,
      motivo: "nao_encontrado",
    });
  });

  it("lat/lon não-numéricos (NaN) → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "abc", lon: "xyz" }]),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual({
      coords: null,
      motivo: "nao_encontrado",
    });
  });

  it("lat/lon string '0'/'0' → coordenadas válidas (Gulf of Guinea, não nulo)", async () => {
    // Number('0') = 0, Number.isFinite(0) = true. lat=0 lon=0 é um ponto real.
    // Esse caso garante que a verificação isFinite não rejeita zero por engano.
    // (O guard `dentroDoBrasil` vale SÓ para o caminho do CEP do cliente — a
    //  loja pode, em tese, ser geocodificada em qualquer lugar.)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "0", lon: "0" }]),
    );

    const r = await geocodificarEnderecoComMotivo("Gulf of Guinea");

    expect(r).toEqual({ coords: { latitude: 0, longitude: 0 } });
  });

  it("resposta JSON não é array (objeto) → nao_encontrado sem lançar", async () => {
    // Nominatim às vezes retorna { error: '...' } em vez de []. O código usa
    // Array.isArray() — se isso for removido por acidente, este caso falha.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk({ error: "Unable to geocode" }),
    );

    await expect(
      geocodificarEnderecoComMotivo("endereço inválido"),
    ).resolves.toEqual({ coords: null, motivo: "nao_encontrado" });
  });
});

// =============================================================================
// [185/D3] A consulta LIVRE não decide mais cacheabilidade — nem lê, nem grava.
// RED: hoje `cepCacheavel(consulta)` faz este caminho tocar o Redis sempre que a
// string tem exatamente 8 dígitos. Depois do GREEN, o cache é responsabilidade
// exclusiva de `geocodificarCepResolvido(cep, …)`, que recebe a chave explícita.
// =============================================================================
describe("[185] geocodificarEnderecoComMotivo NÃO toca o cache de coordenadas", () => {
  it("endereço completo da loja → get e set NUNCA chamados", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("consulta que POR ACASO tem 8 dígitos → segue sem cache (predicado removido)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    await geocodificarEnderecoComMotivo("12900-000");

    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("um valor cacheado NÃO é devolvido por esta função (cache não é lido aqui)", async () => {
    // Se o predicado por formato voltar, este par cacheado sequestraria o
    // resultado da consulta livre — exatamente o acoplamento que a D3 remove.
    getMock.mockResolvedValue({ latitude: -1, longitude: -1, v: 2 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "-23.5", lon: "-46.6" }]),
    );

    const r = await geocodificarEnderecoComMotivo("12900-000");

    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
  });

  it("o caminho da loja NÃO restringe por país (escopo da issue 186, não desta)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimOk([{ lat: "-23.5", lon: "-46.6" }]));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain("countrycodes");
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
