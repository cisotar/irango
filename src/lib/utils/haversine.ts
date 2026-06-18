/**
 * Distância em quilômetros, em linha reta, entre dois pontos geográficos
 * (fórmula de haversine). PURA, sem I/O — recebe graus decimais, retorna km.
 * R = 6371 (raio médio da Terra). Insumo de `calcularFrete` (raio_km) — RN-8.
 * Determinística: mesma entrada → mesma saída. Pontos iguais → 0.
 * NÃO arredonda o resultado — o arredondamento é decisão do caller.
 */
export function haversine(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number {
  const R = 6371;
  const rad = (g: number): number => (g * Math.PI) / 180;
  const dLat = rad(latB - latA);
  const dLng = rad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
