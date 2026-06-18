import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes unitários do helper neutro distanciaDaLojaAoCep
 * (src/lib/actions/distanciaFrete.ts — issue 006).
 *
 * Contrato (fail-closed, RN-5):
 *   - CEP ausente/vazio   → undefined SEM chamar buscarCoordsLoja nem geocode
 *   - loja sem coords     → undefined SEM chamar geocodificarEndereco
 *   - geocoding null      → undefined (sem haversine)
 *   - sucesso             → haversine(lojaLat, lojaLng, cliLat, cliLng), retorna valor
 *   - exceção em qualquer passo → undefined (fail-closed total)
 *
 * Mocks só de I/O externo — a lógica de orquestração é o que está sob teste.
 */

// ── mocks dos 3 I/Os ─────────────────────────────────────────────────────────
const buscarCoordsLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarCoordsLoja: (...a: unknown[]) => buscarCoordsLoja(...a),
}));

const geocodificarEndereco = vi.fn();
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarEndereco: (...a: unknown[]) => geocodificarEndereco(...a),
}));

const haversine = vi.fn();
vi.mock("@/lib/utils/haversine", () => ({
  haversine: (...a: unknown[]) => haversine(...a),
}));

import { distanciaDaLojaAoCep } from "./distanciaFrete";

// Sentinela de client service_role — apenas passado por referência, não usado internamente.
const svc = { __role: "service" } as never;
const LOJA_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults do caminho feliz — sobrescritos por teste específico quando necessário.
  buscarCoordsLoja.mockResolvedValue({ latitude: -23.5, longitude: -46.6 });
  geocodificarEndereco.mockResolvedValue({ latitude: -23.55, longitude: -46.65 });
  haversine.mockReturnValue(7.42);
});

describe("distanciaDaLojaAoCep (helper neutro, issue 006)", () => {
  // ── Pré-condição: CEP ausente/vazio → nada é chamado ─────────────────────

  it("CEP null → undefined SEM chamar buscarCoordsLoja nem geocodificarEndereco", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, null);
    expect(r).toBeUndefined();
    expect(buscarCoordsLoja).not.toHaveBeenCalled();
    expect(geocodificarEndereco).not.toHaveBeenCalled();
  });

  it("CEP undefined → undefined SEM chamar buscarCoordsLoja nem geocodificarEndereco", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, undefined);
    expect(r).toBeUndefined();
    expect(buscarCoordsLoja).not.toHaveBeenCalled();
    expect(geocodificarEndereco).not.toHaveBeenCalled();
  });

  it("CEP string vazia → undefined SEM chamar buscarCoordsLoja nem geocodificarEndereco", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "");
    expect(r).toBeUndefined();
    expect(buscarCoordsLoja).not.toHaveBeenCalled();
    expect(geocodificarEndereco).not.toHaveBeenCalled();
  });

  // ── Loja sem coords → curto-circuito antes do geocode ─────────────────────

  it("buscarCoordsLoja retorna null → undefined SEM chamar geocodificarEndereco", async () => {
    buscarCoordsLoja.mockResolvedValue(null);
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    expect(r).toBeUndefined();
    expect(geocodificarEndereco).not.toHaveBeenCalled();
    expect(haversine).not.toHaveBeenCalled();
  });

  // ── Geocoding null → undefined (sem haversine) ───────────────────────────

  it("geocodificarEndereco retorna null → undefined SEM chamar haversine", async () => {
    geocodificarEndereco.mockResolvedValue(null);
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    expect(r).toBeUndefined();
    expect(haversine).not.toHaveBeenCalled();
  });

  // ── Caminho feliz: haversine chamado com as coords certas e valor retornado ──

  it("sucesso → haversine chamado com (lojaLat, lojaLng, cliLat, cliLng) e retorna o valor exato", async () => {
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    // Haversine chamado com coordenadas loja ANTES das coordenadas cliente (RN-8).
    expect(haversine).toHaveBeenCalledTimes(1);
    expect(haversine).toHaveBeenCalledWith(-23.5, -46.6, -23.55, -46.65);
    // O retorno é exatamente o que haversine produziu — sem arredondamento.
    expect(r).toBe(7.42);
  });

  it("sucesso → buscarCoordsLoja recebeu o client service_role e o lojaId", async () => {
    await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    expect(buscarCoordsLoja).toHaveBeenCalledWith(svc, LOJA_ID);
  });

  it("sucesso → geocodificarEndereco recebeu o CEP cru do cliente", async () => {
    await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    expect(geocodificarEndereco).toHaveBeenCalledWith("01000-000");
  });

  // ── Fail-closed total: exceção em qualquer passo → undefined ────────────────

  it("buscarCoordsLoja lança → undefined (não propaga a exceção)", async () => {
    buscarCoordsLoja.mockRejectedValue(new Error("connection refused"));
    await expect(distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000")).resolves.toBeUndefined();
  });

  it("geocodificarEndereco lança → undefined (não propaga a exceção)", async () => {
    geocodificarEndereco.mockRejectedValue(new Error("timeout nominatim"));
    await expect(distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000")).resolves.toBeUndefined();
  });

  it("haversine lança → undefined (não propaga a exceção)", async () => {
    haversine.mockImplementation(() => { throw new Error("NaN coords"); });
    await expect(distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000")).resolves.toBeUndefined();
  });

  // ── Borda: distância zero (pontos idênticos) retornada sem transformação ──

  it("haversine retorna 0 (loja = cliente) → retorna 0, não undefined", async () => {
    haversine.mockReturnValue(0);
    const r = await distanciaDaLojaAoCep(svc, LOJA_ID, "01000-000");
    expect(r).toBe(0);
  });
});
