/**
 * [276] A agenda de UM vínculo produto↔cardápio, do lado do cliente — módulo
 * PURO, sem React, sem action, sem `'use client'`.
 *
 * Mora fora do `.tsx` pelo mesmo motivo que tirou a copy de lote do JSX em
 * [260]: sem jsdom, um clique não é observável. O critério de aceite da issue
 * ("chama a action com `{cardapio_id, produto_id, dias_semana}` e **nada
 * mais**") só é afirmável aqui.
 *
 * Nada neste módulo decide posse: quem recusa vínculo alheio é o UPDATE pela
 * tripla com `count: "exact"` de [274], e a forma do payload é recusada pelo
 * `schemaDiasDoVinculo.strict()` na Server Action.
 */

/** O payload EXATO de `definirDiasDoVinculo` — três chaves, nunca uma quarta. */
export type PayloadDeDias = {
  cardapio_id: string;
  produto_id: string;
  dias_semana: number[];
};

/**
 * Alterna um dia na agenda do vínculo, mantendo a lista ordenada e sem
 * repetição. A representação final (`[]` → `NULL`, dedup, ordem) continua sendo
 * decidida no SERVIDOR por `normalizarDiasDoVinculo` — isto é só o que a tela
 * mostra enquanto a escrita está em voo.
 */
export function alternarDiaDoVinculo(dias: number[] | null, dia: number): number[] {
  const atual = dias ?? [];
  return atual.includes(dia)
    ? atual.filter((d) => d !== dia)
    : [...atual, dia].sort((a, b) => a - b);
}

/**
 * O payload de UMA escrita. Três chaves e nada mais: nem `loja_id` (que o
 * `.strict()` recusaria — RN-10), nem nome, nem estado de tela.
 */
export function payloadDeDias(
  cardapioId: string,
  produtoId: string,
  dias: number[],
): PayloadDeDias {
  return {
    cardapio_id: cardapioId,
    produto_id: produtoId,
    dias_semana: [...dias].sort((a, b) => a - b),
  };
}

/**
 * [277/decisão B] "Definir dias" só habilita com a seleção INTEIRA já vinculada
 * a este cardápio.
 *
 * Motivo estrutural: a prévia conta PRODUTOS, a escrita alcança VÍNCULOS.
 * Selecionando 12 dos quais 4 não estão no cardápio, o botão diria "12" e 4
 * escritas terminariam em `count === 0`. Mudar a contagem da prévia está fora
 * do escopo da issue.
 *
 * É CONVENIÊNCIA, não autoridade: burlar isto no browser não grava nada — cada
 * par não vinculado recebe `count === 0` e a recusa genérica de [274].
 */
export function podeDefinirDias(
  produtos: readonly { id: string; noCardapio: boolean }[],
  selecionados: readonly string[],
): boolean {
  if (selecionados.length === 0) return false;
  const vinculados = new Set(
    produtos.filter((p) => p.noCardapio).map((p) => p.id),
  );
  return selecionados.every((id) => vinculados.has(id));
}

/**
 * [277] O fan-out: N payloads individualmente escopados, um por par
 * `(cardapio, produto)`. Cada escrita é recusada sozinha pela tripla com
 * `count: "exact"` de [274] — é o que torna o fan-out seguro apesar de não ser
 * uma instrução só.
 */
export function payloadsDeDiasEmLote(
  cardapioId: string,
  produtoIds: readonly string[],
  dias: number[],
): PayloadDeDias[] {
  return produtoIds.map((produtoId) =>
    payloadDeDias(cardapioId, produtoId, dias),
  );
}
