// Apresentação de pedido — rótulos e normalizações compartilhados (refactor DRY,
// findings 133/134). Extraído das cópias idênticas em DetalhePedido, ComandaCozinha
// e ReciboCliente: um único ponto para o vocabulário de exibição do pedido.
//
// Puramente apresentacional e sem I/O: apenas mapeia valores do SNAPSHOT já
// carregado (RN-O6) para o texto/shape que a UI consome. NÃO recalcula valor,
// NÃO busca o produto atual e NÃO decide permissão — isso é do servidor/caller.

import type { ItemPedidoOpcional } from "@/lib/supabase/queries/pedidos";
import type { OpcionalExibicao } from "@/components/vitrine/ListaOpcionaisItem";

/** Rótulo humano da forma de pagamento gravada no pedido. Fallback: o valor cru. */
export const ROTULO_FORMA_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
  cartao: "Cartão",
};

/** Rótulo humano do tipo de entrega gravado no pedido. Fallback: o valor cru. */
export const ROTULO_TIPO_ENTREGA: Record<string, string> = {
  retirada: "Retirada",
  entrega: "Entrega",
};

/** Só o bairro interessa às vias impressas. */
type EnderecoResumo = { bairro?: string };

/**
 * Narrowing mínimo do `Json | null` do endereço para exibição — devolve o bairro
 * como string não-vazia ou `null`. Não confia no shape do JSON gravado.
 */
export function lerBairro(valor: unknown): string | null {
  if (valor == null || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  const { bairro } = valor as EnderecoResumo;
  return typeof bairro === "string" && bairro.length > 0 ? bairro : null;
}

/**
 * Normaliza os opcionais-snapshot de um item (`nome_snapshot`/`preco_snapshot`)
 * para o shape `OpcionalExibicao` que `ListaOpcionaisItem` consome. Apenas
 * renomeia campos — nunca recalcula valor a partir do produto atual (RN-O6).
 */
export function mapearOpcionaisExibicao(
  opcionais: ItemPedidoOpcional[],
): OpcionalExibicao[] {
  return opcionais.map((opcional) => ({
    id: opcional.id,
    nome: opcional.nome_snapshot,
    preco: opcional.preco_snapshot,
    quantidade: opcional.quantidade,
  }));
}
