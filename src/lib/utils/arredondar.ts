// Aritmética de arredondamento monetário do projeto — UMA implementação, usada
// por todo cálculo de valor (calcularTotal 012, precoEfetivo 223). Extraída de
// calcularTotal.ts para que nenhum consumidor novo escreva uma segunda cópia.

/** Arredonda a 2 casas evitando float drift (ex.: 0.1 + 0.2). */
export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
