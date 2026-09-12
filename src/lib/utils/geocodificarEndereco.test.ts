import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Guarda de custo do Google Geocoding API (issue 190) + motivo discriminado
// (issue 004).
//
// MIGRAÇÃO (issue 190, fase RED): Nominatim → Google Geocoding API
// (plan/tecnico-geocoding-google.md). Este arquivo cobre
// `geocodificarEnderecoComMotivo` — a consulta textual LIVRE, usada pelo lado
// da LOJA (salvarPerfil/admin, issue #186 — entra no escopo por decisão 5 do
// plano: mesma função de provedor serve loja e cliente).
//
// Mudanças de contrato desta migração:
//   1. `consultarNominatim` vira `consultarGoogle` — REST puro contra
//      https://maps.googleapis.com/maps/api/geocode/json, sem SDK novo.
//   2. A trava ANTI-BAN de 1 req/s vira GUARDA DE CUSTO de duas camadas:
//      burst fixedWindow(10,"1s") + teto diário GLOBAL fixedWindow(N,"1d")
//      (N = GEOCODE_GOOGLE_DAILY_LIMIT, default 500), AMBAS fail-closed.
//   3. NOMINATIM_USER_AGENT vira GOOGLE_GEOCODING_API_KEY (a chave entra na
//      URL como query param `key=`, nunca em header nem em log).
//   4. Nenhum log (`console.error`) pode conter a chave, a consulta ou o par
//      (lat,lng) — só o `status` do corpo do Google.
//
// O caminho do CEP do cliente (cache + cascata) é coberto em
// ./geocodificarCepResolvido.test.ts.
//
// @upstash/ratelimit, @upstash/redis e `fetch` global são mockados — sem rede
// real, nunca a API do Google de verdade (pré-condição humana da issue 190).
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

const CHAVE_GOOGLE = "chave-google-fake-de-teste";

const ENDERECO_LOJA = "Rua das Flores, 100, São Paulo, SP";

function googleOk(lat: number, lng: number): Response {
  return new Response(
    JSON.stringify({
      status: "OK",
      results: [{ geometry: { location: { lat, lng } } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function googleStatus(status: string): Response {
  return new Response(JSON.stringify({ status, results: [] }), {
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
  // Estado feliz por padrão: credenciais Upstash + chave Google presentes.
  process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-fake";
  process.env.GOOGLE_GEOCODING_API_KEY = CHAVE_GOOGLE;
  delete process.env.GEOCODE_GOOGLE_DAILY_LIMIT;
  // Por padrão, as duas travas (burst e diária) concedem (success:true).
  limitMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

// ── 12: sem GOOGLE_GEOCODING_API_KEY → transitorio, fetch NUNCA chamado ─────
describe("geocodificarEnderecoComMotivo — fail-closed: chave Google ausente", () => {
  it("sem GOOGLE_GEOCODING_API_KEY → transitorio e fetch NUNCA chamado", async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GOOGLE_GEOCODING_API_KEY vazia/só-espaços → transitorio e fetch NUNCA chamado", async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = "   ";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 13: sem credenciais Upstash ──────────────────────────────────────────────
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

// ── 14/15: guarda de custo — burst e teto diário ─────────────────────────────
describe("geocodificarEnderecoComMotivo — guarda de custo: burst e teto diário", () => {
  it("14) burst nega (1ª chamada de limit) → transitorio, fetch NUNCA chamado", async () => {
    limitMock.mockResolvedValueOnce({ success: false }); // burst
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("15) burst ok, diário nega (2ª chamada de limit) → transitorio, fetch NUNCA chamado", async () => {
    limitMock
      .mockResolvedValueOnce({ success: true }) // burst
      .mockResolvedValueOnce({ success: false }); // diário
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it("limit() rejeita (Redis down) → transitorio, fetch NÃO chamado, console.error chamado", async () => {
    limitMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(erroSpy).toHaveBeenCalled();
  });
});

// ── 6/16: caminho de sucesso ──────────────────────────────────────────────────
describe("geocodificarEnderecoComMotivo — sucesso (Google)", () => {
  it("6) status:'OK' com results[0] válido → { coords } com lat/lng corretos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(-23.5, -46.6),
    );

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
  });

  it("a chave Google vai na URL (query param `key=`), nunca em header", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleOk(-23.5, -46.6));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
    expect(url).toContain(`key=${CHAVE_GOOGLE}`);
  });

  it("16) URL chamada NÃO contém components=country:BR (loja passa restringirBrasil:false)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleOk(-23.5, -46.6));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain(
      "components=country:BR",
    );
  });

  it("AbortSignal.timeout é passado ao fetch (timeout configurado)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleOk(-23.5, -46.6));

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeDefined();
  });
});

// ── 7/8/9/10/11: falhas de I/O e status do Google ────────────────────────────
describe("geocodificarEnderecoComMotivo — falhas de I/O e status do Google (nunca exceção)", () => {
  it("7) status:'ZERO_RESULTS' → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleStatus("ZERO_RESULTS"),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("8) status:'OVER_QUERY_LIMIT' → transitorio", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleStatus("OVER_QUERY_LIMIT"),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("9) status:'REQUEST_DENIED' → transitorio, e o log NUNCA contém a chave nem a consulta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleStatus("REQUEST_DENIED"),
    );
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    const logado = erroSpy.mock.calls
      .map((c) => c.map((a) => String(a)).join(" "))
      .join(" | ");
    expect(logado).not.toContain(CHAVE_GOOGLE);
    expect(logado).not.toContain(ENDERECO_LOJA);
  });

  it("10) HTTP 500 → transitorio sem lançar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("11) fetch rejeita (timeout simulado) → transitorio, sem propagar exceção", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("UNKNOWN_ERROR → transitorio", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleStatus("UNKNOWN_ERROR"),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("status:'OK' mas results vazio (defensivo) → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "OK", results: [] }), {
        status: 200,
      }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("lat/lng não-finitos em status OK → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{ geometry: { location: { lat: "abc", lng: "xyz" } } }],
        }),
        { status: 200 },
      ),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("status AUSENTE no corpo (sem campo `status`) → transitorio, nunca lança", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("status `null` (JSON malformado além do esperado) → transitorio, nunca lança", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: null, results: [] }), {
        status: 200,
      }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("corpo 200 OK que não é JSON válido → transitorio, sem propagar exceção de parse", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("isto não é JSON", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "transitorio" },
    );
  });

  it("status:'OK' com results[0] SEM `geometry` nenhuma → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "OK", results: [{}] }), {
        status: 200,
      }),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("status:'OK' com `geometry` SEM `location` → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "OK", results: [{ geometry: {} }] }),
        { status: 200 },
      ),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("lat presente e lng AUSENTE (chave inexistente, não só undefined) → nao_encontrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{ geometry: { location: { lat: -23.5 } } }],
        }),
        { status: 200 },
      ),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  // Bug real encontrado ao reforçar a cobertura da issue 190: `Number(null)`
  // e `Number(false)` são 0, que É finito — sem a guarda `typeof === "number"`
  // (geocodificarEndereco.ts, consultarGoogle), lat/lng `null`/`false` seriam
  // aceitos como a coordenada (0,0) (Golfo da Guiné) em vez de `nao_encontrado`.
  // Especialmente grave no caminho da LOJA: aqui NÃO há guard `dentroDoBrasil`
  // (só o caminho do CEP do cliente tem essa defesa em profundidade) — um
  // endereço de loja mal geocodificado viraria silenciosamente (0,0).
  it("lat/lng explicitamente `null` → nao_encontrado, NUNCA coords (0,0) (Number(null)===0 é finito)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{ geometry: { location: { lat: null, lng: null } } }],
        }),
        { status: 200 },
      ),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });

  it("lat/lng booleanos (`false`) → nao_encontrado, NUNCA coords (0,0) (Number(false)===0 é finito)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{ geometry: { location: { lat: false, lng: false } } }],
        }),
        { status: 200 },
      ),
    );

    await expect(geocodificarEnderecoComMotivo(ENDERECO_LOJA)).resolves.toEqual(
      { coords: null, motivo: "nao_encontrado" },
    );
  });
});

// ── 17: nenhum log carrega (lat,lng) ou a consulta ──────────────────────────
describe("geocodificarEnderecoComMotivo — 17) não-vazamento de coords/consulta/chave em log", () => {
  const cenarios: Array<[string, () => Promise<Response> | Response]> = [
    ["OVER_QUERY_LIMIT", () => googleStatus("OVER_QUERY_LIMIT")],
    ["REQUEST_DENIED", () => googleStatus("REQUEST_DENIED")],
    ["INVALID_REQUEST", () => googleStatus("INVALID_REQUEST")],
    ["UNKNOWN_ERROR", () => googleStatus("UNKNOWN_ERROR")],
  ];

  it.each(cenarios)("status %s → log não contém coords/consulta/chave", async (_status, resp) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(await resp());
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    const logado = erroSpy.mock.calls
      .map((c) => c.map((a) => String(a)).join(" "))
      .join(" | ");
    expect(logado).not.toContain(CHAVE_GOOGLE);
    expect(logado).not.toContain(ENDERECO_LOJA);
    expect(logado).not.toMatch(/-?\d{1,3}\.\d{4,}/); // padrão de lat/lng
  });
});

// ── Cache continua fora do caminho da loja (185/D3, inalterado pela 190) ────
describe("[190] geocodificarEnderecoComMotivo NÃO toca o cache de coordenadas", () => {
  it("endereço completo da loja → get e set NUNCA chamados", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(googleOk(-23.5, -46.6));

    const r = await geocodificarEnderecoComMotivo(ENDERECO_LOJA);

    expect(r).toEqual({ coords: { latitude: -23.5, longitude: -46.6 } });
    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
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
