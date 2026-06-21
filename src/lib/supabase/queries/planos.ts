import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries reusáveis de `planos` (issue 078). Catálogo GLOBAL de planos de
 * assinatura — sem `dono_id` (não pertence a loja). NUNCA `.from('planos')`
 * inline em outro lugar — use estas funções.
 *
 * O `preco` lido aqui é o valor AUTORITATIVO da assinatura (RN-1, seguranca.md
 * §10): a Server Action passa `planos.preco` ao provider, NUNCA um valor vindo
 * do cliente.
 */
type Client = SupabaseClient<Database>;

export type Plano = Tables<"planos">;

/**
 * Plano ATIVO por id. Fonte: TABELA `planos`, escopada por `id` + `ativo = true`.
 * Plano inexistente ou inativo → `null` (a action retorna "Plano indisponível.").
 *
 * Recebe o client por parâmetro (a action injeta o service_role — `planos` é
 * catálogo, mas a leitura roda no mesmo fluxo server-only de billing).
 * Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarPlanoAtivo(
  client: Client,
  planoId: string,
): Promise<Plano | null> {
  const { data, error } = await client
    .from("planos")
    .select("*")
    .eq("id", planoId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Lista os planos ATIVOS para o lojista escolher (issue 081). Fonte: TABELA
 * `planos` (`ativo = true`), ordenados por preço crescente. `preco` é
 * AUTORITATIVO — a UI só exibe; a action confia em `planos.preco`, nunca no
 * payload. Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function listarPlanosAtivos(client: Client): Promise<Plano[]> {
  const { data, error } = await client
    .from("planos")
    .select("*")
    .eq("ativo", true)
    .order("preco", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
