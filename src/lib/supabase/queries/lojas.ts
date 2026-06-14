import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/database.types";

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
 * Loja por id para o recálculo autoritativo de pedido (issue 014). Fonte:
 * TABELA `lojas` (não a view `vitrine_lojas`, que esconde `ativo`/`horarios`/
 * `timezone`/`assinatura_*` necessários a `lojaAberta`/`assinaturaPermiteAcesso`).
 *
 * EXIGE client **service_role** (BYPASSRLS) injetado pelo caller (Server Action
 * 014): precisa enxergar a loja mesmo inativa para barrá-la no guard da action.
 * O payload do pedido traz `loja_id` (não slug). Loja inexistente → `null`.
 */
export async function buscarLojaParaPedido(
  client: Client,
  lojaId: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .from("lojas")
    .select("*")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Mapeia comprador→loja pelo e-mail do DONO (issue 057, webhook Hotmart). Fonte:
 * função SQL `public.loja_por_email_dono` (SECURITY DEFINER) — o vínculo está em
 * `auth.users.email`, que NÃO é tabela PostgREST, logo `.from('auth.users')` não
 * funciona nem com service_role.
 *
 * EXIGE client **service_role**: a função só tem `grant execute` para service_role
 * (anon/authenticated não mapeiam e-mail→loja — PII + vínculo dono↔loja). O e-mail
 * já vem normalizado (lower/trim) pelo caller; a função também faz `lower()` nos
 * dois lados. Comprador sem loja → `null` (reconciliação fica p/ issue 059).
 *
 * Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarLojaPorEmailDono(
  client: Client,
  email: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .rpc("loja_por_email_dono", { p_email: email })
    .maybeSingle();
  if (error) throw error;
  return data;
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

/**
 * INSERT autoritativo de loja no cadastro (issue 015). Encapsula a escrita
 * (NUNCA `.from('lojas').insert` inline — DRY de queries, architecture.md §8).
 *
 * Exige client **service_role**: roda logo após o `signUp`, quando o cookie de
 * sessão pode não estar disponível de forma síncrona, e a RLS de INSERT
 * (`auth.uid() = dono_id`) ainda não enxergaria a sessão. O `dados` já vem
 * montado pela action — `dono_id` do retorno do signUp, consentimento/trial
 * decididos pelo servidor (o client nunca envia esses campos).
 *
 * Propaga o `error` do PostgREST (seguranca.md §14) — a action trata 23505
 * (corrida de slug / índice único de dono).
 */
export async function criarLoja(
  client: Client,
  dados: TablesInsert<"lojas">,
): Promise<LojaCompleta> {
  const { data, error } = await client.from("lojas").insert(dados).select("*").single();
  if (error) throw error;
  return data;
}
