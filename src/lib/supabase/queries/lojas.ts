import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries reusáveis de `lojas` (issue 023). Acesso centralizado respeitando RLS.
 * NUNCA `.from('lojas')` inline em outro lugar — use estas funções.
 *
 * Todas recebem o `Client` por parâmetro (testabilidade + escolha de role pelo caller).
 * Não criam client nem leem `process.env`.
 *
 * Tratamento de erro (seguranca.md §14): propagam o `error` do PostgREST.
 * `null`/`false`/`0` significam "sem linha" — NUNCA mascaram erro.
 */
type Client = SupabaseClient<Database>;

/** Row da VIEW `vitrine_lojas` — colunas públicas, sem dados sensíveis. */
export type LojaPublica = Tables<"vitrine_lojas">;

/** Row da TABELA `lojas` — loja completa (uso do dono). */
export type LojaCompleta = Tables<"lojas">;

/**
 * Vitrine pública (SSR, role anon). Fonte: VIEW `vitrine_lojas` (já filtra `ativo = true`).
 * NUNCA a tabela `lojas`. Loja inativa/inexistente → `null`.
 */
export async function buscarLojaPorSlug(
  client: Client,
  slug: string,
): Promise<LojaPublica | null> {
  const { data, error } = await client
    .from("vitrine_lojas")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Painel: a loja do lojista autenticado. Fonte: TABELA `lojas` (RLS `lojas_leitura_propria`
 * — escopo `auth.uid() = dono_id`). Dono sem loja / não autenticado → `null`.
 */
export async function buscarLojaDoDono(client: Client): Promise<LojaCompleta | null> {
  const { data, error } = await client.from("lojas").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Checagem autoritativa de unicidade de slug. Fonte: TABELA `lojas`.
 * Exige client **service_role** (BYPASSRLS) — precisa enxergar lojas inativas, que
 * a view esconde. O factory service_role é injetado pelo caller (issue 030).
 * `exceto` = id da própria loja, ignorado na contagem (permite salvar sem trocar slug).
 */
export async function slugExiste(
  client: Client,
  slug: string,
  exceto?: string,
): Promise<boolean> {
  let query = client.from("lojas").select("id").eq("slug", slug);
  if (exceto !== undefined) {
    query = query.neq("id", exceto);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Contagem autoritativa de lojas de um dono (RN-01: uma loja por dono).
 * Fonte: TABELA `lojas`. Exige client **service_role** — RLS esconderia lojas de
 * outro `auth.uid()`. Injetado pelo caller (issue 030).
 */
export async function contarLojasDoDono(client: Client, donoId: string): Promise<number> {
  const { count, error } = await client
    .from("lojas")
    .select("*", { count: "exact", head: true })
    .eq("dono_id", donoId);
  if (error) throw error;
  return count ?? 0;
}
