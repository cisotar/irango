/**
 * Reordenação por DESLOCAMENTO de índice (issue 175). Puro: sem React, sem DOM,
 * sem dependência externa — roda em `environment: node` sem importar nada.
 */

/**
 * Move o item de `de` para `para` DESLOCANDO os intermediários — não é troca de
 * pares. [A,B,C,D] com (0,2) → [B,C,A,D], nunca [C,B,A,D].
 *
 * Devolve a MESMA REFERÊNCIA quando o movimento é no-op (índices iguais, fora do
 * intervalo ou não inteiros). O caller decide "não escrever no banco" com
 * `proxima === atual` (cenário 3) e "seta inerte no limite" com o mesmo teste
 * (cenário 8) — uma regra só, sem `if` espalhado pela UI.
 *
 * Genérica de propósito: o mesmo contrato serve para reordenar produtos dentro
 * da categoria depois, sem reescrever nada.
 *
 * NÃO delega para `arrayMove` do @dnd-kit/sortable: lá, `para` negativo dá a
 * volta e joga o item no FIM (`splice(to < 0 ? length + to : to, …)`), então
 * `↑` na primeira posição moveria a categoria do topo para o último lugar em
 * vez de virar no-op.
 */
export function moverPorDeslocamento<T>(
  itens: readonly T[],
  de: number,
  para: number,
): readonly T[] {
  if (!Number.isInteger(de) || !Number.isInteger(para)) return itens;
  if (de < 0 || de >= itens.length) return itens;
  if (para < 0 || para >= itens.length) return itens;
  if (de === para) return itens;
  const proximo = itens.slice();
  const [movido] = proximo.splice(de, 1);
  proximo.splice(para, 0, movido);
  return proximo;
}

/**
 * `Pizzas movida para a posição 2 de 6.` — a mensagem sempre nomeia a categoria
 * E a posição resultante sobre o total: "movido para cima" sozinho obrigaria o
 * usuário de leitor de tela a explorar a lista para descobrir onde o item caiu.
 */
export function mensagemPosicao(
  nome: string,
  indice: number,
  total: number,
): string {
  return `${nome} movida para a posição ${indice + 1} de ${total}.`;
}
