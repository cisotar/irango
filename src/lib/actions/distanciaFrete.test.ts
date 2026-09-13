import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do helper neutro distanciaDaLojaAoCep (src/lib/actions/distanciaFrete.ts).
 *
 * RED (issue 190, crítica): plan/tecnico-geocoding-google.md simplifica o
 * CONTRATO — `distanciaFrete.ts` PARA de importar/chamar
 * `montarConsultaCepCliente` (ou a versão em cascata, `montarConsultasCepCliente`)
 * e passa `resolverEndereco` DIRETO para `geocodificarCepResolvido`, que já
 * orquestra a cascata internamente (decisão 1 do plano):
 *
 *   antes (185): geocodificarCepResolvido(cep, async () => {
 *                  const resolvido = await resolverEndereco();
 *                  return resolvido ? montarConsultaCepCliente(resolvido) : null;
 *                })
 *   depois (190): geocodificarCepResolvido(cep, resolverEndereco)
 *
 * `resolverEndereco` já tem o shape certo (`() => Promise<EnderecoCepResolvido
 * | null>`) — o thunk deixa de existir neste módulo. Ajuste de CONTRATO, não de
 * comportamento observável (paridade preview↔autoritativo permanece igual).
 *
 * Mocks só de I/O externo e dos módulos vizinhos — a orquestração é o que está
 * sob teste. Nenhum teste bate na rede (nem ViaCEP nem Google).
 */

const buscarCoordsLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarCoordsLoja: (...a: unknown[]) => buscarCoordsLoja(...a),
}));

// Novo colaborador: dona única do cache CEP→coords + guarda de custo.
const geocodificarCepResolvido = vi.fn();
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarCepResolvido: (...a: unknown[]) => geocodificarCepResolvido(...a),
}));

const haversine = vi.fn();
vi.mock("@/lib/utils/haversine", () => ({
  haversine: (...a: unknown[]) => haversine(...a),
}));

import { distanciaDaLojaAoCep } from "./distanciaFrete";

const svc = { __role: "service" } as never;
const LOJA_ID = "11111111-1111-1111-1111-111111111111";
// IP de teste (RFC 5737 TEST-NET-3 — reservado para documentação). 190/auditoria:
// `distanciaDaLojaAoCep` ganhou `ip` como 5º parâmetro OBRIGATÓRIO, repassado
// direto a `geocodificarCepResolvido` (teto diário secundário por IP).
const IP_TESTE = "203.0.113.42";

// Caso reproduzido na issue 185.
const CEP = "12914-190";
const ENDERECO_RESOLVIDO = {
  bairro: "Jardim Europa",
  logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
  cidade: "Bragança Paulista",
  uf: "SP",
};
// Coords cadastradas de "Pão do Ciso" (issue 185).
const LOJA_COORDS = { latitude: -22.9610457, longitude: -46.5422615 };
// Par que o Google devolve para o CEP acima (evidência da issue 190).
const CLIENTE_COORDS = { latitude: -22.9520235, longitude: -46.5418586 };

/** Resolvedor memoizado de sucesso, como frete.ts/pedido.ts o constroem. */
function resolvedorOk() {
  return vi.fn(async () => ENDERECO_RESOLVIDO);
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarCoordsLoja.mockResolvedValue(LOJA_COORDS);
  geocodificarCepResolvido.mockResolvedValue({ coords: CLIENTE_COORDS });
  haversine.mockReturnValue(7.42);
});

describe("distanciaDaLojaAoCep — pré-condições (fail-closed, sem I/O à toa)", () => {
  it("CEP null → undefined SEM tocar em coords, ViaCEP ou geocoding", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, null, resolver, IP_TESTE);
    expect(r).toBeUndefined();
    expect(buscarCoordsLoja).not.toHaveBeenCalled();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("CEP undefined → undefined SEM I/O", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, undefined, resolver, IP_TESTE);
    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("CEP string vazia → undefined SEM I/O", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "", resolver, IP_TESTE);
    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("loja sem coords → undefined SEM tocar ViaCEP nem Nominatim (curto-circuito)", async () => {
    buscarCoordsLoja.mockResolvedValue(null);
    const resolver = resolvedorOk();

    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver, IP_TESTE);

    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    // O resolvedor é um THUNK: sem geocoding, o ViaCEP nem é consultado.
    expect(resolver).not.toHaveBeenCalled();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("buscarCoordsLoja recebe o client service_role e o lojaId (§19)", async () => {
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);
    expect(buscarCoordsLoja).toHaveBeenCalledWith(svc, LOJA_ID);
  });
});

describe("distanciaDaLojaAoCep — [190] resolverEndereco é passado DIRETO, sem thunk local", () => {
  it("30) chama geocodificarCepResolvido(cep, resolverEndereco) — o mesmo resolver, sem embrulho", async () => {
    const resolver = resolvedorOk();
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver, IP_TESTE);

    expect(geocodificarCepResolvido).toHaveBeenCalledTimes(1);
    const [primeiro, segundo, terceiro] = geocodificarCepResolvido.mock.calls[0]!;
    expect(primeiro).toBe(CEP); // chave de cache
    // Contrato 190: o 2º argumento é o PRÓPRIO `resolverEndereco` recebido —
    // não mais um thunk local que embrulha `montarConsultaCepCliente`. A
    // cascata de consultas passou a ser responsabilidade do módulo de
    // geocoding, não deste caller.
    expect(segundo).toBe(resolver);
    // 190/auditoria (achado MÉDIO): o 3º argumento é o `ip` recebido, repassado
    // sem transformação — é o identificador do teto diário secundário por IP.
    expect(terceiro).toBe(IP_TESTE);
  });

  it("o helper NÃO invoca o resolvedor — quem decide é o geocoder (após o cache)", async () => {
    // Memoização + cache: em cache hit, nenhuma ida ao ViaCEP acontece.
    const resolver = resolvedorOk();
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver, IP_TESTE);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("nenhum import de montarConsultaCepCliente/montarConsultasCepCliente no código-fonte", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("./distanciaFrete.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/montarConsultas?CepCliente/);
  });
});

describe("distanciaDaLojaAoCep — resultado do geocoding", () => {
  it("geocoding transitorio → undefined SEM haversine", async () => {
    geocodificarCepResolvido.mockResolvedValue({
      coords: null,
      motivo: "transitorio",
    });
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);
    expect(r).toBeUndefined();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("geocoding nao_encontrado → undefined SEM haversine", async () => {
    geocodificarCepResolvido.mockResolvedValue({
      coords: null,
      motivo: "nao_encontrado",
    });
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);
    expect(r).toBeUndefined();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("sucesso → haversine(lojaLat, lojaLng, cliLat, cliLng) e retorno EXATO (sem arredondar)", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);

    expect(haversine).toHaveBeenCalledTimes(1);
    expect(haversine).toHaveBeenCalledWith(
      LOJA_COORDS.latitude,
      LOJA_COORDS.longitude,
      CLIENTE_COORDS.latitude,
      CLIENTE_COORDS.longitude,
    );
    expect(r).toBe(7.42);
  });

  it("haversine retorna 0 (loja = cliente) → 0, não undefined", async () => {
    haversine.mockReturnValue(0);
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);
    expect(r).toBe(0);
  });
});

// ── O caso numérico da issue, ponta a ponta (haversine REAL) ────────────────
describe("distanciaDaLojaAoCep — [185] caso numérico 12914-190 × Pão do Ciso", () => {
  it("CEP 12914-190 resolvido por Bragança Paulista/SP → distância < 2 km da loja", async () => {
    const real = await vi.importActual<typeof import("@/lib/utils/haversine")>(
      "@/lib/utils/haversine",
    );
    haversine.mockImplementation(real.haversine);

    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE);

    expect(typeof r).toBe("number");
    // Hoje o CEP cru resolvia para uma estrada na República Tcheca (~9.700 km).
    expect(r!).toBeLessThan(2);
    expect(r!).toBeGreaterThan(0);
  });
});

describe("distanciaDaLojaAoCep — fail-closed total (nunca propaga exceção)", () => {
  it("buscarCoordsLoja lança → undefined", async () => {
    buscarCoordsLoja.mockRejectedValue(new Error("connection refused"));
    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE),
    ).resolves.toBeUndefined();
  });

  it("geocodificarCepResolvido lança → undefined", async () => {
    geocodificarCepResolvido.mockRejectedValue(new Error("timeout nominatim"));
    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE),
    ).resolves.toBeUndefined();
  });

  it("resolvedor lança quando invocado pelo geocoder → undefined (não propaga)", async () => {
    geocodificarCepResolvido.mockImplementation(
      async (
        _cep: string,
        resolverEndereco: () => Promise<unknown>,
      ) => {
        await resolverEndereco();
        return { coords: null, motivo: "transitorio" };
      },
    );
    const resolver = vi.fn(async () => {
      throw new Error("ECONNREFUSED viacep");
    });

    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver, IP_TESTE),
    ).resolves.toBeUndefined();
  });

  it("haversine lança → undefined", async () => {
    haversine.mockImplementation(() => {
      throw new Error("NaN coords");
    });
    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk(), IP_TESTE),
    ).resolves.toBeUndefined();
  });
});
