/**
 * [264/RN-12] A copy do aviso de cardápio expirado ou desligado — módulo puro,
 * afirmável byte a byte sem DOM.
 *
 * Vive fora do JSX pelo mesmo motivo de `frasesCardapio.ts` (256) e de
 * `alcance-do-grupo.ts` (237): sem jsdom, um texto escrito direto no `.tsx` não
 * é travável por teste neste repo, e este texto em particular tem uma ORDEM
 * obrigatória (design §13.4 item 1) — **primeiro o que sumiu, depois o que
 * continua vendendo**. Invertida, o lojista lê "7 continuam vendendo" e fecha a
 * tela sem descobrir que perdeu 4 pratos.
 *
 * Nada aqui decide nada: os números vêm de `contarProdutosEscondidos` (preview
 * de UX, recalculado no servidor a cada render) e as duas saídas são gestos
 * explícitos do lojista. O sistema não desliga, não reativa e não converte nada
 * sozinho — um conversor automático venderia sopa de cebola em dezembro.
 */

/** Âmbar, nunca vermelho (design §13.4 item 4): requer ação, não é falha. */
export const TOM_DO_AVISO = "ambar" as const;

/** O que SUMIU. Sempre a primeira linha. */
export function fraseSumiram(sumidos: number): string {
  return sumidos === 1
    ? "1 produto sumiu da vitrine"
    : `${sumidos} produtos sumiram da vitrine`;
}

/** Por que sumiu — a explicação em uma linha, sem jargão de banco. */
export function fraseExclusividade(sumidos: number): string {
  return sumidos === 1
    ? "Ele é exclusivo deste cardápio."
    : "Eles são exclusivos deste cardápio.";
}

/** O que FICA. Sempre depois. `null` quando não há produto do menu no cardápio. */
export function fraseContinuamVendendo(doMenu: number): string | null {
  if (doMenu <= 0) return null;
  return doMenu === 1
    ? "Outro produto do menu continua aparecendo e vendendo normalmente."
    : `Outros ${doMenu} produtos do menu continuam aparecendo e vendendo normalmente.`;
}

/**
 * O aviso inteiro, na ordem obrigatória. `null` = nada sumiu, nada a avisar —
 * que é o estado de todo cardápio no ar e de todo cardápio guardado que não
 * levava exclusivo nenhum. Um aviso que aparece sempre não é lido nunca.
 */
export function avisoCardapioEscondendo(contagem: {
  doMenu: number;
  sumidos: number;
}): string[] | null {
  if (contagem.sumidos <= 0) return null;
  return [
    fraseSumiram(contagem.sumidos),
    fraseExclusividade(contagem.sumidos),
    fraseContinuamVendendo(contagem.doMenu),
  ].filter((frase): frase is string => frase !== null);
}

/**
 * A primeira saída (design §13.4 item 3). Cardápio DESLIGADO volta com um
 * clique; cardápio EXPIRADO já está ligado — "religar" ali seria um botão que
 * não faz nada, então a saída honesta é estender o prazo.
 */
export function rotuloReligarOuEstender(ativo: boolean): string {
  return ativo ? "Estender o prazo" : "Religar o cardápio";
}

/** A segunda saída. Abre confirmação: nada é convertido por este clique. */
export function rotuloDevolverAoMenu(sumidos: number): string {
  return sumidos === 1
    ? "Devolver 1 ao menu"
    : `Devolver os ${sumidos} ao menu`;
}

/** Título do `AlertDialog` da segunda saída. */
export function tituloDevolverAoMenu(sumidos: number): string {
  return sumidos === 1
    ? "Devolver 1 produto ao menu?"
    : `Devolver ${sumidos} produtos ao menu?`;
}

/**
 * O que a confirmação explica antes de nomear os produtos. Diz a consequência
 * REAL — eles passam a vender o ano inteiro —, porque é exatamente essa a
 * decisão que o lojista está tomando (e a que D14 existe para não tomar por
 * ele).
 */
export const FRASE_CONFIRMAR_DEVOLUCAO =
  "Eles voltam a aparecer e vender sempre, mesmo com este cardápio fechado. Você pode torná-los exclusivos de novo quando quiser.";

/**
 * A versão REDUZIDA, na linha do produto em `/painel/produtos` (design §13.4
 * item 5). Mesmo âmbar, mesmo par de saídas — só o texto encolhe.
 *
 * O predicado que produz este aviso é o mesmo dos dois casos; só o VERBO
 * distingue o que de fato aconteceu, porque dizer "expirou" de um cardápio que
 * o lojista desligou de propósito o mandaria procurar um prazo que não acabou.
 */
export function avisoNaLinhaDoProduto(
  nomeDoCardapio: string,
  ativo: boolean,
): string {
  return ativo
    ? `sumiu da vitrine — o cardápio ${nomeDoCardapio} expirou`
    : `sumiu da vitrine — o cardápio ${nomeDoCardapio} foi desligado`;
}
