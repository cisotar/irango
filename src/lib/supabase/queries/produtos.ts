import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { Categoria } from "./categorias";

/**
 * Queries reusáveis de `produtos` para vitrine e painel. RLS já isola (seguranca.md §2):
 *  - produtos_leitura_publica: disponivel=true AND loja_esta_ativa(loja_id);
 *  - produtos_leitura_propria: dono vê os próprios (incl. indisponíveis).
 * Funções recebem o `client` por parâmetro (role escolhida pelo caller).
 * Propagam `error` (§14); `[]` = sem linha, nunca mascara erro.
 */
type Client = SupabaseClient<Database>;

export type Produto = Tables<"produtos">;

/** Grupo do catálogo público: uma categoria (ou "Outros") + seus produtos. */
export type GrupoCatalogo = {
  /** id do grupo: id da categoria, ou null para "Outros". */
  id: string | null;
  /** nome do grupo (nome da categoria, ou "Outros"). */
  nome: string;
  /** categoria associada (null no grupo "Outros"). */
  categoria: Categoria | null;
  produtos: Produto[];
};

/**
 * Catálogo público da vitrine: produtos disponíveis de loja ativa, agrupados por
 * categoria (ordem da categoria) e ordenados por `ordem`. Produtos sem categoria
 * caem no grupo "Outros", que fica POR ÚLTIMO. `categorias` é a lista já buscada
 * (buscarCategorias) usada para ordenar/nomear os grupos.
 */
export async function buscarCatalogoPublico(
  client: Client,
  lojaId: string,
  categorias: Categoria[] = [],
): Promise<GrupoCatalogo[]> {
  const { data, error } = await client
    .from("produtos")
    .select("*")
    .eq("loja_id", lojaId)
    .eq("disponivel", true)
    .order("ordem", { ascending: true });
  if (error) throw error;
  const produtos = (data ?? []) as Produto[];

  // Um grupo por categoria, na ordem das categorias.
  const grupos: GrupoCatalogo[] = categorias.map((categoria) => ({
    id: categoria.id,
    nome: categoria.nome,
    categoria,
    produtos: [],
  }));
  const porId = new Map(grupos.map((g) => [g.id, g]));

  // Grupo "Outros" (categoria_id null) materializado só se houver produto, e no FIM.
  let outros: GrupoCatalogo | null = null;

  for (const produto of produtos) {
    const grupo = produto.categoria_id ? porId.get(produto.categoria_id) : undefined;
    if (grupo) {
      grupo.produtos.push(produto);
    } else {
      if (!outros) {
        outros = { id: null, nome: "Outros", categoria: null, produtos: [] };
      }
      outros.produtos.push(produto);
    }
  }

  if (outros) grupos.push(outros);
  return grupos;
}

/**
 * Painel do lojista: todos os produtos da loja (incl. indisponíveis), com a
 * categoria aninhada. Ordenado por `ordem`.
 */
export async function buscarProdutosDoLojista(
  client: Client,
  lojaId: string,
): Promise<Produto[]> {
  const { data, error } = await client
    .from("produtos")
    .select("*, categorias(*)")
    .eq("loja_id", lojaId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Produto[];
}

/**
 * Insumo do recálculo autoritativo de pedido (seguranca.md §10): retorna
 * preco/disponivel/loja_id REAIS dos produtos pelos ids. NÃO filtra por
 * disponivel (o recálculo precisa enxergar o indisponível para recusá-lo).
 * Exige client com visibilidade adequada (service_role no fluxo de pedido).
 * Lista vazia → `[]` sem consultar o banco.
 */
export async function buscarProdutosPorIds(
  client: Client,
  ids: string[],
): Promise<Produto[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("produtos").select("*").in("id", ids);
  if (error) throw error;
  return data ?? [];
}
