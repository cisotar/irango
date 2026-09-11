import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// RED (issue 185, crítica — TDD red-first): `geocodificarCepResolvido`,
// `VERSAO_CACHE_GEOCODE` e `TTL_CACHE_GEOCODE_SEGUNDOS` ainda NÃO existem em
// src/lib/utils/geocodificarEndereco.ts. A fase GREEN (executar) os cria
// conforme as Decisões D1/D3/D4 do Plano Técnico da issue 185.
//
// Por que um ARQUIVO SEPARADO de geocodificarEndereco.test.ts: a nova função é
// um contrato novo do mesmo módulo. Importar um símbolo inexistente derruba o
// arquivo inteiro no carregamento — misturar aqui apagaria o sinal dos testes de
// portão anti-ban que seguem valendo para `geocodificarEnderecoComMotivo`.
// Depois do GREEN os dois arquivos convivem: este cobre o caminho do CEP do
// cliente (com cache), aquele cobre o caminho da loja (sem cache).
//
// CONTRATO SOB TESTE
//   geocodificarCepResolvido(cep: string, montarConsulta: () => Promise<string|null>)
//     : Promise<ResultadoGeocoding>
//
//   Ordem OBRIGATÓRIA dos portões (§Teto do plano; §12-A de seguranca.md):
//     UA → credenciais Upstash → GET cache → thunk (ViaCEP) → trava 1 req/s →
//     fetch Nominatim → guard dentroDoBrasil → SET cache
//
//   - a CHAVE do cache é o CEP (8 dígitos), NUNCA o texto da consulta (D3);
//   - o CEP NUNCA entra na consulta enviada ao Nominatim (D1 — causa raiz);
//   - thunk devolvendo null (ViaCEP falhou) ⇒ `transitorio` SEM fetch e SEM
//     consulta de consolo com o CEP cru;
//   - valor de cache sem `v === VERSAO_CACHE_GEOCODE` ⇒ MISS (D4/V3);
//   - gravação com `{ ex: TTL_CACHE_GEOCODE_SEGUNDOS }`;
//   - TETO: no máximo 1 chamada ao Nominatim por resolução; 0 em cache hit.
//
// @upstash/ratelimit, @upstash/redis e `fetch` global são mockados — sem rede.

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

import {
  geocodificarCepResolvido,
  VERSAO_CACHE_GEOCODE,
  TTL_CACHE_GEOCODE_SEGUNDOS,
} from "./geocodificarEndereco";

const ENV_BACKUP = { ...process.env };
const UA = "iRango/1.0 (+https://irango.app; contato@irango.app)";

// Caso reproduzido na issue 185.
const CEP = "12914-190";
const CHAVE = "irango:geocode:12914190";
// Consulta que o ViaCEP + montarConsultaCepCliente produzem (bairro fictício).
const CONSULTA = "Jardim Europa, Bragança Paulista - SP, Brasil";
// Par devolvido pelo Nominatim para essa consulta (evidência da issue).
const PAR = { latitude: -22.9520235, longitude: -46.5418586 };

function nominatimOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function nominatimComPar(): Response {
  return nominatimOk([{ lat: String(PAR.latitude), lon: String(PAR.longitude) }]);
}

/** Thunk memoizado de sucesso — devolve a consulta resolvida pelo ViaCEP. */
function thunkOk(consulta: string = CONSULTA) {
  return vi.fn(async () => consulta);
}

/** Thunk fail-closed — o ViaCEP falhou (rede/timeout/{erro:true}/sem cidade). */
function thunkNulo() {
  return vi.fn(async () => null);
}

/** Concatena todas as URLs passadas ao fetch, já decodificadas. */
function urlsChamadas(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .map((c) => decodeURIComponent(String(c[0])))
    .join(" | ");
}

beforeEach(() => {
  limitMock.mockReset();
  getMock.mockReset();
  setMock.mockReset();
  vi.restoreAllMocks();
  getMock.mockResolvedValue(null); // MISS por padrão
  setMock.mockResolvedValue("OK");
  process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-fake";
  process.env.NOMINATIM_USER_AGENT = UA;
  limitMock.mockResolvedValue({ success: true });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

// =============================================================================
// 1) O CASO REPRODUZIDO — a consulta deixa de ser o CEP cru
// =============================================================================
describe("[185-1] geocodificarCepResolvido — CEP 12914-190 (caso reproduzido)", () => {
  it("envia ao Nominatim o TEXTO resolvido, e NUNCA o CEP cru", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: PAR });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = urlsChamadas(fetchSpy);
    // A consulta contém a cidade/UF resolvidos pelo ViaCEP...
    expect(url).toContain("Bragança Paulista");
    expect(url).toContain("SP");
    // ...e NÃO contém o CEP em nenhuma forma (o token envenenador).
    expect(url).not.toContain("12914");
    expect(url).not.toContain("12914-190");
  });

  it("acrescenta countrycodes=br no caminho do CEP (defesa em profundidade D1)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkOk());

    expect(urlsChamadas(fetchSpy)).toContain("countrycodes=br");
  });

  it("envia o header User-Agent identificado (§12-A)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkOk());

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("User-Agent")).toBe(UA);
    expect(init?.signal).toBeDefined();
  });
});

// =============================================================================
// 2) ViaCEP falhou → FAIL-CLOSED, sem consulta de consolo com o CEP cru
//    (a regressão mais fácil de reintroduzir por acidente)
// =============================================================================
describe("[185-2] thunk null (ViaCEP falhou) → transitorio, sem fetch", () => {
  it("thunk devolve null → { coords:null, motivo:'transitorio' } e fetch NUNCA chamado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const thunk = thunkNulo();

    const r = await geocodificarCepResolvido(CEP, thunk);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(thunk).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("REGRESSÃO: nenhuma requisição contém o CEP como consulta de consolo", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkNulo());

    // Se alguém "salvar" o caminho caindo em geocodificar(cep), isto pega.
    expect(urlsChamadas(fetchSpy)).not.toContain("12914");
  });

  it("thunk null NÃO consome a trava de 1 req/s (nem chega ao portão 2)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkNulo());

    expect(limitMock).not.toHaveBeenCalled();
  });

  it("thunk null NÃO grava cache (sem cache negativo, RN-F10)", async () => {
    await geocodificarCepResolvido(CEP, thunkNulo());
    expect(setMock).not.toHaveBeenCalled();
  });

  it("thunk lança → transitorio, sem propagar exceção e sem fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP, async () => {
      throw new Error("ECONNREFUSED viacep");
    });

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3) Portões da política anti-ban — ordem de HOJE preservada (§12-A)
// =============================================================================
describe("[185-3] portões anti-ban na ordem original", () => {
  it("portão 0: sem NOMINATIM_USER_AGENT → transitorio, sem cache, sem ViaCEP, sem fetch", async () => {
    delete process.env.NOMINATIM_USER_AGENT;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido(CEP, thunk);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(getMock).not.toHaveBeenCalled();
    expect(thunk).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("portão 1: sem credenciais Upstash → transitorio, sem tocar Redis nem ViaCEP", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido(CEP, thunk);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(getMock).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
    expect(thunk).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("portão 3: trava nega (success:false) → transitorio, sem fetch e sem gravar", async () => {
    limitMock.mockResolvedValue({ success: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("trava lança (Redis down) → transitorio, sem fetch", async () => {
    limitMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("usa o identificador global fixo 'nominatim-global'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());
    await geocodificarCepResolvido(CEP, thunkOk());
    expect(limitMock).toHaveBeenCalledWith("nominatim-global");
  });

  it("Nominatim 200 com lista vazia → nao_encontrado e NADA gravado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimOk([]));

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("Nominatim 429 → transitorio (canal indisponível), nada gravado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("timeout/abort do Nominatim → transitorio", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("lat/lon não-finitos → nao_encontrado, nada gravado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "abc", lon: "xyz" }]),
    );

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("CEP malformado (≠ 8 dígitos) → transitorio, sem NENHUMA I/O externa", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido("123", thunk);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(getMock).not.toHaveBeenCalled();
    expect(thunk).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Guard do bounding box: "estrada na República Tcheca" vira fail-closed, não
  // distância astronômica (D1 — defesa em profundidade).
  it("par FORA do bounding box do Brasil → nao_encontrado e NÃO grava cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "49.8", lon: "15.5" }]), // República Tcheca
    );

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(setMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4) Cache versionado (D4/V3) — legado sem `v` é MISS e é sobrescrito
// =============================================================================
describe("[185-4] cache versionado + TTL", () => {
  it("constantes do contrato: v = 2 e TTL = 180 dias", async () => {
    expect(VERSAO_CACHE_GEOCODE).toBe(2);
    expect(TTL_CACHE_GEOCODE_SEGUNDOS).toBe(15_552_000);
  });

  it("HIT no formato novo → coords SEM ViaCEP, SEM trava e SEM Nominatim", async () => {
    getMock.mockResolvedValue({ ...PAR, v: VERSAO_CACHE_GEOCODE });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimOk([{ lat: "-99", lon: "-99" }]));
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido(CEP, thunk);

    expect(r).toEqual({ coords: PAR });
    expect(getMock).toHaveBeenCalledWith(CHAVE);
    // TETO: 0 chamadas externas em cache hit.
    expect(thunk).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("HIT como JSON-string versionada também é aceito", async () => {
    getMock.mockResolvedValue(JSON.stringify({ ...PAR, v: VERSAO_CACHE_GEOCODE }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: PAR });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("valor LEGADO sem `v` (cache envenenado) → MISS: refaz e sobrescreve", async () => {
    // O par legado é o ENVENENADO (estrada na Tcheca) gravado antes do fix.
    getMock.mockResolvedValue({ latitude: 49.8, longitude: 15.5 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido(CEP, thunk);

    // O valor legado NÃO foi devolvido: foi tratado como miss e refeito.
    expect(r).toEqual({ coords: PAR });
    expect(thunk).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
    const [chave, valor, opts] = setMock.mock.calls[0]!;
    expect(chave).toBe(CHAVE); // mesma chave: sobrescreve, sem órfãos
    const gravado = typeof valor === "string" ? JSON.parse(valor) : valor;
    expect(gravado).toEqual({ ...PAR, v: VERSAO_CACHE_GEOCODE });
    expect(opts).toMatchObject({ ex: TTL_CACHE_GEOCODE_SEGUNDOS });
  });

  it("valor v:2 (versão certa) mas lat/lng NÃO-FINITOS (cache corrompido) → MISS, refaz", async () => {
    // Corrupção não é só "sem v": pode ser a versão certa com payload quebrado
    // (ex.: escrita concorrente truncada, bug de serialização). O guard
    // Number.isFinite tem que pegar isso mesmo com v === VERSAO_CACHE_GEOCODE.
    getMock.mockResolvedValue({ latitude: Number.NaN, longitude: -46.5, v: VERSAO_CACHE_GEOCODE });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());
    const thunk = thunkOk();

    const r = await geocodificarCepResolvido(CEP, thunk);

    expect(r).toEqual({ coords: PAR });
    expect(thunk).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Sobrescreve a MESMA chave com o valor bom, sem exigir DEL manual.
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("valor v:2 com latitude AUSENTE (shape incompleto) → MISS, refaz", async () => {
    getMock.mockResolvedValue({ longitude: -46.5, v: VERSAO_CACHE_GEOCODE });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: PAR });
  });

  it("valor com versão ANTIGA (v:1) → MISS", async () => {
    getMock.mockResolvedValue({ latitude: 49.8, longitude: 15.5, v: 1 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: PAR });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("grava sempre com TTL (nenhuma chave nova sem prazo de validade)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkOk());

    const opts = setMock.mock.calls[0]![2];
    expect(opts).toBeDefined();
    expect(opts).toMatchObject({ ex: TTL_CACHE_GEOCODE_SEGUNDOS });
  });

  it("get lança (Redis down) → fail-OPEN na leitura: segue thunk+trava+fetch", async () => {
    getMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(nominatimComPar());

    const r = await geocodificarCepResolvido(CEP, thunkOk());

    expect(r).toEqual({ coords: PAR });
    expect(limitMock).toHaveBeenCalledWith("nominatim-global");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("get devolve lixo não-parseável → MISS, segue o fluxo", async () => {
    getMock.mockResolvedValue("}{ não é json");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());

    await expect(geocodificarCepResolvido(CEP, thunkOk())).resolves.toEqual({
      coords: PAR,
    });
  });

  it("set lança → coords ainda retornadas (fail-open de escrita)", async () => {
    setMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());

    await expect(geocodificarCepResolvido(CEP, thunkOk())).resolves.toEqual({
      coords: PAR,
    });
  });

  it("CEP com e sem máscara resolvem a MESMA chave", async () => {
    getMock.mockResolvedValue({ ...PAR, v: VERSAO_CACHE_GEOCODE });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(nominatimComPar());

    await geocodificarCepResolvido("12914-190", thunkOk());
    await geocodificarCepResolvido("12914190", thunkOk());

    expect(getMock).toHaveBeenNthCalledWith(1, CHAVE);
    expect(getMock).toHaveBeenNthCalledWith(2, CHAVE);
  });
});

// =============================================================================
// 5) Chave de cache DESACOPLADA do texto da consulta (D3)
//    Trocar ingenuamente o argumento (cacheabilidade decidida pelo FORMATO da
//    consulta) desligaria o cache em silêncio → toda resolução disputaria a
//    trava de 1 req/s → frete indisponível sob concorrência.
// =============================================================================
describe("[185-5] cache indexado pelo CEP, não pelo texto da consulta", () => {
  it("mesmo CEP com TEXTO diferente entre chamadas → 1 só chamada ao Nominatim", async () => {
    // Redis de brinquedo: prova o comportamento real de hit/miss.
    const armazem = new Map<string, unknown>();
    getMock.mockImplementation(async (k: string) => armazem.get(k) ?? null);
    setMock.mockImplementation(async (k: string, v: unknown) => {
      armazem.set(k, v);
      return "OK";
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimComPar());

    // 1ª: ViaCEP devolveu o bairro → consulta com bairro.
    await geocodificarCepResolvido(CEP, thunkOk(CONSULTA));
    // 2ª: mesmo CEP, mas o texto mudou (ViaCEP sem bairro desta vez).
    const thunk2 = thunkOk("Bragança Paulista - SP, Brasil");
    const r2 = await geocodificarCepResolvido(CEP, thunk2);

    expect(r2).toEqual({ coords: PAR });
    // O texto mudou, mas a CHAVE é o CEP → hit: nem ViaCEP nem Nominatim de novo.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(thunk2).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("CEPs DIFERENTES não compartilham chave (uma chamada cada)", async () => {
    const armazem = new Map<string, unknown>();
    getMock.mockImplementation(async (k: string) => armazem.get(k) ?? null);
    setMock.mockImplementation(async (k: string, v: unknown) => {
      armazem.set(k, v);
      return "OK";
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimComPar());

    await geocodificarCepResolvido("12914-190", thunkOk());
    await geocodificarCepResolvido("13000-000", thunkOk("Campinas - SP, Brasil"));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// 6) TETO: ≤ 1 chamada ao Nominatim por resolução, em TODOS os ramos
// =============================================================================
describe("[185-6] teto de 1 chamada ao Nominatim por resolução", () => {
  it("miss → exatamente 1 fetch (sem cadeia de tentativas, sem retry)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkOk());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Nominatim 200 [] NÃO dispara uma segunda tentativa mais genérica", async () => {
    // Cadeia de tentativas foi REJEITADA (D1): a trava fixedWindow(1,'1 s')
    // negaria a segunda chamada, e um sleep no caminho quente é inaceitável.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(nominatimOk([]));

    await geocodificarCepResolvido(CEP, thunkOk());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledTimes(1);
  });

  it("cache hit → 0 chamadas ao Nominatim", async () => {
    getMock.mockResolvedValue({ ...PAR, v: VERSAO_CACHE_GEOCODE });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await geocodificarCepResolvido(CEP, thunkOk());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("o thunk (ViaCEP) é invocado no MÁXIMO 1 vez por resolução", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(nominatimComPar());
    const thunk = thunkOk();

    await geocodificarCepResolvido(CEP, thunk);

    expect(thunk).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 8) CONCORRÊNCIA — achado, não conserto (ver relatório do agente `testar`)
//    Duas resoluções SIMULTÂNEAS do MESMO CEP com cache miss nas duas: não
//    existe request-coalescing/single-flight neste módulo. Cada chamada faz
//    seu próprio GET (ambas veem miss, pois nenhuma delas gravou ainda) e
//    ambas disputam a MESMA janela da trava fixedWindow(1,"1s") do
//    @upstash/ratelimit. A trava real do Upstash é atômica entre processos,
//    então em produção o pior caso é: 1 das duas ganha e busca o Nominatim,
//    a OUTRA perde a janela e volta 'transitorio' (sem frete por raio_km
//    nesse pedido) — não um estouro de 2 chamadas ao Nominatim. Mas o teste
//    abaixo prova que ESTE MÓDULO, sozinho, não impede 2 fetches: se a trava
//    mockada permite `success:true` para as duas (o que pode acontecer de
//    verdade se caírem em janelas de 1s adjacentes, ou se o limitador falhar
//    aberto por race no próprio Upstash), o Nominatim leva 2 requisições para
//    o MESMO CEP na mesma resolução concorrente — sem dedup em memória.
// =============================================================================
describe("[185-8] concorrência — duas resoluções simultâneas do MESMO CEP", () => {
  it("ACHADO: sem single-flight — 2 chamadas concorrentes com cache miss disputam a trava mas NÃO são deduplicadas em memória; se ambas passam a trava, saem 2 fetches ao Nominatim para o mesmo CEP", async () => {
    // Cache real (Map) para as duas chamadas verem o mesmo estado de fato.
    const armazem = new Map<string, unknown>();
    getMock.mockImplementation(async (k: string) => armazem.get(k) ?? null);
    setMock.mockImplementation(async (k: string, v: unknown) => {
      armazem.set(k, v);
      return "OK";
    });
    // Cenário adversarial: a trava concede às DUAS (ex.: janelas adjacentes,
    // ou concorrência real do fixedWindow sob rajada — não é impossível).
    limitMock.mockResolvedValue({ success: true });
    // mockImplementation (não mockResolvedValue): cada chamada precisa de um
    // Response NOVO — o corpo de um Response só pode ser lido (.json()) uma
    // vez; reusar a mesma instância entre as duas chamadas concorrentes
    // quebraria a 2ª leitura por um motivo alheio à race sob teste.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => nominatimComPar());
    const thunkA = thunkOk();
    const thunkB = thunkOk();

    const [ra, rb] = await Promise.all([
      geocodificarCepResolvido(CEP, thunkA),
      geocodificarCepResolvido(CEP, thunkB),
    ]);

    expect(ra).toEqual({ coords: PAR });
    expect(rb).toEqual({ coords: PAR });
    // GAP REAL: nenhuma coalescência em memória — as duas resoluções
    // concorrentes do MESMO CEP, ambas em cache miss, geraram 2 idas ao
    // ViaCEP (via thunk) e 2 ao Nominatim. Um in-flight dedup (ex.: Map de
    // Promises pendentes por CEP) eliminaria isso; não existe hoje.
    expect(thunkA).toHaveBeenCalledTimes(1);
    expect(thunkB).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// 7) §19/§21 — o par (lat,lng) e o endereço do cliente nunca vão para o log
// =============================================================================
describe("[185-7] nenhum log carrega coordenada ou endereço do cliente", () => {
  it("caminho de erro não loga o par nem a consulta", async () => {
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nominatimComPar());

    await geocodificarCepResolvido(CEP, thunkOk());

    const logado = erroSpy.mock.calls
      .map((c) => c.map((a) => String(a)).join(" "))
      .join(" | ");
    expect(logado).not.toContain("22.95");
    expect(logado).not.toContain("46.54");
    expect(logado).not.toContain("Bragança");
    expect(logado).not.toContain("12914");
  });

  it("par fora do Brasil: o log (se houver) não carrega o par recusado", async () => {
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      nominatimOk([{ lat: "49.8", lon: "15.5" }]),
    );

    await geocodificarCepResolvido(CEP, thunkOk());

    const logado = erroSpy.mock.calls
      .map((c) => c.map((a) => String(a)).join(" "))
      .join(" | ");
    expect(logado).not.toContain("49.8");
    expect(logado).not.toContain("15.5");
  });
});
