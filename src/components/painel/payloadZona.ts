// Conversões de input de zona de entrega (issue 183) — módulo PURO, sem React,
// testável no `environment: node`: moeda BR → número e CEP mascarado ↔
// inteiro de 8 dígitos (o formato de `taxas_entrega.cep_*`).
//
// FORA DAQUI: validação (schemaZonasEntrega), persistência (Server Actions),
// match de zona por endereço (calcularFrete).
import { limparCep } from "@/lib/utils/buscarCep";

/** Converte string de moeda BR (vírgula) para número; vazio → null. */
export function paraNumero(valor: string): number | null {
  const limpo = valor.replace(",", ".").trim();
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isNaN(n) ? null : n;
}

/** CEP mascarado ("01000-000") → inteiro de 8 dígitos (1000000). Exige 8 dígitos. */
export function cepParaInteiro(cep: string): number | null {
  const digitos = limparCep(cep);
  if (digitos.length !== 8) return null;
  // `Number("01000000") === 1000000`: o zero à esquerda some, e é assim que
  // `calcularFrete` normaliza o CEP do cliente — a comparação fica consistente.
  return Number(digitos);
}

/** Inteiro (1000000) → máscara ("01000-000"), repadronizando o zero à esquerda. */
export function cepInteiroParaMascara(valor: number | null): string {
  if (valor == null) return "";
  const digitos = String(valor).padStart(8, "0");
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}
