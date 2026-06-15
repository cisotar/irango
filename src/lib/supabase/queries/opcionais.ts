import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries reusáveis de opcionais para o PAINEL do lojista (issues 088/089).
 * RLS já isola (seguranca.md §2, migration 080):
 *  - opcionais_categorias / categoria_produto_opcionais: leitura pública (loja ativa)
 *    e leitura/escrita própria do dono;
 *  - opcionais: leitura própria do dono inclui inativos; escrita só do dono.
 * Funções recebem o `client` por parâmetro (role escolhida pelo caller).
 * Propagam `error` (§14); `[]` = sem linha, nunca mascara erro.
 *
 * loja_id é sempre passado pelo caller (derivado do dono autenticado, nunca do
 * cliente) — defesa em profundidade junto da RLS.
 */
type Client = SupabaseClient<Database>;

export type CategoriaOpcional = Tables<"opcionais_categorias">;
export type Opcional = Tables<"opcionais">;
export type AssociacaoCategoriaProdutoOpcional =
  Tables<"categoria_produto_opcionais">;

/**
 * Categorias de opcional de uma loja, ordenadas por `ordem` ascendente.
 * Sob role do dono, a RLS retorna as próprias.
 */
export async function buscarCategoriasOpcional(
  client: Client,
  lojaId: string,
): Promise<CategoriaOpcional[]> {
  const { data, error } = await client
    .from("opcionais_categorias")
    .select("*")
    .eq("loja_id", lojaId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Opcionais (itens da biblioteca) de uma loja, ordenados por `ordem`.
 * Sob role do dono, a RLS `opcionais_leitura_propria` traz também os inativos.
 */
export async function buscarOpcionaisDoLojista(
  client: Client,
  lojaId: string,
): Promise<Opcional[]> {
  const { data, error } = await client
    .from("opcionais")
    .select("*")
    .eq("loja_id", lojaId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Associações categoria-de-produto ⋈ categoria-de-opcional de uma loja.
 * Usada pela UI de associação (089) para marcar os checkboxes.
 */
export async function buscarAssociacoesOpcional(
  client: Client,
  lojaId: string,
): Promise<AssociacaoCategoriaProdutoOpcional[]> {
  const { data, error } = await client
    .from("categoria_produto_opcionais")
    .select("*")
    .eq("loja_id", lojaId);
  if (error) throw error;
  return data ?? [];
}
