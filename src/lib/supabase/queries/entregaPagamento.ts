// Queries reusáveis de entrega, pagamento e cupom (issue 025).
//
// Padrão de lojas.ts: o caller injeta o `Client` (1º arg) — escolhe a role e a
// testabilidade fica no caller. Não criam client nem leem `process.env`.
// Tratamento de erro (seguranca.md §14): PROPAGAM o `error` do PostgREST;
// `null`/`[]` significam "sem linha" — NUNCA mascaram erro.
//
// CONTRATO DE SEGURANÇA (seguranca.md §2 — cupons):
//   - Zonas/taxas/bairros e formas de pagamento têm leitura PÚBLICA (vitrine
//     precisa para o checkout) — RLS filtra loja/zona ativa.
//   - Cupons NÃO têm SELECT público (cupons_acesso_proprio). LOJISTA lê os
//     próprios; a validação do cliente é Server Action (013) com SERVICE_ROLE.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { ZonaComTaxa } from "@/lib/utils/calcularFrete";

type Client = SupabaseClient<Database>;

export type FormaPagamento = Tables<"formas_pagamento">;
export type Cupom = Tables<"cupons">;

/**
 * Zonas da loja já hidratadas com taxa (1:1) e bairros (1:N), no shape que
 * `calcularFrete` consome (`ZonaComTaxa`). Fonte: TABELA `zonas_entrega`,
 * escopo `eq('loja_id')`. Leitura PÚBLICA (RLS só expõe zonas ativas + filhas).
 *
 * PostgREST embute relações filhas como array; normalizamos `taxa` (1:1) para
 * objeto/null. Loja sem zonas → `[]`.
 */
export async function listarZonasComTaxas(
  client: Client,
  lojaId: string,
): Promise<ZonaComTaxa[]> {
  const { data, error } = await client
    .from("zonas_entrega")
    .select(
      "id, tipo, ativo, taxa:taxas_entrega(taxa, pedido_minimo_gratis, raio_max_km), bairros:bairros_zona(nome)",
    )
    .eq("loja_id", lojaId);
  if (error) throw error;
  return (data ?? []).map((zona) => {
    const taxa = (zona as { taxa: unknown }).taxa;
    return {
      ...zona,
      // 1:1: PostgREST devolve array embutido — colapsa para objeto/null.
      taxa: Array.isArray(taxa) ? (taxa[0] ?? null) : (taxa ?? null),
      bairros: (zona as { bairros: { nome: string }[] }).bairros ?? [],
    } as ZonaComTaxa;
  });
}

/**
 * Formas de pagamento da loja. Fonte: TABELA `formas_pagamento`, escopo
 * `eq('loja_id')`. Leitura PÚBLICA (RLS só expõe formas de loja ativa).
 * Loja sem formas → `[]`.
 */
export async function listarFormasPagamento(
  client: Client,
  lojaId: string,
): Promise<FormaPagamento[]> {
  const { data, error } = await client
    .from("formas_pagamento")
    .select("*")
    .eq("loja_id", lojaId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Um cupom do LOJISTA autenticado, por código. Fonte: TABELA `cupons`
 * (RLS `cupons_acesso_proprio` — só o dono enxerga). `maybeSingle` (UM registro).
 * Dono sem o cupom → `null`.
 */
export async function buscarCupomDoDono(
  client: Client,
  codigo: string,
): Promise<Cupom | null> {
  const { data, error } = await client
    .from("cupons")
    .select("*")
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Lista os cupons do LOJISTA autenticado. Fonte: TABELA `cupons`
 * (RLS `cupons_acesso_proprio` filtra os do dono). Sem cupons → `[]`.
 */
export async function listarCuponsDoDono(client: Client): Promise<Cupom[]> {
  const { data, error } = await client.from("cupons").select("*");
  if (error) throw error;
  return data ?? [];
}

/**
 * Um cupom escopado por (loja_id, codigo) — caminho de validação do cliente.
 * Fonte: TABELA `cupons`, escopo DUPLO `eq('loja_id')` + `eq('codigo')`,
 * `maybeSingle` (UM registro — NUNCA lista ao cliente).
 *
 * EXIGE client **service_role** injetado pelo caller (Server Action 013):
 * não há SELECT público de cupom (cupons_acesso_proprio), então chamar com
 * client anon retorna `null` SEMPRE (vazaria a estratégia de promoção).
 * Código inexistente na loja → `null`.
 */
export async function buscarCupomPorCodigo(
  client: Client,
  lojaId: string,
  codigo: string,
): Promise<Cupom | null> {
  const { data, error } = await client
    .from("cupons")
    .select("*")
    .eq("loja_id", lojaId)
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw error;
  return data;
}
