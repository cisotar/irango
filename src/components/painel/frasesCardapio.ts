/**
 * [256] As duas frases de RN-03 que os gestos destrutivos do cardápio mostram
 * — módulo puro, afirmável byte a byte sem DOM.
 *
 * Elas existem fora do `.tsx` por um motivo de segurança de produto, não de
 * estilo: a frase do MENU não pode prometer o que a do EXCLUSIVO desmente.
 * Prometer que os produtos voltariam a ser vendidos ao religar o cardápio é
 * FALSO para o produto exclusivo — desligar o cardápio o faz SUMIR da vitrine
 * — e é exatamente o tipo de meia-verdade que se escreve sem pensar direto no
 * JSX. A trava dessa promessa vive no teste ao lado.
 *
 * Os dois números são PREVIEW DE UX vindos do servidor a cada render (D14).
 * Nenhuma decisão depende deles: a recusa da remoção é da Server Action
 * (RN-14), e a autorização é a RLS.
 */

/**
 * O que SOME. Vem primeiro nos dois diálogos: "o que some antes do que fica".
 * `null` quando não há exclusivo — nada a avisar.
 */
export function fraseExclusivos(quantidade: number): string | null {
  if (quantidade <= 0) return null;
  return quantidade === 1
    ? "1 produto é exclusivo deste cardápio e vai sumir da vitrine."
    : `${quantidade} produtos são exclusivos deste cardápio e vão sumir da vitrine.`;
}

/** O que FICA. `null` quando não há produto do menu vinculado. */
export function fraseMenu(quantidade: number): string | null {
  if (quantidade <= 0) return null;
  return quantidade === 1
    ? "1 produto do menu continua aparecendo e vendendo normalmente."
    : `${quantidade} produtos do menu continuam aparecendo e vendendo normalmente.`;
}

/** As duas, na ordem — some antes de fica. Vazio = cardápio sem produto. */
export function frasesDoImpacto(
  menu: number,
  exclusivos: number,
): string[] {
  return [fraseExclusivos(exclusivos), fraseMenu(menu)].filter(
    (frase): frase is string => frase !== null,
  );
}

/** O rótulo do botão de saída oferecido pela recusa da remoção (RN-14). */
export function rotuloConverter(quantidade: number): string {
  return quantidade === 1
    ? "Converter 1 produto para o menu"
    : `Converter os ${quantidade} produtos para o menu`;
}
