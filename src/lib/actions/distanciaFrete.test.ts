import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do helper neutro distanciaDaLojaAoCep (src/lib/actions/distanciaFrete.ts).
 *
 * RED (issue 185, crítica): a assinatura MUDA — ganha um 4º parâmetro
 * OBRIGATÓRIO `resolverEndereco: () => Promise<EnderecoCepResolvido | null>`
 * (convenção da issue 160: parâmetro obrigatório impede que um caller esqueça e
 * caia silenciosamente no caminho quebrado) — e o CEP deixa de ser a consulta
 * enviada ao Nominatim:
 *
 *   antes:  geocodificarEndereco(cep)                    ← CEP cru = causa raiz
 *   depois: geocodificarCepResolvido(cep, thunk)         ← CEP só como CHAVE
 *           thunk = resolverEndereco() → montarConsultaCepCliente(e) | null
 *
 * Contrato fail-closed preservado (RN-5): undefined em qualquer falha ou
 * pré-condição ausente; NUNCA lança; NUNCA arredonda.
 *
 * Mocks só de I/O externo e dos módulos vizinhos — a orquestração é o que está
 * sob teste. Nenhum teste bate na rede (nem ViaCEP nem Nominatim).
 */

const buscarCoordsLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarCoordsLoja: (...a: unknown[]) => buscarCoordsLoja(...a),
}));

// Novo colaborador: dona única do cache CEP→coords + portões anti-ban.
const geocodificarCepResolvido = vi.fn();
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarCepResolvido: (...a: unknown[]) => geocodificarCepResolvido(...a),
}));

// Construtor puro da consulta textual (D1c).
const montarConsultaCepCliente = vi.fn();
vi.mock("@/lib/utils/geocodingCepCliente", () => ({
  montarConsultaCepCliente: (...a: unknown[]) => montarConsultaCepCliente(...a),
}));

const haversine = vi.fn();
vi.mock("@/lib/utils/haversine", () => ({
  haversine: (...a: unknown[]) => haversine(...a),
}));

import { distanciaDaLojaAoCep } from "./distanciaFrete";

const svc = { __role: "service" } as never;
const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// Caso reproduzido na issue 185.
const CEP = "12914-190";
const ENDERECO_RESOLVIDO = {
  bairro: "Jardim Europa",
  logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
  cidade: "Bragança Paulista",
  uf: "SP",
};
const CONSULTA = "Jardim Europa, Bragança Paulista - SP, Brasil";
// Coords cadastradas de "Pão do Ciso" (issue 185).
const LOJA_COORDS = { latitude: -22.9610457, longitude: -46.5422615 };
// Par que o Nominatim devolve para a consulta acima (evidência da issue).
const CLIENTE_COORDS = { latitude: -22.9520235, longitude: -46.5418586 };

/** Resolvedor memoizado de sucesso, como frete.ts/pedido.ts o constroem. */
function resolvedorOk() {
  return vi.fn(async () => ENDERECO_RESOLVIDO);
}

/** Resolvedor fail-closed: ViaCEP indisponível / CEP inexistente. */
function resolvedorNulo() {
  return vi.fn(async () => null);
}

/** Extrai o thunk (2º argumento) passado a geocodificarCepResolvido. */
function thunkCapturado(): () => Promise<string | null> {
  const args = geocodificarCepResolvido.mock.calls[0];
  return args?.[1] as () => Promise<string | null>;
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarCoordsLoja.mockResolvedValue(LOJA_COORDS);
  geocodificarCepResolvido.mockResolvedValue({ coords: CLIENTE_COORDS });
  montarConsultaCepCliente.mockReturnValue(CONSULTA);
  haversine.mockReturnValue(7.42);
});

describe("distanciaDaLojaAoCep — pré-condições (fail-closed, sem I/O à toa)", () => {
  it("CEP null → undefined SEM tocar em coords, ViaCEP ou geocoding", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, null, resolver);
    expect(r).toBeUndefined();
    expect(buscarCoordsLoja).not.toHaveBeenCalled();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("CEP undefined → undefined SEM I/O", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, undefined, resolver);
    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("CEP string vazia → undefined SEM I/O", async () => {
    const resolver = resolvedorOk();
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "", resolver);
    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("loja sem coords → undefined SEM tocar ViaCEP nem Nominatim (curto-circuito)", async () => {
    buscarCoordsLoja.mockResolvedValue(null);
    const resolver = resolvedorOk();

    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver);

    expect(r).toBeUndefined();
    expect(geocodificarCepResolvido).not.toHaveBeenCalled();
    // O resolvedor é um THUNK: sem geocoding, o ViaCEP nem é consultado.
    expect(resolver).not.toHaveBeenCalled();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("buscarCoordsLoja recebe o client service_role e o lojaId (§19)", async () => {
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());
    expect(buscarCoordsLoja).toHaveBeenCalledWith(svc, LOJA_ID);
  });
});

describe("distanciaDaLojaAoCep — [185] o CEP é CHAVE, não consulta", () => {
  it("chama geocodificarCepResolvido(cep, thunk) — NUNCA geocodifica o CEP cru", async () => {
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());

    expect(geocodificarCepResolvido).toHaveBeenCalledTimes(1);
    const [primeiro, segundo] = geocodificarCepResolvido.mock.calls[0]!;
    expect(primeiro).toBe(CEP); // chave de cache
    expect(typeof segundo).toBe("function"); // consulta = thunk, não string
  });

  it("o thunk resolve o CEP no servidor e devolve a consulta textual", async () => {
    const resolver = resolvedorOk();
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver);

    const consulta = await thunkCapturado()();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(montarConsultaCepCliente).toHaveBeenCalledWith(ENDERECO_RESOLVIDO);
    expect(consulta).toBe(CONSULTA);
    // O CEP não vaza para a consulta (causa raiz da 185).
    expect(consulta).not.toContain("12914");
  });

  it("ViaCEP falhou (resolvedor null) → thunk devolve null, SEM consulta de consolo", async () => {
    const resolver = resolvedorNulo();
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver);

    const consulta = await thunkCapturado()();

    expect(consulta).toBeNull();
    // Nem tenta montar consulta a partir de nada — e jamais cai no CEP cru.
    expect(montarConsultaCepCliente).not.toHaveBeenCalled();
  });

  it("montarConsultaCepCliente devolve null (sem cidade/uf) → thunk devolve null", async () => {
    montarConsultaCepCliente.mockReturnValue(null);
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());

    await expect(thunkCapturado()()).resolves.toBeNull();
  });

  it("o thunk NÃO é invocado pelo helper — quem decide é o geocoder (após o cache)", async () => {
    // Memoização + cache: em cache hit, nenhuma ida ao ViaCEP acontece.
    const resolver = resolvedorOk();
    await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("distanciaDaLojaAoCep — resultado do geocoding", () => {
  it("geocoding transitorio → undefined SEM haversine", async () => {
    geocodificarCepResolvido.mockResolvedValue({
      coords: null,
      motivo: "transitorio",
    });
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());
    expect(r).toBeUndefined();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("geocoding nao_encontrado → undefined SEM haversine", async () => {
    geocodificarCepResolvido.mockResolvedValue({
      coords: null,
      motivo: "nao_encontrado",
    });
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());
    expect(r).toBeUndefined();
    expect(haversine).not.toHaveBeenCalled();
  });

  it("sucesso → haversine(lojaLat, lojaLng, cliLat, cliLng) e retorno EXATO (sem arredondar)", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());

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
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());
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

    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk());

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
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk()),
    ).resolves.toBeUndefined();
  });

  it("geocodificarCepResolvido lança → undefined", async () => {
    geocodificarCepResolvido.mockRejectedValue(new Error("timeout nominatim"));
    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk()),
    ).resolves.toBeUndefined();
  });

  it("resolvedor lança dentro do thunk → undefined (não propaga)", async () => {
    geocodificarCepResolvido.mockImplementation(
      async (_cep: string, thunk: () => Promise<string | null>) => {
        await thunk();
        return { coords: null, motivo: "transitorio" };
      },
    );
    const resolver = vi.fn(async () => {
      throw new Error("ECONNREFUSED viacep");
    });

    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolver),
    ).resolves.toBeUndefined();
  });

  it("haversine lança → undefined", async () => {
    haversine.mockImplementation(() => {
      throw new Error("NaN coords");
    });
    await expect(
      distanciaDaLojaAoCep(svc, LOJA_ID, CEP, resolvedorOk()),
    ).resolves.toBeUndefined();
  });
});
