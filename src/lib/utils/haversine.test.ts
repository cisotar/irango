import { describe, it, expect } from "vitest";
// RED (issue 002, crítica): este módulo ainda NÃO existe — a fase GREEN
// (executar) cria src/lib/utils/haversine.ts com a função pura.
//
// RESPONSABILIDADE DA FUNÇÃO PURA: dado dois pares (lat, lng) em graus decimais,
// retornar a distância em linha reta em km (fórmula de haversine, R=6371).
// Determinística, sem I/O. Pontos iguais → 0. Insumo de calcularFrete (RN-8).
// Validação de coords é do caller server-side (issue 003) — não é testada aqui.
import { haversine } from "./haversine";

describe("haversine", () => {
  it("retorna 0 quando os dois pontos são idênticos", () => {
    // Praça da Sé, São Paulo (hemisfério sul/oeste). Não pode dar NaN por float.
    expect(haversine(-23.5505, -46.6333, -23.5505, -46.6333)).toBeCloseTo(0, 9);
  });

  it("retorna distância conhecida entre dois pontos reais de São Paulo", () => {
    // Praça da Sé (-23.5505, -46.6333) ↔ MASP (-23.5614, -46.6559).
    // Esperado ≈ 2.603 km (calculado pela própria fórmula de haversine, R=6371).
    const dist = haversine(-23.5505, -46.6333, -23.5614, -46.6559);
    expect(dist).toBeCloseTo(2.603, 2); // tolerância ~0.005 km
  });

  it("é simétrica: haversine(A,B) === haversine(B,A)", () => {
    const ab = haversine(-23.5505, -46.6333, -23.5614, -46.6559);
    const ba = haversine(-23.5614, -46.6559, -23.5505, -46.6333);
    expect(ab).toBe(ba);
  });

  it("funciona com coordenadas negativas (hemisfério sul/oeste)", () => {
    // São Paulo (-23.55, -46.63) ↔ Rio de Janeiro (-22.91, -43.17) ≈ 360 km.
    const dist = haversine(-23.55, -46.63, -22.91, -43.17);
    expect(dist).toBeCloseTo(360.6, 1);
  });

  // Bordas adicionadas — pegam bugs reais de implementação da fórmula:

  it("equador (lat=0): cos(0)=1 não afeta o cálculo — quarto de círculo ≈ 10007 km", () => {
    // Se Math.cos(rad(latA)) fosse esquecido na fórmula, este caso erraria.
    // 90° de longitude no equador = 2πR/4 exato.
    const dist = haversine(0, 0, 0, 90);
    expect(dist).toBeCloseTo(10007.54, 1);
  });

  it("polo Norte ao polo Sul ≈ 20015 km (metade da circunferência)", () => {
    // Verifica que atan2 não satura nem retorna NaN para a distância máxima.
    const dist = haversine(90, 0, -90, 0);
    expect(dist).toBeCloseTo(20015.09, 1);
  });

  it("antípodas no equador: (0,0) ↔ (0,180) ≈ 20015 km, sem NaN", () => {
    // sin(dLat/2)=0 e cos²(lat)·sin(dLng/2)²=1 → a=1 → atan2(1,0)=π/2 → c=π.
    // Bug clássico: sqrt(1-a) vira sqrt(0) ou negativo por float → NaN.
    const dist = haversine(0, 0, 0, 180);
    expect(Number.isFinite(dist)).toBe(true);
    expect(dist).toBeCloseTo(20015.09, 1);
  });

  it("hemisférios opostos (Paris, Norte+Oeste ↔ Sydney, Sul+Leste) — não NaN", () => {
    // Mistura de sinais garante que cos(latA) e cos(latB) são ambos positivos (em graus abs < 90).
    const dist = haversine(48.8566, 2.3522, -33.8688, 151.2093);
    expect(Number.isFinite(dist)).toBe(true);
    expect(dist).toBeCloseTo(16960, 0); // ±1 km de tolerância
  });
});
