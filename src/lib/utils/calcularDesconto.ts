// Função PURA de cálculo do valor do desconto de um cupom sobre um subtotal.
// Responsabilidade limitada ao CÁLCULO (percentual/fixo, clamp ao subtotal,
// arredondamento, pedido_minimo). Validade temporal/ativo/usos/escopo de loja
// são do caller (Server Action 013 validarCupom), que recalcula no servidor.
import type { Tables } from "@/lib/database.types";

/**
 * Campos do cupom necessários ao CÁLCULO do valor do desconto.
 * `tipo` estreitado ao enum do schema (cupons.tipo CHECK IN ('percentual','fixo')).
 *
 * Deliberadamente NÃO inclui ativo/expira_em/usos_maximos/usos_contagem/loja_id:
 * validade temporal, limite de uso e escopo de loja são do caller / Server Action
 * 013 (validarCupom), que recalcula no servidor e não confia no cliente.
 */
export type CupomCalculo = Pick<Tables<"cupons">, "valor" | "pedido_minimo"> & {
  tipo: "percentual" | "fixo";
};

export interface ResultadoDesconto {
  /** false = cupom não atingiu o pedido_minimo; checar antes de usar `desconto`. */
  aplicado: boolean;
  /** valor do desconto em centavos arredondado; 0 quando !aplicado; nunca > subtotal. */
  desconto: number;
  /** por que não aplicou (ex.: 'pedido_minimo'); null quando aplicado. */
  motivo: string | null;
}

export function calcularDesconto(
  cupom: CupomCalculo,
  subtotal: number,
): ResultadoDesconto {
  if (subtotal < cupom.pedido_minimo) {
    return { aplicado: false, desconto: 0, motivo: "pedido_minimo" };
  }

  const bruto =
    cupom.tipo === "percentual"
      ? Math.round(((subtotal * cupom.valor) / 100) * 100) / 100
      : cupom.valor;

  // Clamp nos dois lados: piso 0 (cupom com valor negativo não vira acréscimo)
  // e teto no subtotal (desconto nunca deixa o total negativo).
  const desconto = Math.min(Math.max(bruto, 0), subtotal);

  return { aplicado: true, desconto, motivo: null };
}
