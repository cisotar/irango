import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// RED (issue 190, crítica — TDD red-first): a ASSINATURA de
// `geocodificarCepResolvido` MUDA (recebe `resolverEndereco: () =>
// Promise<EnderecoCepResolvido | null>`, não mais um thunk de string), a
// cascata de consultas passa a viver DENTRO desta função, `VERSAO_CACHE_GEOCODE`
// sobe de 2 para 3 e `TTL_CACHE_GEOCODE_SEGUNDOS` cai de 180 para 25 dias.
// Nada disso existe ainda em src/lib/utils/geocodificarEndereco.ts — a fase
// GREEN (executar) implementa conforme plan/tecnico-geocoding-google.md.
//
// CONTRATO SOB TESTE
//   geocodificarCepResolvido(
//     cep: string,
//     resolverEndereco: () => Promise<EnderecoCepResolvido | null>,
//   ): Promise<ResultadoGeocoding>
//
//   Ordem OBRIGATÓRIA dos portões:
//     chave Google → credenciais Upstash → GET cache → resolverEndereco
//     (ViaCEP) → montarConsultasCepCliente (cascata) → para cada candidato:
//       burst 10/s → teto diário N/dia → fetch Google → ZERO_RESULTS? próximo
//       candidato : outro status/erro? retorna transitorio IMEDIATO (não
//       cascateia em falha de canal) : OK? dentroDoBrasil → SET cache com
//       v:3 e ex:2_160_000 → retorna.
//
//   - a CHAVE do cache é o CEP (8 dígitos), NUNCA o texto da consulta;
//   - valor de cache sem `v === 3` (incluindo o v:2 antigo) ⇒ MISS;
//   - a cascata SÓ avança em ZERO_RESULTS; falha transitória interrompe;
//   - teto diário excedido ⇒ esgotado (180-B), fetch NUNCA chamado (fail-closed).
//
// Critério de sucesso da issue 190: os CEPs 12914-190 (Jardim Sevilha) e
// 12900-430 (Centro), mesma cidade (Bragança Paulista/SP), geocodificam para
// coordenadas DIFERENTES porque suas consultas mais específicas (com
// logradouro/bairro) são diferentes.
//
// @upstash/ratelimit, @upstash/redis e `fetch` global são mockados — sem rede
// real, nunca a API do Google de verdade.

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
import type { EnderecoCepResolvido } from "./resolverCepServidor";

const ENV_BACKUP = { ...process.env };
const CHAVE_GOOGLE = "chave-google-fake-de-teste";
// IP de teste genérico (RFC 5737 TEST-NET-2 — reservado para documentação,
// nunca roteável de verdade). Usado em todas as chamadas que não testam o
// teto por IP em si — só o 3º parâmetro OBRIGATÓRIO da nova assinatura
// (achado MÉDIO do `auditar`, issue 190: teto por IP secundário).
const IP_CLIENTE = "198.51.100.20";

// ── Os dois CEPs do critério de sucesso da issue 190 ────────────────────────
const CEP_A = "12914-190";
const CHAVE_A = "irango:geocode:12914190";
const ENDERECO_A: EnderecoCepResolvido = {
  logradouro: "Rua Antônio Carlos Ribeiro",
  bairro: "Jardim Sevilha",
  cidade: "Bragança Paulista",
  uf: "SP",
};
const COORDS_A = { latitude: -22.961, longitude: -46.5422 }; // ~1km da loja

const CEP_B = "12900-430";
const CHAVE_B = "irango:geocode:12900430";
const ENDERECO_B: EnderecoCepResolvido = {
  logradouro: "Rua Coronel Luiz Antônio",
  bairro: "Centro",
  cidade: "Bragança Paulista",
  uf: "SP",
};
const COORDS_B = { latitude: -22.9525, longitude: -46.5427 }; // <1km, mas diferente de A

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

// [180-B/achado 1] O THUNK mudou de contrato: devolve `ResolucaoCep`
// (`{ endereco }` | `{ endereco: null, motivo }`) em vez de
// `EnderecoCepResolvido | null`. Sem isso, "o CEP não existe" (fato sobre o
// input do CLIENTE) e "o ViaCEP caiu" (falha do CANAL) chegam aqui
// indistinguíveis — e o primeiro acaba virando frete a combinar, isto é,
// frete ZERO, a pedido do comprador.

/** Thunk memoizado de sucesso — devolve o endereço resolvido pelo ViaCEP. */
function resolverOk(e: EnderecoCepResolvido = ENDERECO_A) {
  return vi.fn(async () => ({ endereco: e }));
}

/** Thunk fail-closed de CANAL — o ViaCEP caiu (rede/timeout/HTTP não-ok). */
function resolverNulo() {
  return vi.fn(async () => ({ endereco: null, motivo: "transitorio" as const }));
}

/** Thunk fail-closed de DADO — o ViaCEP afirmou que o CEP não existe. */
function resolverCepInexistente() {
  return vi.fn(async () => ({
    endereco: null,
    motivo: "nao_encontrado" as const,
  }));
}

/** Concatena todas as URLs passadas ao fetch, já decodificadas. */
function urlsChamadas(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => decodeURIComponent(String(c[0])));
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
  process.env.GOOGLE_GEOCODING_API_KEY = CHAVE_GOOGLE;
  delete process.env.GEOCODE_GOOGLE_DAILY_LIMIT;
  limitMock.mockResolvedValue({ success: true }); // burst e diário concedem
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

// =============================================================================
// 18) O CRITÉRIO DE SUCESSO DA ISSUE 190
// =============================================================================
describe("[190-18] critério de sucesso: 12914-190 ≠ 12900-430 (mesma cidade)", () => {
  it("os dois CEPs geram consultas DIFERENTES e coordenadas DIFERENTES", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("Jardim Sevilha")) return googleOk(COORDS_A.latitude, COORDS_A.longitude);
        if (url.includes("Centro")) return googleOk(COORDS_B.latitude, COORDS_B.longitude);
        throw new Error("URL inesperada: " + url);
      });

    const resultadoA = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);
    const resultadoB = await geocodificarCepResolvido(CEP_B, resolverOk(ENDERECO_B), IP_CLIENTE);

    expect(resultadoA).toEqual({ coords: COORDS_A });
    expect(resultadoB).toEqual({ coords: COORDS_B });
    expect(resultadoA).not.toEqual(resultadoB);

    const urls = urlsChamadas(fetchSpy);
    expect(urls.some((u) => u.includes("Jardim Sevilha"))).toBe(true);
    expect(urls.some((u) => u.includes("Centro"))).toBe(true);
  });
});

// =============================================================================
// 19) Cache hit → nem ViaCEP nem fetch são chamados
// =============================================================================
describe("[190-19] cache hit (v:3) → zero I/O externo", () => {
  it("HIT no formato v:3 → coords SEM resolverEndereco, SEM trava e SEM Google", async () => {
    getMock.mockResolvedValue({ ...COORDS_A, v: VERSAO_CACHE_GEOCODE });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(getMock).toHaveBeenCalledWith(CHAVE_A);
    expect(resolver).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 20) Cache com v:2 (formato antigo) → MISS, refaz
// =============================================================================
describe("[190-20] versão antiga do cache (v:2 ou sem v) → MISS", () => {
  it("valor com v:2 (centroide antigo) → tratado como MISS, refaz a resolução", async () => {
    getMock.mockResolvedValue({ latitude: -22.9610457, longitude: -46.5422615, v: 2 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("valor SEM `v` nenhum → MISS, refaz", async () => {
    getMock.mockResolvedValue({ latitude: -22.9610457, longitude: -46.5422615 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
  });
});

// =============================================================================
// [187/achado 2] guard dentroDoBrasil também na LEITURA do cache
// =============================================================================
describe("[187] valor de cache na versão corrente mas FORA do Brasil → MISS", () => {
  it("par na República Tcheca com v:3 é descartado e a resolução é refeita", async () => {
    // Praga (50.1, 14.4) — o par que a evidência da 185 mostrou o geocoder
    // devolvendo para um CEP brasileiro. Hoje nenhum caminho de escrita grava
    // isso (o guard roda antes do SET), mas escrita manual, backfill ou reuso da
    // VERSAO_CACHE_GEOCODE por outro módulo colocariam o par aqui — e ele viraria
    // distância válida, logo frete errado por raio.
    getMock.mockResolvedValue({ latitude: 50.1, longitude: 14.4, v: VERSAO_CACHE_GEOCODE });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    // MISS de verdade: refaz TODO o caminho (ViaCEP + Google), não devolve o
    // par envenenado, e sobrescreve a MESMA chave com o par válido.
    expect(r).toEqual({ coords: COORDS_A });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalled();
  });

  it("par válido no Brasil com v:3 segue HIT (o guard não derruba o caso bom)", async () => {
    getMock.mockResolvedValue({ ...COORDS_A, v: VERSAO_CACHE_GEOCODE });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 21/22) Cascata: só avança em ZERO_RESULTS
// =============================================================================
describe("[190-21/22] cascata de consultas — avança só em ZERO_RESULTS", () => {
  it("21) 1ª consulta (logradouro+bairro+cidade-UF) ZERO_RESULTS, 2ª (bairro+cidade-UF) OK → 2 fetches", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("22) logradouro E bairro dão ZERO_RESULTS → cai na 3ª (só cidade-UF) → 3 fetches", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"))
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("todos os candidatos exauridos em ZERO_RESULTS → nao_encontrado", async () => {
    // mockResolvedValueOnce x3 (não mockResolvedValue): cada fetch real devolve
    // uma Response NOVA; reusar a mesma instância faria a 2ª/3ª leitura de
    // .json() lançar "Body has already been read" nesse ambiente de teste.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"))
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"))
      .mockResolvedValueOnce(googleStatus("ZERO_RESULTS"));

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("23) 1ª consulta retorna transitorio (OVER_QUERY_LIMIT) → retorna IMEDIATO, exatamente 1 fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(googleStatus("OVER_QUERY_LIMIT"))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude)); // não deveria ser chamada

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("1ª consulta dá timeout (fetch rejeita) → transitorio IMEDIATO, sem tentar a 2ª", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 24) dentroDoBrasil continua sendo aplicado como guard
// =============================================================================
describe("[190-24] guard dentroDoBrasil aplicado ao resultado do Google", () => {
  it("par fora do Brasil → nao_encontrado, set NÃO é chamado (sem cache negativo)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(49.8, 15.5), // República Tcheca
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(setMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 25/26) TTL e versão gravados
// =============================================================================
describe("[190-25/26] cache gravado com TTL de 25 dias e v:3", () => {
  it("25) set é chamado com ex igual a 2_160_000 (TTL de 25 dias)", async () => {
    expect(TTL_CACHE_GEOCODE_SEGUNDOS).toBe(2_160_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(setMock).toHaveBeenCalledTimes(1);
    const opts = setMock.mock.calls[0]![2];
    expect(opts).toMatchObject({ ex: 2_160_000 });
  });

  it("26) valor gravado no set tem v: 3", async () => {
    expect(VERSAO_CACHE_GEOCODE).toBe(3);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const [chave, valor] = setMock.mock.calls[0]!;
    expect(chave).toBe(CHAVE_A);
    const gravado = typeof valor === "string" ? JSON.parse(valor) : valor;
    expect(gravado).toEqual({ ...COORDS_A, v: 3 });
  });
});

// =============================================================================
// 27) CEP malformado → nao_encontrado (180-B), zero I/O
// =============================================================================
describe("[190-27] CEP malformado → nao_encontrado, zero I/O", () => {
  it("CEP com menos de 8 dígitos → nao_encontrado, sem cache, sem resolverEndereco, sem fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido("123", resolver, IP_CLIENTE);

    // [180-B] era `transitorio`; virou `nao_encontrado`: o problema é o DADO,
    // e retentar um CEP inválido nunca resolve — a UI pede conferir o número.
    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(getMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 28) resolverEndereco() retorna null → transitorio, zero chamadas ao Google
// =============================================================================
describe("[190-28] resolverEndereco null (ViaCEP fora do ar) → transitorio", () => {
  it("resolverEndereco() → null ⇒ transitorio, fetch NUNCA chamado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverNulo();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolverEndereco() lança → transitorio, sem propagar exceção, sem fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(
      CEP_A,
      async () => {
        throw new Error("ECONNREFUSED viacep");
      },
      IP_CLIENTE,
    );

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// ACHADO 1 (ALTA) — CEP inexistente não pode virar frete grátis
//
// `resolverEndereco` devolvendo `{ endereco: null, motivo: "nao_encontrado" }`
// é o ViaCEP AFIRMANDO que o CEP digitado não existe. Isso é um fato sobre o
// input do CLIENTE, não uma falha do canal, e precisa de um motivo próprio que
// NÃO seja classificado como a_combinar lá em `classificarFrete`.
//
// Nome do motivo novo: `cep_inexistente`. NÃO reaproveitamos `nao_encontrado`
// do `MotivoGeocoding` porque esse literal já significa ZERO_RESULTS da Google
// (endereço REAL que o geocoder não indexa) — que continua sendo a_combinar
// legítimo e não pode regredir. Ver o relatório do `tdd` (divergência 1).
// =============================================================================
describe("[achado 1] ViaCEP afirma que o CEP não existe → 'cep_inexistente', não 'transitorio'", () => {
  it("resolverEndereco → { endereco:null, motivo:'nao_encontrado' } ⇒ cep_inexistente, fetch NUNCA chamado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverCepInexistente();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "cep_inexistente" });
    expect(resolver).toHaveBeenCalledTimes(1);
    // Nada a geocodificar: nenhuma chamada paga ao Google (fail-closed intacto).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NÃO grava cache negativo para CEP inexistente (RN-F10 preservada)", async () => {
    vi.spyOn(globalThis, "fetch");

    await geocodificarCepResolvido(CEP_A, resolverCepInexistente(), IP_CLIENTE);

    expect(setMock).not.toHaveBeenCalled();
  });

  // Não-regressão do a_combinar LEGÍTIMO: o ViaCEP resolveu o endereço (ele
  // existe) e foi a GOOGLE que não o indexou. Aqui o cliente não tem culpa
  // nenhuma e o frete continua "a combinar".
  it("ZERO_RESULTS da Google para um CEP que o ViaCEP RESOLVEU segue 'nao_encontrado' (a_combinar legítimo)", async () => {
    // `mockImplementation`, NÃO `mockResolvedValue`: a cascata faz vários
    // fetches e um único `Response` tem o body consumido no primeiro `.json()`
    // — reusá-lo faria o 2º candidato lançar e o resultado virar `transitorio`,
    // mascarando o que este teste afirma.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      googleStatus("ZERO_RESULTS"),
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
  });
});

// =============================================================================
// 29) Teto diário excedido → fail-closed, zero fetch
// =============================================================================
describe("[190-29] teto diário GLOBAL excedido → esgotado, fail-closed", () => {
  it("limitador diário nega (success:false) → esgotado, ZERO fetch, mesmo com cache miss e ViaCEP disponível", async () => {
    // 1ª chamada de limit() é o burst (concede), a 2ª é o teto diário (nega).
    limitMock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    // [180-B] era `transitorio`; virou `esgotado`: a trava que negou não se
    // move no curto prazo, e a UI usa o motivo para decidir se retenta.
    expect(r).toEqual({ coords: null, motivo: "esgotado" });
    expect(fetchSpy).not.toHaveBeenCalled();
    // ViaCEP FOI consultado (o teto é verificado só depois de montar a
    // cascata) — mas nenhuma chamada paga ao Google aconteceu.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("respeita GEOCODE_GOOGLE_DAILY_LIMIT customizado via env (default 500)", async () => {
    process.env.GEOCODE_GOOGLE_DAILY_LIMIT = "10";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
  });
});

// =============================================================================
// Burst 10/s ainda funciona (guarda de custo, não mais anti-ban)
// =============================================================================
describe("guarda de custo — burst 10/s", () => {
  // INVERTIDO (achado 2): antes este teste travava `transitorio`. `transitorio`
  // classifica como a_combinar → taxa_entrega NULL. Ou seja: o NOSSO PRÓPRIO
  // throttle zerava o frete de toda loja com zona raio_km. Throttle interno não
  // é outage do canal externo; é um estado que NÓS criamos e sobre o qual o
  // comprador não tem nenhuma culpa nem controle. Precisa de motivo próprio,
  // fora do conjunto que vira a_combinar.
  it("[achado 2] burst nega (1ª chamada de limit) → 'throttle_interno' (NÃO 'transitorio'), fetch NUNCA chamado", async () => {
    limitMock.mockResolvedValueOnce({ success: false }); // burst nega
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "throttle_interno" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// ACHADO 2 (ALTA) — o balde de burst é GLOBAL, de chave fixa
//
// `obterLimitadorBurst().limit("geocode-burst")` usa um identificador
// CONSTANTE: fixedWindow(10, "1 s") para a PLATAFORMA INTEIRA. O rate limit da
// action é 20/min em sliding window, então um único IP cabe 20 chamadas dentro
// do mesmo segundo — 2 ou 3 IPs mantêm a janela saturada indefinidamente e
// TODA loja com zona raio_km para de cobrar frete enquanto durar.
//
// Contrato novo: o balde é POR IP (`limit(\`burst:${ip}\`)`), do mesmo jeito
// que o teto diário por IP já faz (`.limit(opcoes.ip)`).
// =============================================================================
describe("[achado 2] burst é balde POR IP, não um balde global de chave fixa", () => {
  const IP_ABUSIVO = "198.51.100.77";
  const IP_LEGITIMO = "198.51.100.88";

  it("o identificador do burst CONTÉM o IP do chamador (não é constante)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_ABUSIVO);

    // 1ª chamada de limit() é o burst.
    const identificadorBurst = String(limitMock.mock.calls[0]?.[0]);
    expect(identificadorBurst).toContain(IP_ABUSIVO);
    expect(identificadorBurst).not.toBe("geocode-burst");
  });

  it("dois IPs distintos usam identificadores de burst DIFERENTES", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_ABUSIVO);
    const burstA = String(limitMock.mock.calls[0]?.[0]);
    limitMock.mockClear();
    await geocodificarCepResolvido(CEP_B, resolverOk(ENDERECO_B), IP_LEGITIMO);
    const burstB = String(limitMock.mock.calls[0]?.[0]);

    expect(burstA).not.toBe(burstB);
  });

  // O TESTE CENTRAL DO ACHADO 2: isolamento real entre baldes.
  it("IP abusivo estoura o próprio burst e NÃO derruba o frete de um IP legítimo", async () => {
    // Só os identificadores que carregam o IP abusivo são negados. Se o balde
    // for global (chave fixa "geocode-burst"), nenhuma negação acontece para o
    // abusivo — e o teste falha exatamente aí, denunciando a chave constante.
    limitMock.mockImplementation(async (identificador: string) => ({
      success: !String(identificador).includes(IP_ABUSIVO),
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const abusivo = await geocodificarCepResolvido(
      CEP_A,
      resolverOk(ENDERECO_A),
      IP_ABUSIVO,
    );
    const legitimo = await geocodificarCepResolvido(
      CEP_B,
      resolverOk(ENDERECO_B),
      IP_LEGITIMO,
    );

    expect(abusivo).toEqual({ coords: null, motivo: "throttle_interno" });
    // O cliente legítimo continua com frete calculado NORMALMENTE.
    expect(legitimo).toEqual({ coords: COORDS_A });
  });
});

// =============================================================================
// Portões 0/1 (chave Google / credenciais Upstash) preservados
// =============================================================================
describe("[190] portões de pré-condição preservados", () => {
  it("sem GOOGLE_GEOCODING_API_KEY → esgotado, sem cache, sem resolverEndereco, sem fetch", async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    // INVERTIDO (achado 3): antes travava `esgotado`, que classifica como
    // a_combinar. Consequência: perder UMA env var fazia TODO pedido de entrega
    // de TODA loja nascer sem frete, sem erro na UI e sem alarme nenhum.
    // "Não estamos configurados" não é "o orçamento acabou": é defeito NOSSO,
    // não pode virar desconto para o cliente e precisa ser barulhento.
    expect(r).toEqual({ coords: null, motivo: "indisponivel_config" });
    expect(getMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[achado 3] sem GOOGLE_GEOCODING_API_KEY → console.error (config quebrada é BARULHENTA)", async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await geocodificarCepResolvido(CEP_A, resolverOk(), IP_CLIENTE);

    // Silêncio é o que torna o achado 3 caro: a loja só descobre no fim do mês.
    expect(erroSpy).toHaveBeenCalled();
  });

  it("sem credenciais Upstash → indisponivel_config, sem tocar Redis nem ViaCEP", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido(CEP_A, resolver, IP_CLIENTE);

    // INVERTIDO (achado 3), mesma justificativa da chave da Google. Agravante
    // registrado na auditoria: `rateLimit.ts` é fail-OPEN com as MESMAS
    // credenciais Upstash — perder a env var desliga o rate limit E zera o
    // frete ao mesmo tempo.
    expect(r).toEqual({ coords: null, motivo: "indisponivel_config" });
    expect(getMock).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Chave de cache é o CEP, não o texto da consulta (inalterado da 185)
// =============================================================================
describe("[190] cache indexado pelo CEP, não pelo texto da consulta", () => {
  it("CEPs DIFERENTES não compartilham chave (uma resolução cada)", async () => {
    const armazem = new Map<string, unknown>();
    getMock.mockImplementation(async (k: string) => armazem.get(k) ?? null);
    setMock.mockImplementation(async (k: string, v: unknown) => {
      armazem.set(k, v);
      return "OK";
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("Jardim Sevilha")) return googleOk(COORDS_A.latitude, COORDS_A.longitude);
      if (url.includes("Centro")) return googleOk(COORDS_B.latitude, COORDS_B.longitude);
      throw new Error("URL inesperada");
    });

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);
    await geocodificarCepResolvido(CEP_B, resolverOk(ENDERECO_B), IP_CLIENTE);

    expect(armazem.has(CHAVE_A)).toBe(true);
    expect(armazem.has(CHAVE_B)).toBe(true);
  });
});

// =============================================================================
// Concorrência: duas resoluções simultâneas do MESMO CEP não-cacheado
// (issue 188, fora de escopo desta troca — aqui só CONFIRMAMOS que o
// comportamento atual, sem request-coalescing, não piorou com o novo
// provedor: cada chamada concorrente ainda faz sua própria ida ao ViaCEP e
// ao Google, gastando 2x em vez de 1x. Isso é o débito conhecido da 188,
// mais caro agora que o provedor é pago — mas não é resolvido aqui.)
// =============================================================================
describe("[190] concorrência — duas chamadas simultâneas do MESMO CEP (sem coalescing, débito #188)", () => {
  it("cache sempre MISS (sem write-through entre as duas) → 2 idas ao ViaCEP e 2 ao Google, ambas com sucesso", async () => {
    // getMock nunca reflete o que setMock grava (cada chamada concorrente lê
    // o cache ANTES de qualquer uma delas escrever) — é exatamente o cenário
    // real de duas abas do mesmo cliente clicando "calcular frete" ao mesmo
    // tempo, ambas com cache miss.
    getMock.mockResolvedValue(null);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("Jardim Sevilha")) return googleOk(COORDS_A.latitude, COORDS_A.longitude);
        throw new Error("URL inesperada: " + url);
      });
    const resolverX = resolverOk(ENDERECO_A);
    const resolverY = resolverOk(ENDERECO_A);

    const [r1, r2] = await Promise.all([
      geocodificarCepResolvido(CEP_A, resolverX, IP_CLIENTE),
      geocodificarCepResolvido(CEP_A, resolverY, IP_CLIENTE),
    ]);

    // Comportamento atual (não piorou, não melhorou): as DUAS chamadas
    // concorrentes pagam o custo total, cada uma com seu próprio
    // resolverEndereco (ViaCEP) e sua própria chamada ao Google — sem
    // deduplicação. Resolver a #188 mudaria estes números para 1; até lá,
    // este teste é a rede de segurança contra uma regressão que piorasse
    // ainda mais (ex.: cada chamada disparando N tentativas de cascata em
    // vez de 1 cada).
    expect(r1).toEqual({ coords: COORDS_A });
    expect(r2).toEqual({ coords: COORDS_A });
    expect(resolverX).toHaveBeenCalledTimes(1);
    expect(resolverY).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Cascata continua em `nao_encontrado` mesmo quando causado por geometria
// malformada (200/OK sem geometry/location), não só por ZERO_RESULTS —
// consultarGoogle trata os dois como o mesmo `motivo`.
// =============================================================================
describe("[190] cascata avança também quando o motivo é geometria malformada (não só ZERO_RESULTS)", () => {
  it("1º candidato: 200/OK sem `results[0].geometry` (nao_encontrado) → cascata tenta o 2º, que sucede", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "OK", results: [{}] }), { status: 200 }),
      )
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: COORDS_A });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Resposta 200/OK com `status` ausente/malformado no MEIO da cascata: para
// IMEDIATO (transitorio), igual a qualquer outro status de erro — não é
// tratado como "tenta o próximo candidato".
// =============================================================================
describe("[190] status ausente/malformado no corpo da Google → transitorio IMEDIATO, cascata não avança", () => {
  it("1º candidato sem campo `status` nenhum → transitorio, exatamente 1 fetch (não tenta o 2º)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("1º candidato com corpo não-JSON → transitorio, exatamente 1 fetch, sem propagar exceção", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("não é json", { status: 200 }))
      .mockResolvedValueOnce(googleOk(COORDS_A.latitude, COORDS_A.longitude));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Teto diário: negação NO MEIO de uma sequência de chamadas (CEPs distintos)
// não contamina as chamadas vizinhas — a próxima chamada com o mock de limit
// concedendo de novo (simulando reset em nova janela) resolve normalmente.
// Isto NÃO testa o algoritmo real do fixedWindow do Upstash (mockado por
// completo, sem Redis real neste ambiente de teste — CLAUDE.md), só que o
// código do iRango reage corretamente a cada resposta de `.limit()`, chamada
// a chamada, sem estado espúrio entre CEPs diferentes.
// =============================================================================
describe("[190] teto diário — negação no meio de uma sequência não contamina chamadas vizinhas", () => {
  // Rótulo dos mocks corrigido junto com o achado 2: com `ip` presente há TRÊS
  // chamadas de `limit()` por consulta (burst → teto/IP → teto global), então o
  // `false` da 4ª chamada é o BURST do CEP2 — e burst negado passou a ser
  // `throttle_interno` (throttle NOSSO nunca vira frete a combinar).
  it("CEP1 concede, CEP2 nega, CEP3 concede de novo (nova janela) → só CEP2 degrada", async () => {
    const CEP_C = "01310-100";
    const ENDERECO_C: EnderecoCepResolvido = {
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    };
    const COORDS_C = { latitude: -23.5613, longitude: -46.6558 };

    limitMock
      .mockResolvedValueOnce({ success: true }) // CEP1 burst
      .mockResolvedValueOnce({ success: true }) // CEP1 teto/IP
      .mockResolvedValueOnce({ success: true }) // CEP1 teto global → concede
      .mockResolvedValueOnce({ success: false }) // CEP2 burst → nega
      .mockResolvedValueOnce({ success: true }) // (não alcançadas por CEP2)
      .mockResolvedValueOnce({ success: true });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("Jardim Sevilha")) return googleOk(COORDS_A.latitude, COORDS_A.longitude);
        if (url.includes("Paulista")) return googleOk(COORDS_C.latitude, COORDS_C.longitude);
        throw new Error("URL inesperada: " + url);
      });

    const r1 = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);
    const r2 = await geocodificarCepResolvido(CEP_B, resolverOk(ENDERECO_B), IP_CLIENTE);
    const r3 = await geocodificarCepResolvido(CEP_C, resolverOk(ENDERECO_C), IP_CLIENTE);

    expect(r1).toEqual({ coords: COORDS_A });
    expect(r2).toEqual({ coords: null, motivo: "throttle_interno" });
    expect(r3).toEqual({ coords: COORDS_C });
    // CEP2 negado: nenhum fetch pago por ele. CEP1 e CEP3 usam 1 fetch cada
    // (1º candidato já sucede) → 2 fetches no total.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// A configuração de GEOCODE_GOOGLE_DAILY_LIMIT precisa realmente chegar ao
// Ratelimit.fixedWindow — os testes anteriores só verificam que o CAMINHO
// FELIZ continua funcionando com a env customizada, o que passaria mesmo se
// o valor nunca fosse lido (o `limit()` mockado sempre concede,
// independentemente do N configurado). Isolamos com vi.resetModules() +
// import dinâmico porque limitadorDiario é um singleton em nível de módulo
// (obterLimitadorDiario só constrói UMA vez por instância do módulo) — sem
// isolar, um teste anterior no mesmo arquivo já teria fixado o singleton com
// o default 500 antes deste teste mudar a env.
// =============================================================================
describe("[190] GEOCODE_GOOGLE_DAILY_LIMIT realmente chega a Ratelimit.fixedWindow(N, \"1 d\")", () => {
  it("valor customizado da env é passado a fixedWindow (não fica preso no default do singleton)", async () => {
    process.env.GEOCODE_GOOGLE_DAILY_LIMIT = "7";
    vi.resetModules();

    const { Ratelimit } = await import("@upstash/ratelimit");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const mod = await import("./geocodificarEndereco");
    await mod.geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const chamadas = (
      Ratelimit.fixedWindow as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(chamadas).toContainEqual([7, "1 d"]);
  });

  it("sem env (default) → fixedWindow é chamado com 500 para o teto diário", async () => {
    delete process.env.GEOCODE_GOOGLE_DAILY_LIMIT;
    vi.resetModules();

    const { Ratelimit } = await import("@upstash/ratelimit");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const mod = await import("./geocodificarEndereco");
    await mod.geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const chamadas = (
      Ratelimit.fixedWindow as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(chamadas).toContainEqual([500, "1 d"]);
    expect(chamadas).toContainEqual([10, "1 s"]);
  });
});

// ── Nenhum log carrega coordenada ou endereço do cliente ────────────────────
describe("[190] nenhum log carrega coordenada, endereço ou chave", () => {
  it("caminho de erro não loga o par, a consulta nem a chave", async () => {
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const logado = erroSpy.mock.calls
      .map((c) => c.map((a) => String(a)).join(" "))
      .join(" | ");
    expect(logado).not.toContain("22.9");
    expect(logado).not.toContain("46.5");
    expect(logado).not.toContain("Jardim Sevilha");
    expect(logado).not.toContain(CHAVE_GOOGLE);
  });
});

// =============================================================================
// 31-33) Teto diário SECUNDÁRIO por IP (auditoria 190, achado MÉDIO)
// =============================================================================
// O teto diário GLOBAL (fixedWindow(N,"1 d")) protege o ORÇAMENTO agregado,
// mas um único atacante não-autenticado (calcularFreteAction é endpoint
// PÚBLICO) pode esgotá-lo sozinho variando CEPs cedo no dia, negando o
// cálculo de frete-por-raio a clientes legítimos pelo resto do dia. A
// mitigação é um teto diário SECUNDÁRIO, por IP, MAIS BAIXO que o global —
// nenhum IP sozinho deveria conseguir consumir uma fatia desproporcional do
// orçamento agregado. `geocodificarCepResolvido` passa a receber `ip` como
// 3º parâmetro OBRIGATÓRIO (convenção da issue 160 — opcional deixaria um
// caller esquecer e reabrir o vetor silenciosamente).
describe("[190-31/33] teto diário SECUNDÁRIO por IP — auditoria MÉDIA", () => {
  it("31) IP com teto por IP já esgotado é bloqueado (esgotado, zero fetch) mesmo com teto GLOBAL livre; outro IP não é afetado", async () => {
    const IP_ABUSIVO = "203.0.113.9";
    const IP_LEGITIMO = "203.0.113.55";
    // burst e teto diário GLOBAL sempre concedem; só o teto por IP do
    // IP_ABUSIVO nega — simula exatamente o cenário do achado: o global
    // ainda tem orçamento, mas ESTE IP já estourou a fatia dele.
    limitMock.mockImplementation(async (id: unknown) => {
      if (id === IP_ABUSIVO) return { success: false };
      return { success: true };
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("Jardim Sevilha")) return googleOk(COORDS_A.latitude, COORDS_A.longitude);
        if (url.includes("Centro")) return googleOk(COORDS_B.latitude, COORDS_B.longitude);
        throw new Error("URL inesperada: " + url);
      });

    const bloqueado = await geocodificarCepResolvido(
      CEP_A,
      resolverOk(ENDERECO_A),
      IP_ABUSIVO,
    );
    // [180-B] era `transitorio`; virou `esgotado`: a trava que negou não se
    // move no curto prazo, e a UI usa o motivo para decidir se retenta.
    expect(bloqueado).toEqual({ coords: null, motivo: "esgotado" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const liberado = await geocodificarCepResolvido(
      CEP_B,
      resolverOk(ENDERECO_B),
      IP_LEGITIMO,
    );
    expect(liberado).toEqual({ coords: COORDS_B });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Prova que o identificador usado na trava por IP é o PRÓPRIO ip
    // recebido (isolamento real por IP, não uma chave global disfarçada).
    const identificadores = limitMock.mock.calls.map((c) => c[0]);
    expect(identificadores).toContain(IP_ABUSIVO);
  });

  it("32) teto por IP é configurável via GEOCODE_GOOGLE_DAILY_LIMIT_IP e chega a Ratelimit.fixedWindow", async () => {
    process.env.GEOCODE_GOOGLE_DAILY_LIMIT_IP = "3";
    vi.resetModules();

    const { Ratelimit } = await import("@upstash/ratelimit");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const mod = await import("./geocodificarEndereco");
    await mod.geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const chamadas = (
      Ratelimit.fixedWindow as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(chamadas).toContainEqual([3, "1 d"]);
  });

  it("33) default do teto por IP (sem env) é MENOR que o default do teto global (500) — defesa em profundidade fora da caixa", async () => {
    delete process.env.GEOCODE_GOOGLE_DAILY_LIMIT_IP;
    vi.resetModules();

    const { Ratelimit } = await import("@upstash/ratelimit");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      googleOk(COORDS_A.latitude, COORDS_A.longitude),
    );

    const mod = await import("./geocodificarEndereco");
    await mod.geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    const chamadas = (
      Ratelimit.fixedWindow as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls as Array<[number, string]>;
    // Só as janelas DIÁRIAS ("1 d") — o burst ("1 s") não é o teto sob teste
    // aqui. Precisam existir DUAS janelas diárias distintas (global + por
    // IP): se só existir uma, o teto por IP simplesmente não foi
    // implementado (a asserção de tamanho falha antes mesmo do valor).
    const limitesDiarios = chamadas
      .filter(([, janela]) => janela === "1 d")
      .map(([n]) => n);
    expect(limitesDiarios.length).toBeGreaterThanOrEqual(2);
    // O default do teto por IP precisa ser estritamente menor que o default
    // do teto global (500) — senão um único IP poderia esgotar o global
    // sozinho de novo, e a "defesa em profundidade" seria só decorativa.
    const menorLimiteDiario = Math.min(...limitesDiarios);
    expect(menorLimiteDiario).toBeLessThan(500);
    expect(menorLimiteDiario).toBeGreaterThan(0);
  });
});

// =============================================================================
// RED (TDD red-first) — issue 180-B, teste nº 8 do plano.
//
// `MotivoGeocoding` ganha "esgotado". A pergunta que a UI precisa responder NÃO
// é "a falha é permanente?" e sim "retentar AGORA adianta?" — 20s de spinner
// por uma env var faltando é desperdício da atenção do comprador.
//
// Mapa fixo e exaustivo (plan/180-B §D2):
//   burst fixedWindow(10,"1s") negou ........ transitorio   (retry sim)
//   fetch timeout / reject / exceção ........ transitorio   (retry sim)
//   HTTP não-ok (5xx, 429) .................. transitorio   (retry sim)
//   status ≠ OK/ZERO_RESULTS (OVER_QUERY_
//     LIMIT, UNKNOWN_ERROR, REQUEST_DENIED) . transitorio   (retry sim)
//   teto diário GLOBAL negou ................ esgotado      (retry NÃO)
//   teto diário POR IP negou ................ esgotado      (retry NÃO)
//   GOOGLE_GEOCODING_API_KEY ausente ........ esgotado      (retry NÃO)
//   credenciais Upstash ausentes ............ esgotado      (retry NÃO)
//   ViaCEP null / lançou .................... transitorio   (retry sim)
//   CEP malformado .......................... nao_encontrado (retry NÃO —
//       hoje é transitorio; retentar um CEP inválido NUNCA resolve)
//   ZERO_RESULTS em toda a cascata .......... nao_encontrado (retry NÃO)
//
// ⚠ Os testes ACIMA que afirmam "transitorio" para os casos REMAPEADOS (teto
//   global, teto por IP, chave ausente, credenciais ausentes, CEP malformado)
//   ficam vermelhos na fase GREEN: é a fase GREEN que os atualiza, com o porquê
//   no diff (plan/180-B, passo 4 da ordem de implementação).
//
// A ordem das travas em `consultarGoogle` é burst → teto por IP → teto global;
// as sequências de `limitMock` abaixo dependem dela.
// =============================================================================

describe("[180-B] MotivoGeocoding ganha 'esgotado' — retentar AGORA adianta?", () => {
  // ── esgotado: retentar agora NÃO adianta ──────────────────────────────────
  it("teto diário GLOBAL negou → 'esgotado' (não 'transitorio'), fetch nunca chamado", async () => {
    limitMock
      .mockResolvedValueOnce({ success: true }) // burst concede
      .mockResolvedValueOnce({ success: true }) // teto por IP concede
      .mockResolvedValueOnce({ success: false }); // teto GLOBAL nega
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "esgotado" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("teto diário POR IP negou → 'esgotado' (NAT/CGNAT: a UI não pode culpar o cliente)", async () => {
    limitMock
      .mockResolvedValueOnce({ success: true }) // burst concede
      .mockResolvedValueOnce({ success: false }); // teto POR IP nega
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "esgotado" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GOOGLE_GEOCODING_API_KEY ausente → 'indisponivel_config' (achado 3)", async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY;

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    // INVERTIDO pela auditoria (achado 3): config ausente é defeito NOSSO e
    // deixou de ser `esgotado` (que classifica como a_combinar e zera o frete).
    expect(r).toEqual({ coords: null, motivo: "indisponivel_config" });
  });

  it("credenciais Upstash ausentes → 'indisponivel_config' (achado 3)", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    // Mesma inversão do teste acima: falta de credencial NOSSA é defeito nosso,
    // não orçamento esgotado — e não pode zerar o frete de ninguém.
    expect(r).toEqual({ coords: null, motivo: "indisponivel_config" });
  });

  // ── nao_encontrado: o problema é o DADO, retentar não resolve ─────────────
  it("CEP malformado → 'nao_encontrado' (não 'transitorio'): retentar um CEP inválido nunca resolve", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = resolverOk();

    const r = await geocodificarCepResolvido("123", resolver, IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
    expect(getMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ZERO_RESULTS em TODA a cascata → 'nao_encontrado' (inalterado)", async () => {
    // `mockImplementation` (não `mockResolvedValue`): cada candidato da cascata
    // precisa de um Response NOVO — um corpo já consumido lançaria no 2º
    // `.json()` e mascararia o motivo real com "transitorio".
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      googleStatus("ZERO_RESULTS"),
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "nao_encontrado" });
  });

  // ── transitorio: retry faz sentido (inalterado — guardas de não-regressão) ─
  // INVERTIDO pela auditoria (achado 2): o burst é throttle NOSSO, não outage
  // do canal externo, e como `transitorio` classificava como a_combinar.
  it("burst 10/s negou → 'throttle_interno' (achado 2)", async () => {
    limitMock.mockResolvedValueOnce({ success: false }); // burst nega

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "throttle_interno" });
  });

  it("HTTP 500 da Google → 'transitorio'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("erro", { status: 500 }),
    );

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("status OVER_QUERY_LIMIT → 'transitorio' (a resposta não distingue de erro momentâneo)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(googleStatus("OVER_QUERY_LIMIT"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("ViaCEP devolveu null → 'transitorio' (jamais cai no CEP cru como consulta de consolo)", async () => {
    const r = await geocodificarCepResolvido(CEP_A, resolverNulo(), IP_CLIENTE);
    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });

  it("fetch lançou (timeout de 5s) → 'transitorio'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("TimeoutError"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await geocodificarCepResolvido(CEP_A, resolverOk(ENDERECO_A), IP_CLIENTE);

    expect(r).toEqual({ coords: null, motivo: "transitorio" });
  });
});
