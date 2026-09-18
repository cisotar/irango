/**
 * RN-12 (issue 208) — plano de escrita da associação categoria-de-produto ⋈
 * grupos-de-opcional, preservando a `ordem` de quem permanece.
 *
 * O painel salva a associação por CHECKBOX (um conjunto), enquanto
 * `categoria_produto_opcionais.ordem` é uma SEQUÊNCIA gravada pela RPC
 * `reordenar_opcionais_da_categoria`. O delete+insert do conjunto inteiro
 * (o comportamento anterior) zeraria a ordem a cada clique, porque as linhas
 * renasceriam no default 0.
 *
 * A saída é deliberadamente um DELTA: quem permanece NÃO aparece no plano, logo
 * a linha não é tocada e a `ordem` sobrevive por construção — não por um
 * re-gravar cuidadoso que poderia divergir entre as duas vias.
 *
 * Função PURA e compartilhada pelas duas vias de escrita (lojista em
 * src/lib/actions/opcional.ts e admin em
 * src/app/admin/assinantes/actions/admin-opcionais.ts) justamente para que a
 * regra não seja duplicada.
 */

export type AssociacaoOpcionalAtual = {
  categoria_opcional_id: string;
  ordem: number;
};

export type PlanoAssociacaoOpcionais = {
  /** `categoria_opcional_id` associados hoje que saíram da seleção. */
  remover: string[];
  /** Novos, na ordem em que o cliente os enviou, anexados no FIM. */
  inserir: Array<{ categoria_opcional_id: string; ordem: number }>;
};

export function planejarAssociacaoOpcionais(
  atuais: readonly AssociacaoOpcionalAtual[],
  marcados: readonly string[],
): PlanoAssociacaoOpcionais {
  const selecionados = new Set(marcados);
  const jaAssociados = new Set(atuais.map((a) => a.categoria_opcional_id));

  const permanecem = atuais.filter((a) => selecionados.has(a.categoria_opcional_id));
  const remover = atuais
    .filter((a) => !selecionados.has(a.categoria_opcional_id))
    .map((a) => a.categoria_opcional_id);

  // Os novos entram DEPOIS do último que permanece — nunca disputando posição
  // com quem já estava. Sem nenhum permanente, a numeração começa em 0.
  let proxima =
    permanecem.length > 0 ? Math.max(...permanecem.map((a) => a.ordem)) + 1 : 0;

  // `marcados` vem de um conjunto de checkbox, mas o schema não garante
  // unicidade: repetir um id aqui violaria o unique (categoria_id,
  // categoria_opcional_id). O `jaAssociados` absorve a duplicata junto com os
  // que já estavam.
  const inserir = marcados
    .filter((id) => {
      if (jaAssociados.has(id)) return false;
      jaAssociados.add(id);
      return true;
    })
    .map((categoria_opcional_id) => ({
      categoria_opcional_id,
      ordem: proxima++,
    }));

  return { remover, inserir };
}

/**
 * Há diferença entre a seleção de checkbox na tela e o que está gravado?
 *
 * Existe para o gate do botão "Reordenar" (issue 209): um grupo recém-marcado
 * ainda NÃO tem linha em `categoria_produto_opcionais`, e mandá-lo no payload da
 * reordenação faria a RPC derrubar a transação por `row_count` — a permutação
 * precisa ser completa e só de linhas existentes. Enquanto houver alteração não
 * salva, reordenar fica bloqueado.
 *
 * É função pura de propósito: dentro do componente essa comparação só mudava
 * depois de um clique, e `renderToStaticMarkup` não dispara handler nenhum, então
 * a trava ficava sem cobertura possível neste ambiente (sem jsdom).
 */
export function haAlteracaoNaAssociacao(
  gravados: ReadonlySet<string>,
  selecionados: ReadonlySet<string>,
): boolean {
  if (gravados.size !== selecionados.size) return true;
  for (const id of selecionados) {
    if (!gravados.has(id)) return true;
  }
  return false;
}
