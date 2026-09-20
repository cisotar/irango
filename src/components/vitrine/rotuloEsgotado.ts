/**
 * O par textual do estado "esgotado" na vitrine — fonte ÚNICA.
 *
 * Nasceu em `CardProduto` (pill visível "Esgotado" + `aria-label`
 * "<nome> esgotado"). A issue 225 leva o mesmo estado à linha textual
 * (`ItemProdutoLista`), e o par foi extraído para cá justamente para que a lista
 * não estreie uma TERCEIRA variante de rótulo: grid e lista dizem exatamente a
 * mesma coisa, ao olho e ao leitor de tela.
 *
 * Não é o rótulo de `oculto` — produto oculto não chega ao catálogo.
 */

/** Texto visível do selo. */
export const ROTULO_ESGOTADO = "Esgotado";

/** Rótulo acessível — `aria-label` do card, texto do leitor de tela na linha. */
export function rotuloAcessivelEsgotado(nome: string): string {
  return `${nome} esgotado`;
}
