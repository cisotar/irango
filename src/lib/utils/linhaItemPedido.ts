// Helper `LinhaItemPedido` (239 / RN-14, D7, D12) — a regra "mostra o par
// de/por quando `preco_original` não é NULL" mora AQUI, e só aqui.
//
// Função PURA de apresentação (M5): nenhuma decisão monetária, nenhum I/O,
// nenhum recálculo. Os dois números chegam prontos do SNAPSHOT imutável do
// pedido (`itens_pedido.preco` = preço pago, `itens_pedido.preco_original` =
// preço de tabela quando houve desconto — issues 221/229). O gatilho é UM só:
// `preco_original == null` ⇒ não houve promoção ⇒ `null` ⇒ nada é renderizado.
// Nenhuma superfície tem um `if` próprio sobre `preco_original` (M3).
//
// O par é SEMPRE UNITÁRIO (RN-14): é o que D7 diz literalmente (as duas colunas
// guardam valor POR UNIDADE), é o preço que o cliente reconhece do card da
// vitrine, e um par de linha misturaria quantidade, desconto e opcionais.
// Quem quer o total COBRADO da linha usa `totalDaLinha` (RN-20), que é a mesma
// função que produz `calcularSubtotal` — os dois números convivem na mesma
// linha do documento e ambos estão certos.
//
// O par NÃO vai para a `ComandaCozinha`: lá é só o selo `[PROMO]`, sem nenhum
// valor (D12, RN-14-a).

import { formatarMoeda } from "./formatarMoeda";

/** O que uma linha de pedido precisa expor para o par de/por. */
export type ItemComPrecoOriginal = {
  /** Preço unitário PAGO (snapshot). */
  preco: number;
  /** Preço unitário de TABELA; `null` quando não houve desconto. */
  preco_original: number | null;
  quantidade: number;
};

export interface ParDePor {
  /** Sempre `true` quando o objeto existe — houve promoção nesta linha. */
  teve: boolean;
  /** Preço de tabela já formatado (ex.: `R$ 100,00`). */
  de: string;
  /** Preço pago já formatado (ex.: `R$ 80,00`). */
  por: string;
  /** `/un.` quando `quantidade > 1`, para ninguém ler o par como total da linha. */
  sufixo: string;
}

/**
 * @returns o par unitário formatado, ou `null` quando não houve promoção
 * (`preco_original` NULL) — e então nada é renderizado.
 */
export function parDePor(item: ItemComPrecoOriginal): ParDePor | null {
  if (item.preco_original == null) return null;
  return {
    teve: true,
    de: formatarMoeda(item.preco_original),
    por: formatarMoeda(item.preco),
    // Com quantidade 1 o preço pago JÁ é o total da linha exibido ao lado; com
    // quantidade > 1 ele não é, e o `/un.` é o que impede a leitura errada.
    sufixo: item.quantidade > 1 ? "/un." : "",
  };
}

/**
 * Variante de TEXTO PLANO da mesma regra — a frase única que as superfícies
 * imprimem sob o nome do item (WhatsApp, recibo térmico, detalhe do pedido e
 * confirmação). Parênteses são do caller; aqui nunca entra `~tachado~`, e a
 * palavra "de" carrega o significado sozinha (térmica, design §11.3: no papel
 * não existe cinza e o `line-through` some em 203dpi).
 *
 * Com `quantidade === 1` o "por" é o próprio total da linha, já impresso ao
 * lado, e repeti-lo seria ruído: a frase é `de R$ 100,00`. Com `quantidade > 1`
 * o preço pago não aparece em lugar nenhum da linha, então "por" e `/un.`
 * entram juntos: `de R$ 50,00 por R$ 40,00/un.`.
 *
 * @returns `null` quando não houve promoção.
 */
export function textoDePor(item: ItemComPrecoOriginal): string | null {
  const par = parDePor(item);
  if (!par) return null;
  return par.sufixo
    ? `de ${par.de} por ${par.por}${par.sufixo}`
    : `de ${par.de}`;
}
