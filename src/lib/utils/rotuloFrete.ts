// Rótulo do frete quando ele NÃO é um número (issue 180-B).
//
// REGRA QUE NÃO PODE CAIR: a etiqueta "a combinar" vem de `frete_a_combinar`,
// NUNCA de `taxa_entrega === 0` — zero é frete GRÁTIS legítimo, e confundir os
// dois faria a loja entregar de graça um pedido cujo frete ainda seria cobrado
// (ou o contrário). O banco amarra o par pelo CHECK
// `chk_pedidos_frete_a_combinar` (a combinar ⟺ taxa_entrega IS NULL).
//
// Módulo NEUTRO (sem 'use client'/'use server'): é consumido pela tela de
// confirmação (vitrine), pelo detalhe e pelo recibo do painel e pelo texto do
// WhatsApp, para que os quatro digam a MESMA coisa.

/** Texto completo — telas com espaço (confirmação, detalhe do pedido). */
export const ROTULO_FRETE_A_COMBINAR = "A combinar com a loja";
/** Texto curto — linhas estreitas (recibo térmico, mensagem do WhatsApp). */
export const ROTULO_FRETE_A_COMBINAR_CURTO = "A combinar";

type PedidoComFrete = {
  taxa_entrega: number | null;
  frete_a_combinar: boolean;
};

/**
 * `true` quando o frete é um VALOR conhecido e pode ser formatado como moeda.
 * Type predicate: estreita `taxa_entrega` para `number`, então um consumidor
 * novo não consegue renderizar `R$ 0,00`/`NaN` num pedido a combinar sem o
 * compilador reclamar.
 *
 * `taxa_entrega == null` também cai no lado "a combinar" por defesa em
 * profundidade: uma linha legada/órfã com NULL nunca deve virar R$ 0,00.
 */
export function freteConhecido<T extends PedidoComFrete>(
  pedido: T,
): pedido is T & { taxa_entrega: number } {
  return !pedido.frete_a_combinar && pedido.taxa_entrega != null;
}
