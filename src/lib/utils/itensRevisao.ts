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

/**
 * Atraso do debounce da revisão automática (achado do `auditar`). Sem ele,
 * subir dois itens para 10 unidades gastava 18 requests: a dedupe é por
 * CONTEÚDO, não por tempo, e cada clique no `+` é conteúdo novo. 500 ms é o
 * intervalo em que o dedo ainda está no botão.
 */
export const ATRASO_REVISAO_MS = 500;

/**
 * Chave de uma revisão: conteúdo do carrinho + código de cupom. O código entra
 * porque revisar o MESMO carrinho com e sem cupom são duas respostas
 * diferentes — e porque, sem ele, aplicar um cupom recém-validado disparava uma
 * segunda chamada idêntica à que acabara de voltar.
 */
export function chaveRevisao(
  itens: readonly ItemCarrinho[],
  codigo?: string | null,
): string {
  return `${assinaturaCarrinho(itens)}|${codigo ?? ""}`;
}

/**
 * A revisão só é FRESCA quando foi calculada para o carrinho/cupom de AGORA.
 * Números do servidor casados com um carrinho que já mudou são dado velho: é
 * deles que vinha o total errado no diálogo de reconfirmação.
 */
export function revisaoFrescaDe<T>(
  entrada: { chave: string; dados: T } | null,
  chaveAtual: string,
): T | null {
  return entrada != null && entrada.chave === chaveAtual ? entrada.dados : null;
}
