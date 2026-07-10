import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

// z.guid() valida o FORMATO uuid sem exigir os nibbles de versão/variante
// RFC-4122 — mesmo padrão de entregaPagamento.ts / pedidos.ts. Guarda a
// variante admin contra `22P02` (uuid malformado vazando erro cru, §14).
const schemaUuid = z.guid();

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

/**
 * Lista as faturas de UMA loja-alvo sob service_role (BYPASSA RLS) — caminho do
 * hub admin. Espelho `(svc, lojaId)` de `listarFaturasDaLoja` + escopo explícito
 * `.eq("loja_id", lojaId)`. Mesma ordenação (`criado_em` desc) e `limite`. Loja
 * sem faturas → `[]`. Propaga o `error` do PostgREST (seguranca.md §14).
 *
 * NOTA DE CONFIANÇA (espelha `listarCuponsDaLoja`): EXIGE client **service_role**
 * injetado pelo caller (loader admin), que já revalidou `lojaId` e provou admin.
 * Sob service_role a RLS de `pagamentos_assinatura` NÃO filtra: o
 * `.eq("loja_id", lojaId)` é a ÚNICA barreira de isolamento cross-loja — sem ele
 * o `select("*")` vazaria faturas (valor monetário) de TODAS as lojas.
 *
 * O `valor` é AUTORITATIVO do webhook 077; aqui só se LÊ, nunca se recalcula.
 */
export async function listarFaturasDaLojaAdmin(
  svc: Client,
  lojaId: string,
  limite = 24,
): Promise<FaturaAssinatura[]> {
  // `loja_id` é uuid no banco — formato inválido nunca vira query (evita 22P02,
  // §14). Defesa-em-profundidade; NÃO substitui o `.eq`, que é a barreira real.
  if (!schemaUuid.safeParse(lojaId).success) {
    return [];
  }
  const { data, error } = await svc
    .from("pagamentos_assinatura")
    .select("*")
    .eq("loja_id", lojaId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}
