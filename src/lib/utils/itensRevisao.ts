// [237/238] A fronteira entre o carrinho do cliente e `revisarCarrinhoAction`.
//
// PURA e testável: só ids e quantidades atravessam (seguranca.md §10 / RN-11).
// Nenhum preço, nenhum subtotal — os números da revisão são todos DERIVADOS do
// banco dentro da Server Action.

import type { ItemRevisao } from "@/lib/actions/revisarCarrinho-contrato";
import type { ItemCarrinho } from "@/types/dominio";

/** Carrinho → payload da revisão. A ORDEM é preservada: é ela que pareia cada
 *  linha revisada com a linha exibida (`detectarMudancasDePreco`). */
export function itensParaRevisao(
  itens: readonly ItemCarrinho[],
): ItemRevisao[] {
  return itens.map((item) => {
    const opcionais = (item.opcionais ?? []).filter((o) => o.quantidade > 0);
    return {
      produto_id: item.produtoId,
      quantidade: item.quantidade,
      ...(opcionais.length > 0
        ? {
            opcionais: opcionais.map((o) => ({
              opcional_id: o.opcionalId,
              quantidade: o.quantidade,
            })),
          }
        : {}),
    };
  });
}

/**
 * Assinatura do conteúdo do carrinho (ids + quantidades + opcionais). Serve de
 * chave de dedupe da revisão automática: sem ela, cada render dispararia uma
 * chamada nova e o rate limit por IP (compartilhado com o cupom) estouraria
 * por conta de UX.
 */
export function assinaturaCarrinho(itens: readonly ItemCarrinho[]): string {
  return JSON.stringify(itensParaRevisao(itens));
}
