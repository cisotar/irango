// [238/D11] Quais linhas mudaram de preço entre o carrinho e o envio.
//
// Módulo NEUTRO e PURO (sem 'use client'/'use server'): é a única peça entre a
// resposta de `revisarCarrinhoAction` e as duas telas de D11 (diálogo do
// "subiu", faixa do "caiu"), e sem jsdom só ela é testável.
//
// 🛑 Não calcula dinheiro. Os dois lados da comparação já são números PRONTOS:
// `precoExibido` é o preço EFETIVO que a vitrine gravou no carrinho no momento
// da adição (`useCarrinho`, que guarda só o efetivo — RN-12), e `precoEfetivo`
// é o preço do banco NAQUELE instante, devolvido pela Server Action. Comparar
// dois números do servidor para decidir o que EXIBIR não é recalcular regra
// monetária: nenhum total sai daqui.

import type { LinhaRevisada } from "@/lib/actions/revisarCarrinho-contrato";
import type { MudancaItem } from "@/lib/utils/copiaRevisaoPreco";

/** O que a tela mostrou para uma linha do carrinho. */
export type LinhaExibida = {
  nome: string;
  /** preço unitário efetivo exibido ao cliente (carrinho). */
  precoExibido: number;
};

/**
 * Uma linha mudada CARREGA O ÍNDICE dela no carrinho. É esse índice que o
 * segundo clique usa para limpar `promocaoExibida` SÓ das linhas que o diálogo
 * mostrou (achado do `auditar`): zerar a flag de todas desarmaria a trava do
 * servidor para um item cuja promoção terminou DEPOIS de o diálogo abrir.
 */
export type LinhaMudada = MudancaItem & { indice: number };

export type MudancasDePreco = {
  /** Cliente pagaria MAIS do que viu ⇒ reconfirmação explícita. */
  subiram: LinhaMudada[];
  /** Cliente paga MENOS do que viu ⇒ só avisa, o pedido segue. */
  cairam: LinhaMudada[];
};

/** Identidade estável: entra em dep array de efeito/memo sem disparar render. */
export const SEM_MUDANCAS: MudancasDePreco = { subiram: [], cairam: [] };

/**
 * Pareia POR ÍNDICE: `revisarCarrinhoAction` devolve uma linha por item
 * enviado, na mesma ordem, e duas linhas do mesmo produto (opcionais ou
 * observação diferentes) são itens distintos. Casar por `produto_id` fundiria
 * essas linhas e nomearia a errada. Tamanhos divergentes ⇒ nada é afirmado.
 */
export function detectarMudancasDePreco(
  exibidas: readonly LinhaExibida[],
  revisadas: readonly LinhaRevisada[],
): MudancasDePreco {
  if (exibidas.length !== revisadas.length) return SEM_MUDANCAS;

  const subiram: LinhaMudada[] = [];
  const cairam: LinhaMudada[] = [];

  for (const [i, exibida] of exibidas.entries()) {
    const agora = revisadas[i].precoEfetivo;
    if (agora === exibida.precoExibido) continue;
    const mudanca: LinhaMudada = {
      indice: i,
      nome: exibida.nome,
      de: exibida.precoExibido,
      para: agora,
    };
    if (agora > exibida.precoExibido) subiram.push(mudanca);
    else cairam.push(mudanca);
  }

  return { subiram, cairam };
}
