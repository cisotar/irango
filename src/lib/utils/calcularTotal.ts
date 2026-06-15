// STUB TDD — implementação real é da fase GREEN (executar). Só a assinatura
// existe para que o type-check compile e o RED falhe nas ASSERÇÕES (e não em
// ERR_MODULE_NOT_FOUND, que mascararia os casos). Tipos via Pick<Tables<...>>.
import type { Tables } from "@/lib/database.types";

/** Um opcional (adicional/extra) de um item do pedido. */
export interface OpcionalCalculo {
  preco: number;
  quantidade: number;
}

/** Subconjunto de itens_pedido que entra no cálculo: preço (snapshot do banco,
 *  autoritativo) × quantidade (int > 0). Nada vindo do cliente é confiável.
 *  Opcionais (adicionais) somam ao preço do produto ANTES de multiplicar pela
 *  quantidade do item: (preco + Σ opcional.preco×opcional.qtd) × qtd_item. */
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

/** Arredonda a 2 casas evitando float drift (ex.: 0.1 + 0.2). */
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function calcularSubtotal(itens: ItemCalculo[]): number {
  const subtotal = itens.reduce((acc, { preco, quantidade, opcionais }) => {
    const somaOpcionais = opcionais
      ? opcionais.reduce(
          (s, op) => s + arredondar(op.preco * op.quantidade),
          0,
        )
      : 0;
    const precoItem = arredondar(preco + somaOpcionais);
    return acc + arredondar(precoItem * quantidade);
  }, 0);
  return arredondar(subtotal);
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
