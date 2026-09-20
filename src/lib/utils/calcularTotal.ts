// Aritmética autoritativa de valor do pedido (012 / 226). Tipos via
// Pick<Tables<...>> — o preço vem do banco, nunca do cliente.
import type { Tables } from "@/lib/database.types";
import { arredondar } from "./arredondar";

/** Um opcional (adicional/extra) de um item do pedido. */
export interface OpcionalCalculo {
  preco: number;
  quantidade: number;
}

/** Subconjunto de itens_pedido que entra no cálculo: preço (snapshot do banco,
 *  autoritativo) × quantidade (int > 0). Nada vindo do cliente é confiável.
 *  Opcionais (adicionais) são POR LINHA do item (090): somam UMA vez, sem
 *  multiplicar pela quantidade do produto. Só o preço do produto é multiplicado
 *  pela qtd: (preco × qtd_item) + Σ(opcional.preco × opcional.qtd). */
export type ItemCalculo = Pick<Tables<"itens_pedido">, "preco" | "quantidade"> & {
  opcionais?: OpcionalCalculo[];
};

/** Componentes JÁ RESOLVIDOS no servidor (desconto de 009, frete de 008). */
export interface ComponentesTotal {
  subtotal: number;
  desconto: number;
  taxaEntrega: number;
}

export interface ResultadoTotal {
  subtotal: number;
  desconto: number;
  taxaEntrega: number;
  /** max(0, subtotal − desconto) + taxaEntrega; 2 casas; nunca negativo. */
  total: number;
}

/** Total COBRADO de uma linha do pedido: (preco × qtd) + Σ(opcional.preco ×
 *  opcional.qtd). Opcional soma UMA vez por linha (090), sem multiplicar pela
 *  quantidade do produto. Invariante: Σ totalDaLinha === calcularSubtotal. */
export function totalDaLinha({
  preco,
  quantidade,
  opcionais,
}: ItemCalculo): number {
  const somaOpcionais = (opcionais ?? []).reduce(
    (s, op) => s + arredondar(op.preco * op.quantidade),
    0,
  );
  // Opcional é por linha (090): qtd do produto multiplica só o preço do
  // produto; os opcionais somam UMA vez, fora dessa multiplicação.
  return arredondar(arredondar(preco * quantidade) + somaOpcionais);
}

export function calcularSubtotal(itens: ItemCalculo[]): number {
  // Expressa em termos de totalDaLinha para que a invariante
  // `Σ totalDaLinha === calcularSubtotal` seja estrutural, não coincidência.
  return arredondar(itens.reduce((acc, item) => acc + totalDaLinha(item), 0));
}

export function calcularTotal({
  subtotal,
  desconto,
  taxaEntrega,
}: ComponentesTotal): ResultadoTotal {
  // Desconto incide só no subtotal e nunca leva a negativo: clamp em 0 ANTES
  // de somar o frete (frete jamais é descontado).
  const baseSemFrete = Math.max(0, subtotal - desconto);
  const total = arredondar(baseSemFrete + taxaEntrega);
  return { subtotal, desconto, taxaEntrega, total };
}
