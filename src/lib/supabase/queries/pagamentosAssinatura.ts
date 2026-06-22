import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries reusáveis de `pagamentos_assinatura` (issue 081). Histórico de faturas
 * da assinatura. NUNCA `.from('pagamentos_assinatura')` inline — use estas funções.
 *
 * O `valor` lido aqui é AUTORITATIVO do servidor (gravado pelo webhook 077 via
 * service_role). A UI apenas FORMATA com `formatarMoeda` — nunca recalcula
 * (seguranca.md §10). Recebe o client por parâmetro; o caller injeta o client
 * AUTENTICADO para que a RLS escope as faturas à loja do `auth.uid()`.
 */
type Client = SupabaseClient<Database>;

export type FaturaAssinatura = Tables<"pagamentos_assinatura">;

/**
 * Lista as faturas da loja do lojista autenticado, mais recentes primeiro.
 * Fonte: TABELA `pagamentos_assinatura` (RLS escopa por `loja_id`). Loja sem
 * faturas → `[]`. Propaga o `error` do PostgREST (seguranca.md §14).
 *
 * NÃO recebe `lojaId` por parâmetro: o escopo é a RLS sobre o client
 * autenticado — nunca confiar num id vindo do cliente (D2).
 */
export async function listarFaturasDaLoja(
  client: Client,
  limite = 24,
): Promise<FaturaAssinatura[]> {
  const { data, error } = await client
    .from("pagamentos_assinatura")
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}
