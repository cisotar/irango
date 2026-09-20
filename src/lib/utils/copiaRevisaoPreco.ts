/**
 * Copy da RECONFIRMAÇÃO DE PREÇO (issue 238, D11). Pura (M5): sem React, sem
 * DOM, sem I/O — mesma forma de `ModalFreteIndisponivel.textos()`, e afirmável
 * byte a byte em `environment: node`.
 *
 * ─────────────────────────────────────────── A regra de tom, nos DOIS sentidos
 * 🔴 **Nenhuma linguagem de erro.** Sem "erro", "falha", "desculpe", "não foi
 * possível", sem ícone de alerta, sem vermelho, sem `role="alert"`. A promoção
 * acabou porque o lojista marcou uma data: não é culpa do cliente e não é
 * defeito do sistema. O precedente do projeto é `ModalFreteIndisponivel`, que
 * nunca culpa o cliente pelo que não é dele.
 *
 * ─────────────────────────────────────────── Os dois sentidos de D11
 * - **subiu** ⇒ diálogo com de/para, novo total e SEGUNDO CLIQUE explícito. O
 *   número vai DENTRO do rótulo do CTA: "segundo clique explícito" só
 *   significa alguma coisa se o clique for sobre o número novo.
 * - **caiu** ⇒ faixa de aviso, sem botão e sem bloqueio. Travar um pedido para
 *   confirmar um desconto que o cliente não pediu é atrito sem contrapartida.
 *
 * ─────────────────────────────────────────── Nada é calculado aqui
 * `de`, `para` e `novoTotal` chegam prontos: os preços vêm de
 * `revisarCarrinhoAction` (banco) e o total é o mesmo preview que o resumo já
 * exibe. Este módulo só formata.
 */

import { formatarMoeda } from "./formatarMoeda";

/** Uma linha que mudou de preço entre o carrinho e o envio. */
export type MudancaItem = {
  nome: string;
  /** preço que a tela MOSTROU. */
  de: number;
  /** preço do banco AGORA. */
  para: number;
};

export type DirecaoRevisao = "subiu" | "caiu";

export type TextosRevisao = {
  titulo: string;
  corpo: string;
  /** `null` ⇒ não há segundo clique: o sentido "caiu" não pede nada. */
  rotuloCta: string | null;
};

/** Rótulo do total novo — `--cor-destaque` no componente (é preço, não estado). */
export const ROTULO_NOVO_TOTAL = "Novo total estimado";

/** Saída reversível do diálogo: fechar NUNCA é sinônimo de confirmar. */
export const ROTULO_VOLTAR = "Voltar ao carrinho";

/**
 * O par de/para em UMA frase, para o `sr-only` de cada item da lista: `<s>`
 * sozinho não comunica (mesmo motivo do `PrecoProduto`).
 */
export function descricaoMudanca(item: MudancaItem): string {
  return `${item.nome}: de ${formatarMoeda(item.de)} por ${formatarMoeda(item.para)}`;
}

export function textosRevisao(d: {
  direcao: DirecaoRevisao;
  itens: readonly MudancaItem[];
  novoTotal: number;
}): TextosRevisao {
  const um = d.itens.length === 1 ? d.itens[0] : null;

  if (d.direcao === "subiu") {
    return {
      titulo: "O preço de um item mudou",
      corpo: um
        ? `A promoção da ${um.nome} terminou.`
        : `As promoções de ${d.itens.length} itens do seu pedido terminaram.`,
      // O número DENTRO do rótulo: é o valor que a pessoa está aceitando, no
      // lugar onde o dedo encosta.
      rotuloCta: `Confirmar e enviar — ${formatarMoeda(d.novoTotal)}`,
    };
  }

  return {
    titulo: um
      ? `Boa notícia: a ${um.nome} entrou em promoção.`
      : `Boa notícia: ${d.itens.length} itens do seu pedido entraram em promoção.`,
    corpo: um
      ? `De ${formatarMoeda(um.de)} por ${formatarMoeda(um.para)}. ${ROTULO_NOVO_TOTAL}: ${formatarMoeda(d.novoTotal)}.`
      : `${ROTULO_NOVO_TOTAL}: ${formatarMoeda(d.novoTotal)}.`,
    // Sem botão: o pedido segue.
    rotuloCta: null,
  };
}
