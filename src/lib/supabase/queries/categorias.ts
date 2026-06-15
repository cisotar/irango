import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries reusáveis de `categorias`. RLS já isola (seguranca.md §2):
 *  - leitura pública via `categorias_leitura_publica` (loja_esta_ativa);
 *  - leitura/escrita própria do dono.
 * Funções recebem o `client` por parâmetro (role escolhida pelo caller).
 * Propagam `error` (§14); `[]` = sem linha, nunca mascara erro.
 */
type Client = SupabaseClient<Database>;

export type Categoria = Tables<"categorias">;

/**
 * Categorias de uma loja, ordenadas por `ordem` ascendente.
 * Sob role anon, a RLS retorna só categorias de loja ativa.
 */
export async function buscarCategorias(
  client: Client,
  lojaId: string,
): Promise<Categoria[]> {
  const { data, error } = await client
    .from("categorias")
    .select("*")
    .eq("loja_id", lojaId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
