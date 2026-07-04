import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { Categoria } from "./categorias";

/**
 * Queries reusáveis de `produtos` para vitrine e painel. RLS já isola (seguranca.md §2):
 *  - produtos_leitura_publica: oculto=false AND loja_esta_ativa(loja_id);
 *  - produtos_leitura_propria: dono vê os próprios (incl. indisponíveis).
 * Funções recebem o `client` por parâmetro (role escolhida pelo caller).
 * Propagam `error` (§14); `[]` = sem linha, nunca mascara erro.
 */
type Client = SupabaseClient<Database>;

// z.guid() valida o FORMATO uuid sem exigir os nibbles de versão/variante
// RFC-4122 (z.uuid() rejeitaria ids válidos do Postgres em casos de borda) —
// mesmo padrão de entregaPagamento.ts / pedidos.ts.
const schemaUuid = z.guid();

export type Produto = Tables<"produtos">;

/** Item de opcional para exibição na vitrine (sem cálculo — só dados). */
export type OpcionalDisponivel = Pick<Tables<"opcionais">, "id" | "nome" | "preco" | "ordem">;

/**
 * Grupo de opcionais de um produto: uma categoria de opcional + seus itens ativos,
 * derivada da `categoria_id` do produto via `categoria_produto_opcionais`.
 */
export type GrupoOpcional = {
  categoriaOpcionalId: string;
  categoriaOpcionalNome: string;
  ordem: number;
  opcionais: OpcionalDisponivel[];
};

/** Mapa categoria_id (de produto) → grupos de opcional disponíveis. */
export type OpcionaisPorCategoria = Record<string, GrupoOpcional[]>;

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
 * Catálogo público da vitrine: produtos NÃO-ocultos de loja ativa (`oculto=false`),
 * agrupados por categoria (ordem da categoria) e ordenados por `ordem`. Produtos
 * indisponíveis (`disponivel=false`) NÃO-ocultos ENTRAM no catálogo (renderizam
 * como "esgotado" — RN-3, RN-4); o campo `disponivel` vem no objeto via `select("*")`.
 * O filtro `.eq("oculto", false)` é defesa em profundidade sobre a RLS 083 (§9.4),
 * não a substitui. Produtos sem categoria caem no grupo "Outros", que fica POR ÚLTIMO.
 * `categorias` é a lista já buscada (buscarCategorias) usada para ordenar/nomear os grupos.
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
    .eq("oculto", false)
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

/** Subconjunto de `opcionais` que entra no recálculo autoritativo do pedido. */
export type OpcionalParaPedido = Pick<
  Tables<"opcionais">,
  "id" | "loja_id" | "categoria_opcional_id" | "nome" | "preco" | "ativo"
>;

/**
 * Insumo do recálculo autoritativo de opcionais (issue 085, seguranca.md §10):
 * retorna preco/loja_id/categoria_opcional_id/nome/ativo REAIS dos opcionais
 * pelos ids. NÃO filtra por `ativo` (o recálculo precisa enxergar o inativo para
 * recusá-lo — RN-O5). Exige client com visibilidade adequada (service_role no
 * fluxo de pedido). Lista vazia → `[]` sem consultar o banco. Propaga `error` (§14).
 */
export async function buscarOpcionaisPorIds(
  client: Client,
  ids: string[],
): Promise<OpcionalParaPedido[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("opcionais")
    .select("id, loja_id, categoria_opcional_id, nome, preco, ativo")
    .in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/** Linha de `categoria_produto_opcionais` com a categoria de opcional e seus itens aninhados. */
type LinhaCategoriaOpcional = {
  categoria_id: string;
  opcionais_categorias: {
    id: string;
    nome: string;
    ordem: number;
    opcionais: OpcionalDisponivel[];
  } | null;
};

/**
 * Opcionais disponíveis por `categoria_id` de produto (vitrine SSR, issue 081).
 * JOIN `categoria_produto_opcionais → opcionais_categorias → opcionais` filtrado
 * pelas categorias de produto recebidas. A SEGURANÇA é 100% da RLS pública (080):
 * sob role anon, `opcionais` só vem com `ativo = true` e os três níveis só de loja
 * ativa — esta função NÃO reimplementa filtro de loja/ativo, só JOIN + agrupamento.
 * Nenhum preço é calculado aqui (preco é dado de exibição/preview).
 *
 * Retorna mapa `categoria_id → grupos`, grupos ordenados por `opcionais_categorias.ordem`
 * e itens por `opcionais.ordem`. Categoria sem associação (ou cujo grupo ficou sem
 * opcionais visíveis) simplesmente não aparece no mapa. Lista vazia → `{}` sem consulta.
 * Propaga `error` (§14).
 */
export async function buscarOpcionaisPorCategoria(
  client: Client,
  categoriaIds: string[],
): Promise<OpcionaisPorCategoria> {
  if (categoriaIds.length === 0) return {};

  const { data, error } = await client
    .from("categoria_produto_opcionais")
    .select(
      "categoria_id, opcionais_categorias(id, nome, ordem, opcionais(id, nome, preco, ordem))",
    )
    .in("categoria_id", categoriaIds);
  if (error) throw error;

  return agruparOpcionaisPorCategoria((data ?? []) as unknown as LinhaCategoriaOpcional[]);
}

/**
 * Agrupa/ordena linhas cruas de `categoria_produto_opcionais` em
 * `OpcionaisPorCategoria` — fonte única do agrupamento reusada por
 * `buscarOpcionaisPorCategoria` e `buscarOpcionaisPorCategoriaDaLoja` (evita
 * duas cópias divergindo silenciosamente no critério de ordenação/filtro).
 */
function agruparOpcionaisPorCategoria(
  linhas: LinhaCategoriaOpcional[],
): OpcionaisPorCategoria {
  const mapa: OpcionaisPorCategoria = {};

  for (const linha of linhas) {
    const cat = linha.opcionais_categorias;
    if (!cat) continue;

    const opcionais = [...(cat.opcionais ?? [])].sort((a, b) => a.ordem - b.ordem);
    if (opcionais.length === 0) continue; // grupo sem item visível (RLS escondeu todos)

    const grupos = (mapa[linha.categoria_id] ??= []);
    grupos.push({
      categoriaOpcionalId: cat.id,
      categoriaOpcionalNome: cat.nome,
      ordem: cat.ordem,
      opcionais,
    });
  }

  for (const grupos of Object.values(mapa)) {
    grupos.sort((a, b) => a.ordem - b.ordem);
  }

  return mapa;
}

/**
 * Variante ESCOPADA POR LOJA de `buscarOpcionaisPorCategoria`, para uso sob
 * `service_role` (BYPASSRLS) no loader admin (issue 132, rotas 142/143).
 *
 * CONFIANÇA / porquê a variante existe: a original delega 100% a isolação de
 * loja + o filtro `ativo` à RLS pública (080). Sob `service_role` essa RLS NÃO
 * se aplica — o JOIN `categoria_produto_opcionais → opcionais_categorias →
 * opcionais` sem `.eq("loja_id")` confiaria CEGAMENTE na lista `categoriaIds`, e
 * um `categoria_id` de outra loja vazaria a biblioteca de opcionais dela. Aqui o
 * `.eq("loja_id", lojaId)` em `categoria_produto_opcionais` é o ÚNICO ponto de
 * enforcement do escopo de loja (isolação por construção, precedente issue 130).
 *
 * NÃO filtra `ativo` (decisão do plano): paridade com a visão do dono no painel,
 * que enxerga opcionais inativos. Esconder inativos, se preciso, é do cliente.
 *
 * Mesmo select aninhado e mesmo agrupamento/ordenação da original (grupos por
 * `opcionais_categorias.ordem`, itens por `opcionais.ordem`). `categoriaIds`
 * vazio → `{}` sem consulta. `lojaId` fora de formato uuid → `{}` fail-closed
 * (defesa em profundidade; não substitui a validação do loader). Propaga `error` (§14).
 */
export async function buscarOpcionaisPorCategoriaDaLoja(
  client: Client,
  lojaId: string,
  categoriaIds: string[],
): Promise<OpcionaisPorCategoria> {
  if (categoriaIds.length === 0) return {};
  // `loja_id` é uuid no banco — formato inválido nunca vira query (evita 22P02
  // vazando erro cru, §14). Fail-closed: escopo inválido → nada.
  if (!schemaUuid.safeParse(lojaId).success) return {};

  const { data, error } = await client
    .from("categoria_produto_opcionais")
    .select(
      "categoria_id, opcionais_categorias(id, nome, ordem, opcionais(id, nome, preco, ordem))",
    )
    .eq("loja_id", lojaId)
    .in("categoria_id", categoriaIds);
  if (error) throw error;

  const linhas = (data ?? []) as unknown as LinhaCategoriaOpcional[];
  const mapa: OpcionaisPorCategoria = {};

  for (const linha of linhas) {
    const cat = linha.opcionais_categorias;
    if (!cat) continue;

    const opcionais = [...(cat.opcionais ?? [])].sort((a, b) => a.ordem - b.ordem);
    if (opcionais.length === 0) continue; // grupo sem item

    const grupos = (mapa[linha.categoria_id] ??= []);
    grupos.push({
      categoriaOpcionalId: cat.id,
      categoriaOpcionalNome: cat.nome,
      ordem: cat.ordem,
      opcionais,
    });
  }

  for (const grupos of Object.values(mapa)) {
    grupos.sort((a, b) => a.ordem - b.ordem);
  }

  return mapa;
}
