/**
 * Copy dos TRÊS ESTADOS do cupom no checkout (issue 237). Pura: sem React, sem
 * DOM, sem I/O — roda em `environment: node` e é afirmável byte a byte,
 * exatamente como `lib/utils/alcance-do-grupo.ts`.
 *
 * ─────────────────────────────────────────── Por que a copy sai do JSX
 * Neste repo não há jsdom. Uma frase dentro de um `.tsx` não tem como ser
 * travada por teste; uma frase devolvida por função pura tem. RN-10-e diz
 * textualmente que a linha secundária do estado B **não é opcional** — é esta
 * a única defesa possível contra a redação ser "melhorada" numa revisão futura.
 *
 * ─────────────────────────────────────────── O que este módulo NUNCA faz
 * Nenhuma conta. Todo número citado (`desconto`, `baseElegivel`,
 * `baseProdutos`, `baseOpcionais`) chega PRONTO da `revisarCarrinhoAction`
 * (RN-11 / D5-b): recalcular aqui seria reimplementar a regra de componente no
 * browser. E a escolha do estado A/B/C também vem do servidor — a união
 * discriminada é a trava (M4): no estado `zero` o campo `desconto` nem existe,
 * então "Desconto R$ 0,00" é impossível de renderizar por acidente.
 *
 * ─────────────────────────────────────────── Vocabulário
 * **"Base elegível" é proibido na vitrine.** É vocabulário da spec e do código.
 * Por isso a última linha do detalhamento é "O cupom valeu sobre", nunca
 * "Base do cupom".
 */

import type { EstadoCupom } from "@/lib/actions/revisarCarrinho-contrato";
import { formatarMoeda } from "./formatarMoeda";

/** Rótulo da linha do cupom no resumo. */
export function rotuloLinhaCupom(e: EstadoCupom): string {
  // C — sem valor na linha, então o rótulo precisa dizer sozinho que o cupom
  // ENTROU (senão a linha lê como "cupom ignorado").
  if (e.estado === "zero") return `Cupom ${e.codigo} aplicado`;
  return `Cupom ${e.codigo}`;
}

/**
 * Valor da linha do cupom, já formatado. `null` ⇒ a linha de valor **não
 * existe** (estado C): não há desconto nenhum a exibir, e o número sequer
 * chegou do servidor.
 */
export function valorLinhaCupom(e: EstadoCupom): string | null {
  if (e.estado === "zero") return null;
  // NBSP entre o sinal e o valor: "−" sozinho no fim da linha lê como traço.
  return `− ${formatarMoeda(e.desconto)}`;
}

/**
 * Frase explicativa de RN-10-e. `null` ⇒ **sem frase** (estado A: nada a
 * explicar; frase permanente vira ruído e ensina o cliente a não ler o resumo).
 */
export function fraseCupom(e: EstadoCupom): string | null {
  if (e.estado === "cheio") return null;
  if (e.estado === "parcial") {
    // "adicionais incluídos" é o trecho que carrega D9: é exatamente onde o
    // cliente erraria a conta sozinho (presumiria que a linha inteira da pizza
    // ficou de fora).
    return (
      "Não acumula com promoção: o desconto valeu sobre " +
      `${formatarMoeda(e.baseElegivel)} do pedido — o que não está em ` +
      "promoção, adicionais incluídos."
    );
  }
  return (
    `Cupom ${e.codigo} aplicado. Sem desconto neste pedido: não há nada fora ` +
    "da promoção para descontar — cupom não acumula com promoção."
  );
}

/** Uma linha do detalhamento "Como calculamos". */
export type LinhaDetalhamento = { rotulo: string; valor: string };

/** Rótulo do disclosure (design §6.4) — fechado por padrão, só no estado B. */
export const ROTULO_DETALHAMENTO = "Como calculamos";

/**
 * As três linhas de "Como calculamos" (design §6.4). `null` ⇒ o disclosure
 * **não é renderizado**: no estado A não há o que explicar, no C não há números
 * para somar, e quando as parcelas não vêm do servidor a frase obrigatória do
 * estado B sobrevive sozinha.
 *
 * Nenhuma soma acontece aqui: as três parcelas chegam prontas de
 * `derivarBasesCupom` com a invariante `baseElegivel === arred2(baseProdutos +
 * baseOpcionais)` travada no servidor.
 */
export function detalhamentoCupom(e: EstadoCupom): LinhaDetalhamento[] | null {
  if (e.estado !== "parcial") return null;
  return [
    { rotulo: "Itens fora da promoção", valor: formatarMoeda(e.baseProdutos) },
    { rotulo: "+ Adicionais", valor: formatarMoeda(e.baseOpcionais) },
    { rotulo: "= O cupom valeu sobre", valor: formatarMoeda(e.baseElegivel) },
  ];
}
