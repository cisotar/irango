// Função PURA de cálculo do valor do desconto de um cupom sobre as BASES do
// carrinho (227 — D5, D5-a, D9). Dois números com papéis distintos:
//   - `subtotal`     → régua do pedido_minimo (D5-a), nunca a base do cálculo;
//   - `baseElegivel` → base do percentual E teto do clamp (D5/D9): só o que
//                      NÃO recebeu desconto de produto. Cupom não acumula.
// Validade temporal/ativo/usos/escopo de loja são do caller (Server Action
// 013 validarCupom), que recalcula no servidor.
import type { Tables } from "@/lib/database.types";
import { arredondar } from "./arredondar";

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

/** Marca de origem de `BasesDesconto`. `declare` ⇒ não existe em runtime e não
 *  é exportada: nenhum módulo consegue escrever esta propriedade. É o que torna
 *  `derivarBasesCupom` o ÚNICO produtor das bases — um literal
 *  `{ subtotal, baseElegivel: subtotal }` deixa de compilar, em vez de depender
 *  de um comentário `TEMP` que alguém pode esquecer de trocar. */
declare const marcaBases: unique symbol;

/** As duas bases do carrinho, derivadas no servidor por `derivarBasesCupom`.
 *  Objeto NOMEADO de propósito (RN-09): dois `number` posicionais adjacentes
 *  trocados de ordem compilam, passam no `tsc` e descontam o valor errado.
 *  MARCADO de propósito: só `derivarBasesCupom` produz um valor deste tipo. */
export interface BasesDesconto {
  /** soma cobrada do carrinho — régua do pedido_minimo (D5-a). */
  subtotal: number;
  /** parcela que não recebeu desconto de produto — base e teto (D5/D9). */
  baseElegivel: number;
  /** marca inconstruível — ver `marcaBases`. */
  readonly [marcaBases]: true;
}

export interface ResultadoDesconto {
  /** "passou no gate de pedido_minimo" — NUNCA "descontou dinheiro" (D-4). */
  aplicado: boolean;
  /** valor do desconto arredondado; 0 quando !aplicado; ∈ [0, baseElegivel]. */
  desconto: number;
  /** por que não aplicou (ex.: 'pedido_minimo'); null quando aplicado. */
  motivo: string | null;
  /** eco de `bases.baseElegivel` nos DOIS ramos: descreve a base, não o
   *  veredito — o caller explica um desconto zero sem refazer a conta (D-4). */
  baseElegivel: number;
}

export function calcularDesconto(
  cupom: CupomCalculo,
  bases: BasesDesconto,
): ResultadoDesconto {
  // Guard fail-closed (D-5): uma comparação cobre NaN (toda comparação com NaN
  // é falsa), base negativa e base maior que o subtotal — impossível por
  // construção; se acontecer é bug de montagem, não estado de negócio. Sem
  // isso, NaN viraria `desconto: NaN` → `p_desconto: null` na RPC, em silêncio.
  // `Number.isFinite(subtotal)` fecha o único buraco que a comparação deixava:
  // com subtotal Infinity, `Infinity <= Infinity` é true e o percentual sairia
  // `Infinity` → `total: NaN` → `p_desconto: null`, exatamente o que o guard
  // existe para impedir. Finito o subtotal, `0 <= base <= subtotal` já obriga
  // a base a ser finita.
  if (
    !(
      Number.isFinite(bases.subtotal) &&
      bases.baseElegivel >= 0 &&
      bases.baseElegivel <= bases.subtotal
    )
  ) {
    throw new Error("calcularDesconto: bases invalidas");
  }

  // D5-a: a régua do pedido mínimo é o SUBTOTAL, nunca a base elegível.
  if (bases.subtotal < cupom.pedido_minimo) {
    return {
      aplicado: false,
      desconto: 0,
      motivo: "pedido_minimo",
      baseElegivel: bases.baseElegivel,
    };
  }

  const bruto =
    cupom.tipo === "percentual"
      ? arredondar((bases.baseElegivel * cupom.valor) / 100)
      : cupom.valor;

  // Clamp nos dois lados: piso 0 (cupom com valor negativo não vira acréscimo)
  // e teto na BASE ELEGÍVEL (D5/RN-10-b) — com o teto no subtotal, um cupom
  // fixo comeria o desconto do produto de novo.
  const desconto = Math.min(Math.max(bruto, 0), bases.baseElegivel);

  return {
    aplicado: true,
    desconto,
    motivo: null,
    baseElegivel: bases.baseElegivel,
  };
}
