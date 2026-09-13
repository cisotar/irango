// STUB TDD (issue 183) — assinaturas apenas, para o type-check compilar e a
// fase RED falhar por ASSERÇÃO. A implementação real é da fase GREEN
// (`executar`): mover `paraNumero` do FormZona.tsx e escrever a conversão
// máscara ↔ inteiro de 8 dígitos + a montagem do payload por tipo de zona.

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
export function paraNumero(_valor: string): number | null {
  throw new Error("TODO: GREEN");
}

/** CEP mascarado ("01000-000") → inteiro de 8 dígitos (1000000). Exige 8 dígitos. */
export function cepParaInteiro(_cep: string): number | null {
  throw new Error("TODO: GREEN");
}

/** Inteiro (1000000) → máscara ("01000-000"), repadronizando o zero à esquerda. */
export function cepInteiroParaMascara(_valor: number | null): string {
  throw new Error("TODO: GREEN");
}

export function montarPayloadZona(_entrada: EntradaPayloadZona): unknown {
  throw new Error("TODO: GREEN");
}
