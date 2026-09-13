// Montagem do payload de zona de entrega (issue 183) — módulo PURO, sem React.
// Converte o estado do `FormZona` (strings de input) na forma que
// `schemaZonaCompleta` valida. Vive fora do componente porque `FormZona.tsx` é
// 'use client' e a suíte roda `environment: node` (sem jsdom): a regra de
// montagem — onde o bug da faixa de CEP vivia — precisa ser testável.
//
// FORA DAQUI: validação (schemaZonaCompleta), persistência (Server Actions),
// match de zona por endereço (calcularFrete).
import { limparCep } from "@/lib/utils/buscarCep";

export type EntradaPayloadZona = {
  nome: string;
  tipo: "bairro" | "raio_km" | "faixa_cep";
  ativo: boolean;
  taxa: string;
  pedidoMinimoGratis: string;
  raioMaxKm: string;
  cepInicio: string;
  cepFim: string;
  bairros: string[];
};

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

/**
 * Payload de zona a partir do estado do form. Zera por tipo (mesma disciplina
 * já aplicada a `raio_max_km` e `bairros`): trocar o tipo na edição não deixa
 * faixa órfã — o `superRefine` de `schemaZonaCompleta` reprovaria.
 */
export function montarPayloadZona(entrada: EntradaPayloadZona) {
  const ehFaixaCep = entrada.tipo === "faixa_cep";
  return {
    nome: entrada.nome.trim(),
    tipo: entrada.tipo,
    ativo: entrada.ativo,
    taxa: {
      taxa: paraNumero(entrada.taxa) ?? 0,
      pedido_minimo_gratis: paraNumero(entrada.pedidoMinimoGratis),
      raio_max_km:
        entrada.tipo === "raio_km" ? paraNumero(entrada.raioMaxKm) : null,
      cep_inicio: ehFaixaCep ? cepParaInteiro(entrada.cepInicio) : null,
      cep_fim: ehFaixaCep ? cepParaInteiro(entrada.cepFim) : null,
    },
    bairros: entrada.tipo === "bairro" ? entrada.bairros : [],
  };
}
