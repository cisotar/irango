import type { Opcional } from "@/lib/supabase/queries/opcionais";
import type {
  Associacao,
  CategoriaProduto,
} from "@/components/painel/contrato-opcionais";

/**
 * Derivações PURAS que alimentam `CartaoAssociacaoOpcionais` (issue 217).
 *
 * Nasceram como cinco `useMemo` inline em `OpcionaisClient`. A 217 dá um SEGUNDO
 * consumidor ao cartão — o modal de `/painel/produtos` — e copiar os cinco
 * significaria duas cópias do comparador `ordem || id` e do desempate. É
 * exatamente a divergência silenciosa que `queries/produtos.ts` documenta e que
 * a 216 gastou uma issue inteira consertando. Aqui vive a cópia única.
 *
 * Sem React, sem I/O: `environment: node` testa byte a byte.
 *
 * Nenhuma destas funções é barreira de segurança. Elas só reagrupam dados que a
 * page já leu sob RLS (ou, na via admin, sob `service_role` com `.eq("loja_id")`)
 * — a autoridade sobre o que pode ser lido e escrito continua inteira no
 * servidor.
 */

/**
 * `categoria_opcional_id → itens do grupo`, ativos E inativos: a RPC da 215
 * exige a permutação COMPLETA do par (loja, grupo), então a sanfona precisa
 * listar o inativo — ele ocupa posição real na ordem.
 *
 * O comparador ESPELHA o de `buscarOpcionaisDoLojista`: `ordem` com desempate
 * por `id`. Não é redundância — o mapa é reagrupado no cliente, e um `sort`
 * estável sobre uma ordem já correta é barato e protege a lista de uma futura
 * mudança na query.
 */
export function agruparOpcionaisPorGrupo(
  opcionais: readonly Opcional[],
): Map<string, Opcional[]> {
  const mapa = new Map<string, Opcional[]>();
  for (const o of opcionais) {
    const lista = mapa.get(o.categoria_opcional_id) ?? [];
    lista.push(o);
    mapa.set(o.categoria_opcional_id, lista);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  }
  return mapa;
}

/** `categoria_opcional_id → nº de itens`, só para o `detalhe` de cada linha. */
export function contarItensPorGrupo(
  opcionaisPorGrupo: ReadonlyMap<string, readonly Opcional[]>,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const [grupoId, lista] of opcionaisPorGrupo) {
    mapa.set(grupoId, lista.length);
  }
  return mapa;
}

/**
 * `categoria_id (produto) → set de categoria_opcional_id` PERSISTIDOS.
 *
 * Deriva de `categoria_produto_opcionais` (a fonte de verdade), nunca do mapa da
 * vitrine: `agruparOpcionaisPorCategoria` descarta grupo associado que ainda não
 * tem item, e um grupo vazio que abrisse DESMARCADO seria apagado em silêncio no
 * primeiro toggle de qualquer outro grupo (o toggle grava o conjunto inteiro).
 */
export function selecionadosPorCategoria(
  associacoes: readonly Associacao[],
): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const a of associacoes) {
    const set = mapa.get(a.categoria_id) ?? new Set<string>();
    set.add(a.categoria_opcional_id);
    mapa.set(a.categoria_id, set);
  }
  return mapa;
}

/**
 * `categoria_id (produto) → (categoria_opcional_id → ordem)` gravada (208).
 * Vem SEMPRE das props, nunca de estado: todo toggle e toda reordenação terminam
 * em `router.refresh()`, e é por aqui que a ordem recém-gravada volta.
 */
export function ordemPorCategoria(
  associacoes: readonly Associacao[],
): Map<string, Map<string, number>> {
  const mapa = new Map<string, Map<string, number>>();
  for (const a of associacoes) {
    const porGrupo = mapa.get(a.categoria_id) ?? new Map<string, number>();
    porGrupo.set(a.categoria_opcional_id, a.ordem);
    mapa.set(a.categoria_id, porGrupo);
  }
  return mapa;
}

/**
 * ALCANCE (issue 216): `categoria_opcional_id → nomes das categorias de PRODUTO
 * que usam o grupo`. Editar ou remover um item vale para todas elas — a
 * biblioteca é da loja, não existe "Coca só de Pães" — e é essa lista que a UI
 * usa para avisar no momento da ação.
 *
 * Associação cuja `categoria_id` não está em `categoriasProduto` é IGNORADA: o
 * nome é o que a UI mostra, e um alcance com buraco mentiria sobre o que some.
 */
export function alcancePorGrupo(
  associacoes: readonly Associacao[],
  categoriasProduto: readonly CategoriaProduto[],
): Map<string, string[]> {
  const nomePorCategoria = new Map(categoriasProduto.map((c) => [c.id, c.nome]));
  const mapa = new Map<string, string[]>();
  for (const a of associacoes) {
    const nome = nomePorCategoria.get(a.categoria_id);
    if (nome == null) continue;
    const nomes = mapa.get(a.categoria_opcional_id) ?? [];
    nomes.push(nome);
    mapa.set(a.categoria_opcional_id, nomes);
  }
  return mapa;
}
