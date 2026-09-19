/**
 * Copy do ALCANCE de um grupo de opcional (issue 216). Pura: sem React, sem
 * DOM, sem I/O — roda em `environment: node` e é testável byte a byte.
 *
 * ─────────────────────────────────────────── O que é "alcance"
 * A biblioteca de opcionais é da LOJA: editar ou remover um item vale para TODA
 * categoria de produto que usa o grupo dele. `alcance` é a lista de nomes
 * dessas categorias de produto — propriedade do GRUPO, não do item.
 *
 * ─────────────────────────────────────────── Por que nomear só até 2
 * Nomear é mais concreto que contar ("sai de Pizzas e Esfihas" > "sai de 2
 * categorias"), mas a partir de 3 nomes a frase estoura a linha em 360px e
 * deixa de ser lida. A contagem assume a partir daí.
 *
 * ─────────────────────────────────────────── Por que 0 e 1 não ganham AVISO
 * O aviso que dispara sempre vira papel de parede e deixa de ser lido
 * justamente quando importa. Alcance 0 ou 1 é o caso comum: nenhum texto de
 * aviso, em lugar nenhum (`fraseAlcanceDoPainel`/`fraseAlcanceDaEdicao` devolvem
 * `null`). A PERGUNTA de remoção é outra coisa — ela é irreversível e nomeia a
 * única categoria afetada mesmo com alcance 1.
 */

/**
 * Fragmento que completa "Ele sai de …": `Pizzas`, `Pizzas e Esfihas`,
 * `3 categorias de produto`. String vazia quando o grupo não é usado por
 * nenhuma categoria de produto.
 */
export function rotuloAlcance(nomes: readonly string[]): string {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes.length} categorias de produto`;
}

/**
 * Cabeçalho do painel de itens — o contexto ANTES de agir, uma vez ao abrir.
 * `null` com alcance 0 ou 1: o chamador não renderiza o `<p>`.
 */
export function fraseAlcanceDoPainel(
  nomes: readonly string[],
  grupoNome: string,
): string | null {
  if (nomes.length < 2) return null;
  return (
    "Itens da biblioteca da loja. Editar ou remover vale para as " +
    `${nomes.length} categorias de produto que usam ${grupoNome}.`
  );
}

/**
 * Frase ligada aos campos por `aria-describedby` na linha em edição: quem foca o
 * campo de preço OUVE o alcance, não só quem enxerga o cinza.
 */
export function fraseAlcanceDaEdicao(nomes: readonly string[]): string | null {
  if (nomes.length < 2) return null;
  return `Vale para ${nomes.length} categorias de produto.`;
}

/**
 * Pergunta da confirmação inline de remoção. Diferente das frases acima, ela
 * aparece com QUALQUER alcance: a ação é irreversível, e o gate bloqueante do
 * irreversível é a assimetria inteira do desenho (a edição, reversível, só
 * recebe aviso não-bloqueante).
 */
export function perguntaDeRemocao(params: {
  nomeItem: string;
  alcance: readonly string[];
  /** Único item restante no grupo: a frase ganha uma segunda sentença. */
  ehUltimoDoGrupo: boolean;
  grupoNome: string;
}): string {
  const { nomeItem, alcance, ehUltimoDoGrupo, grupoNome } = params;
  const rotulo = rotuloAlcance(alcance);
  const base =
    rotulo === ""
      ? `Remover “${nomeItem}”?`
      : `Remover “${nomeItem}”? Ele sai de ${rotulo}.`;
  return ehUltimoDoGrupo
    ? `${base} É o último opcional de ${grupoNome}.`
    : base;
}
