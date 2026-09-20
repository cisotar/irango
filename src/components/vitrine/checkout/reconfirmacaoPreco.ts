// [237/238 · correções do `auditar`] QUANDO a reconfirmação de preço abre.
//
// Módulo PURO (sem React, sem DOM): sem jsdom, esta é a única forma de travar
// por teste a decisão que o `CheckoutWizard` toma depois de revisar o carrinho.
//
// 🛑 Não calcula dinheiro. Recebe o veredito da revisão (`ok`) e as linhas que
// SUBIRAM (já apuradas por `detectarMudancasDePreco` sobre números do servidor)
// e devolve só o que a tela deve fazer.
//
// A regra que este módulo existe para garantir: **o diálogo de reconfirmação
// nunca abre com dado velho nem com lista vazia**. Revisão que falhou não tem
// número novo para mostrar — mostrar o antigo faria o cliente clicar num total
// que não é o que será cobrado. E "as promoções de 0 itens terminaram" é um
// estado impossível de explicar a quem está comprando.

import type { MudancaItem } from "@/lib/utils/copiaRevisaoPreco";

export type DecisaoRevisao =
  /** Revisão fresca e há linha que subiu ⇒ diálogo com de/para e 2º clique. */
  | "abrir"
  /** Revisão fresca e nada subiu ⇒ nenhum diálogo (lista vazia não é copy). */
  | "seguir"
  /** A revisão NÃO voltou ⇒ nenhum número novo, nenhum CTA de envio. */
  | "falhou";

/** Toast da revisão que não voltou: genérico, sem detalhe interno (§14). */
export const MSG_REVISAO_FALHOU =
  "Não foi possível revisar os preços. Tente novamente.";

/** Revisão fresca sem aumento nenhum: o cliente só reenvia. */
export const MSG_REVISAO_SEM_MUDANCA =
  "Os preços foram atualizados. Confira o resumo e envie o pedido de novo.";

export function decidirReconfirmacao(d: {
  ok: boolean;
  subiram: readonly MudancaItem[];
}): DecisaoRevisao {
  if (!d.ok) return "falhou";
  return d.subiram.length > 0 ? "abrir" : "seguir";
}

/** Chave desta rodada de aumentos: mesma lista ⇒ mesma chave ⇒ o diálogo não
 *  reabre sozinho depois de o cliente fechá-lo. Preço novo ⇒ chave nova. */
export const CHAVE_SEM_MUDANCA = "";

export function chaveMudancas(itens: readonly MudancaItem[]): string {
  return itens.map((i) => `${i.nome}|${i.de}|${i.para}`).join(";");
}
