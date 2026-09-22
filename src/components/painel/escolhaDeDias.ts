/**
 * [288/D3] A escolha de dias no ATO de adicionar item ao cardápio — módulo
 * PURO, sem React, sem action, sem `'use client'`.
 *
 * Mora fora do `.tsx` pelo mesmo motivo de `agendaDoVinculo.ts`: sem jsdom, um
 * clique não é observável, e a regra de D3 é exatamente o que não pode escapar
 * de teste. O que este módulo decide é INTENÇÃO, nunca representação: `[]` sai
 * daqui e vira `NULL` no SERVIDOR (`normalizarDiasDoVinculo`), porque "sem
 * restrição" tem uma representação só e ela não é escolhida pelo browser.
 *
 * Por que não dá para reusar `agendaDoVinculo.ts`: aquele monta o payload de UM
 * vínculo JÁ EXISTENTE (`produto_id` singular, três chaves). O payload da
 * ADIÇÃO é outro — `produto_ids` plural mais `dias_semana` — e é o da issue 287.
 */

/**
 * As DUAS opções de D3, não as 128 combinações de sete pílulas:
 *  - `cardapio`: o item segue a janela do cardápio (o caso majoritário, e o
 *    único que grava `NULL`);
 *  - `dias`: o item aparece só nos dias marcados.
 *
 * Marcar as 7 pílulas NÃO é o mesmo que `{modo:"cardapio"}`: grava `[0..6]`,
 * uma agenda fixa que deixa de seguir a vigência se ela mudar depois.
 */
export type EscolhaDeDias =
  { modo: "cardapio" } | { modo: "dias"; dias: number[] };

/** Pré-selecionada: zero clique extra para o caso comum. */
export const ESCOLHA_PADRAO: EscolhaDeDias = { modo: "cardapio" };

/** O motivo do CTA desabilitado, em TEXTO perceptível — nunca em `title`. */
export const MOTIVO_SEM_DIA = "Marque pelo menos um dia para continuar.";

/**
 * [287, fora de escopo resolvido na UI] A RPC `aplicar_cardapio_em_categoria`
 * expande a categoria DENTRO da transação e devolve só uma contagem, não os
 * ids: aceitar dias ali exigiria parâmetro novo na função e, portanto,
 * migration. Em vez de descartar em silêncio os dias escolhidos, a tela diz o
 * que vai acontecer e desabilita o gesto.
 */
export const MOTIVO_CATEGORIA_SEM_DIAS =
  "Adicionar a categoria inteira entra sempre como todos os dias do cardápio. Para dias específicos, marque os produtos um a um.";

/** "Escolher dias" com zero dia marcado não expressa agenda nenhuma. */
export function escolhaValida(escolha: EscolhaDeDias): boolean {
  return escolha.modo === "cardapio" || escolha.dias.length > 0;
}

/**
 * Os dias na forma que a action recebe: `[]` para "todos os dias do cardápio",
 * ordem crescente para o resto. Devolve SEMPRE um array novo.
 */
export function diasDaEscolha(escolha: EscolhaDeDias): number[] {
  if (escolha.modo === "cardapio") return [];
  return [...escolha.dias].sort((a, b) => a - b);
}

// ═══════════════════ [289] A pílula do PRODUTO vence o rodapé da sheet ═══════
//
// O rodapé da sheet vale para o lote inteiro; cada produto selecionado pode ter
// a sua própria escolha. A regra mora AQUI, e não num handler de clique, porque
// o projeto não tem jsdom: regra em `onClick` não é observável em teste.

/**
 * O FRAGMENTO do payload de lote que a sheet monta. `dias_por_produto` é
 * ADITIVO e OPCIONAL: quando ninguém tem pílula própria, a chave nem aparece e
 * o payload é byte a byte o de hoje — é a compatibilidade da barra de lote de
 * `/painel/produtos`, que não tem pílula por item.
 */
export type DiasDoLote = {
  dias_semana: number[];
  dias_por_produto?: Record<string, number[]>;
};

/**
 * A escolha de UM produto: a dele quando existe, a do rodapé quando não.
 *
 * `undefined` é "não escolheu nada" — distinto de `{modo:"cardapio"}`, que é
 * "escolheu seguir o cardápio" e, esse sim, vence um rodapé restrito.
 */
export function resolverDiasDoProduto(
  rodape: EscolhaDeDias,
  doProduto: EscolhaDeDias | undefined,
): number[] {
  return diasDaEscolha(doProduto ?? rodape);
}

/**
 * A mesma regra aplicada à seleção inteira. Só id presente em `produtoIds`
 * entra no mapa: escolha órfã (produto desmarcado depois) não pode vazar, e o
 * servidor RECUSA o lote inteiro quando o mapa tem id fora da lista.
 *
 * Nada aqui deduplica: quem decide a REPRESENTAÇÃO é `normalizarDiasDoVinculo`,
 * no servidor. O cliente manda intenção.
 */
export function montarDiasDoLote(
  produtoIds: string[],
  rodape: EscolhaDeDias,
  porProduto: Record<string, EscolhaDeDias | undefined>,
): DiasDoLote {
  const mapa: Record<string, number[]> = {};
  for (const id of produtoIds) {
    const escolha = porProduto[id];
    // Só quem escolheu entra no mapa; quem não escolheu é OMITIDO, e o
    // servidor cai no `dias_semana` do rodapé. A resolução em si é a de
    // `resolverDiasDoProduto` — uma regra, um lugar.
    if (escolha !== undefined)
      mapa[id] = resolverDiasDoProduto(rodape, escolha);
  }
  const dias_semana = diasDaEscolha(rodape);
  return Object.keys(mapa).length === 0
    ? { dias_semana }
    : { dias_semana, dias_por_produto: mapa };
}
