// Função PURA: decide SE o cupom pode ser usado (ativo / expira / usos / mínimo).
// Cálculo do VALOR do desconto é de calcularDesconto (009). `agora` é injetado
// para tornar a expiração determinística no teste.
//
// Ordem de checagem deliberada: o motivo SEGURO ("invalido") tem precedência
// sobre o revelável ("pedido_minimo") para a action não virar oráculo de
// existência (anti-enumeração — seguranca.md §6).
import type { Tables } from "@/lib/database.types";

export type MotivoInvalido = "invalido" | "pedido_minimo";

export type CupomUso = Pick<
  Tables<"cupons">,
  "ativo" | "expira_em" | "usos_maximos" | "usos_contagem" | "pedido_minimo"
>;

export interface ResultadoUso {
  valido: boolean;
  motivo: MotivoInvalido | null;
}

export function validarUsoCupom(
  cupom: CupomUso,
  subtotal: number,
  agora: Date,
): ResultadoUso {
  // (1) inativo → motivo seguro
  if (!cupom.ativo) {
    return { valido: false, motivo: "invalido" };
  }

  // (2) expirado (expira_em <= agora esgota; comparação inclusiva)
  if (
    cupom.expira_em != null &&
    new Date(cupom.expira_em).getTime() <= agora.getTime()
  ) {
    return { valido: false, motivo: "invalido" };
  }

  // (3) usos esgotados (usos_maximos null = ilimitado)
  if (cupom.usos_maximos != null && cupom.usos_contagem >= cupom.usos_maximos) {
    return { valido: false, motivo: "invalido" };
  }

  // (4) abaixo do pedido mínimo → único motivo revelável (mínimo é inclusivo)
  if (subtotal < cupom.pedido_minimo) {
    return { valido: false, motivo: "pedido_minimo" };
  }

  return { valido: true, motivo: null };
}
