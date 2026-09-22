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

// ═══════ [284] As três saídas do diálogo de remoção (spec §Mensagens) ════════
//
// Frases puras, aqui e não no `.tsx`, pelo mesmo motivo das de cima: sem jsdom
// a única forma de travar o texto byte a byte é o módulo ao lado do teste.
//
// §Ressalva de vocabulário (não negociável): "arquivar" é `oculto = true` —
// some da vitrine e volta num clique. `disponivel = false` é "esgotado", que
// CONTINUA visível, e por isso nenhuma frase daqui fala em esgotado.

/** Rótulo do 2º botão da recusa — gesto reversível, sem segunda confirmação. */
export function rotuloArquivar(quantidade: number): string {
  return quantidade === 1
    ? "Arquivar 1 produto"
    : `Arquivar os ${quantidade} produtos`;
}

/** Rótulo do 3º botão (destrutivo). Não executa: abre a 2ª confirmação. */
export function rotuloRemoverProdutos(quantidade: number): string {
  return quantidade === 1
    ? "Remover 1 produto"
    : `Remover os ${quantidade} produtos`;
}

/** O que "arquivar" faz, dito sem jargão — some da vitrine, não é apagado. */
export function fraseArquivar(quantidade: number): string {
  return quantidade === 1
    ? "O produto fica guardado e some da vitrine. Você pode exibi-lo de novo quando quiser."
    : `Os ${quantidade} produtos ficam guardados e somem da vitrine. Você pode exibi-los de novo quando quiser.`;
}

/**
 * A 2ª confirmação da cascata. Literal, curta, sem eufemismo: não há desfazer
 * nem lixeira (§Fora do Escopo), e a UI declara isso ANTES do clique.
 */
export function fraseCascataPermanente(quantidade: number): string {
  return quantidade === 1
    ? "1 produto será apagado permanentemente e não poderá ser recuperado."
    : `${quantidade} produtos serão apagados permanentemente e não poderão ser recuperados.`;
}

/** Rótulo do botão que confirma a cascata de verdade. */
export function rotuloConfirmarCascata(quantidade: number): string {
  return quantidade === 1
    ? "Apagar 1 produto e remover o cardápio"
    : `Apagar ${quantidade} produtos e remover o cardápio`;
}
