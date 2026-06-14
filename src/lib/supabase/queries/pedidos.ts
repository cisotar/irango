// Queries reusáveis de `pedidos` (issue 026). Acesso centralizado respeitando RLS.
// NUNCA `.from('pedidos')` inline em outro lugar — use estas funções.
//
// Todas recebem o `Client` por parâmetro (testabilidade + escolha de role pelo caller).
// Não criam client nem leem `process.env`.
//
// Tratamento de erro (seguranca.md §14): propagam o `error` do PostgREST.
// `null`/`[]` significam "sem linha" — NUNCA mascaram erro.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/** Row da TABELA `pedidos`. */
export type Pedido = Tables<"pedidos">;
/** Row da TABELA `itens_pedido`. */
export type ItemPedido = Tables<"itens_pedido">;
/** Pedido com itens aninhados (join). */
export type PedidoComItens = Pedido & { itens_pedido: ItemPedido[] };

/** Filtros opcionais da listagem do lojista. */
export type FiltrosPedidos = { status?: string };

/**
 * Leitura do cliente sem login — ÚNICA via de ler um pedido (não há SELECT anon).
 * Exige client **service_role** (BYPASSRLS): `WHERE id = $1 AND token_acesso = $2`.
 * O token funciona como senha do pedido. Token/id errado → null. Injetado pelo caller.
 */
export async function buscarPedidoPorToken(
  client: Client,
  pedidoId: string,
  token: string,
): Promise<PedidoComItens | null> {
  const { data, error } = await client
    .from("pedidos")
    .select("*, itens_pedido(*)")
    .eq("id", pedidoId)
    .eq("token_acesso", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Lojista lista pedidos da própria loja (RLS pedidos_acesso_lojista), com itens. Filtro por status opcional. */
export async function listarPedidosDoDono(
  client: Client,
  filtros?: FiltrosPedidos,
): Promise<PedidoComItens[]> {
  let query = client
    .from("pedidos")
    .select("*, itens_pedido(*)")
    .order("criado_em", { ascending: false });
  if (filtros?.status !== undefined) {
    query = query.eq("status", filtros.status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Lojista lê um pedido próprio + itens (RLS). Não encontrado / de outra loja → null. */
export async function buscarPedidoDoDono(
  client: Client,
  pedidoId: string,
): Promise<PedidoComItens | null> {
  const { data, error } = await client
    .from("pedidos")
    .select("*, itens_pedido(*)")
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
