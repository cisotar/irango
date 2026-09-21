// [262/design §13.7] Quais linhas do carrinho o servidor recusa AGORA.
//
// Módulo NEUTRO e PURO (sem 'use client'/'use server'), irmão de
// `mudancasDePreco.ts`: é a única peça entre a resposta de
// `revisarCarrinhoAction` e as duas telas do checkout, e sem jsdom só ela é
// testável.
//
// 🛑 Não decide comprabilidade e não avalia janela nenhuma: `compravel` e
// `motivoNaoCompravel` chegam DECIDIDOS do servidor (252/RN-06), pela mesma
// `avaliarVigenciaDoProduto` que o SSR da vitrine e `criarPedido` usam. Aqui só
// se pareia a linha revisada com a linha exibida, para nomear o produto certo.
//
// 🛑 Não calcula dinheiro: o subtotal que a tela mostra já vem do servidor SEM
// a linha bloqueada (252). Nada é somado nem subtraído deste lado.

import type { LinhaRevisada } from "@/lib/actions/revisarCarrinho-contrato";
import type { MotivoNaoCompravel } from "@/lib/utils/catalogoVitrine";

/** Uma linha do carrinho que o servidor não aceita neste instante. */
export type ItemBloqueado = {
  /** Índice no carrinho — é por ele que a `EtapaItens` marca a linha certa. */
  indice: number;
  nome: string;
  motivo: MotivoNaoCompravel | null;
};

/** Identidade estável: entra em dep array de efeito/memo sem disparar render. */
export const SEM_BLOQUEIOS: readonly ItemBloqueado[] = [];

/**
 * Pareia POR ÍNDICE, pelo mesmo motivo de `detectarMudancasDePreco`:
 * `revisarCarrinhoAction` devolve uma linha por item enviado, na mesma ordem, e
 * duas linhas do mesmo produto (opcionais ou observação diferentes) são itens
 * distintos. Casar por `produto_id` fundiria essas linhas e marcaria a errada.
 *
 * Tamanhos divergentes ⇒ NADA é afirmado. A trava dura é a Server Action
 * (`criarPedido` recusa o item não comprável de qualquer forma, RN-08); esta é
 * a cortesia de UI, e cortesia baseada em pareamento duvidoso é pior que
 * nenhuma — riscaria o preço da linha errada.
 */
export function detectarItensBloqueados(
  nomes: readonly string[],
  revisadas: readonly LinhaRevisada[],
): ItemBloqueado[] {
  if (nomes.length !== revisadas.length) return [];

  const bloqueados: ItemBloqueado[] = [];
  for (const [indice, nome] of nomes.entries()) {
    const linha = revisadas[indice];
    if (linha.compravel) continue;
    bloqueados.push({ indice, nome, motivo: linha.motivoNaoCompravel });
  }
  return bloqueados;
}

/**
 * O anúncio ÚNICO do topo da etapa (design §13.7, item 5): uma `aria-live`
 * para a etapa inteira, em vez de cada linha gritar sozinha.
 *
 * Sem "erro", sem "desculpe", sem vermelho: o produto saiu de temporada ou
 * acabou — não é falha e não é culpa do cliente (design §13.7, item 2).
 */
export function anuncioItensBloqueados(quantos: number): string {
  if (quantos <= 0) return "";
  return quantos === 1
    ? "1 item não está disponível agora e precisa ser removido."
    : `${quantos} itens não estão disponíveis agora e precisam ser removidos.`;
}
