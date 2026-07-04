// Queries reusáveis de `pedidos` (issue 026). Acesso centralizado respeitando RLS.
// NUNCA `.from('pedidos')` inline em outro lugar — use estas funções.
//
// Todas recebem o `Client` por parâmetro (testabilidade + escolha de role pelo caller).
// Não criam client nem leem `process.env`.
//
// Tratamento de erro (seguranca.md §14): propagam o `error` do PostgREST.
// `null`/`[]` significam "sem linha" — NUNCA mascaram erro.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

// z.guid() valida o FORMATO uuid sem exigir os nibbles de versão/variante
// RFC-4122 (z.uuid() rejeitaria ids válidos do Postgres em casos de borda) —
// mesmo padrão de src/lib/validacoes/pedido.ts.
const schemaUuid = z.guid();

// Projeção única de pedido + itens + opcionais (snapshot). Fonte única para
// TODAS as leituras de pedido — painel e admin compartilham o mesmo shape
// (PedidoComItens); uma relação nova entra aqui e vale para os dois mundos.
const SELECT_PEDIDO_COM_ITENS = "*, itens_pedido(*, itens_pedido_opcionais(*))";

type Client = SupabaseClient<Database>;

/** Row da TABELA `pedidos`. */
export type Pedido = Tables<"pedidos">;
/** Row da TABELA `itens_pedido`. */
export type ItemPedido = Tables<"itens_pedido">;
/** Row da TABELA `itens_pedido_opcionais` — snapshot imutável do opcional (RN-O6). */
export type ItemPedidoOpcional = Tables<"itens_pedido_opcionais">;
/** Item do pedido com seus opcionais (snapshot) aninhados. */
export type ItemPedidoComOpcionais = ItemPedido & {
  itens_pedido_opcionais: ItemPedidoOpcional[];
};
/** Pedido com itens aninhados (join), cada item com seus opcionais (snapshot). */
export type PedidoComItens = Pedido & {
  itens_pedido: ItemPedidoComOpcionais[];
};

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
  // `id`/`token_acesso` são uuid no banco — formato inválido nunca vira query
  // (evita 22P02 do Postgres; trata como "sem linha", igual token errado).
  if (!schemaUuid.safeParse(pedidoId).success || !schemaUuid.safeParse(token).success) {
    return null;
  }
  const { data, error } = await client
    .from("pedidos")
    .select(SELECT_PEDIDO_COM_ITENS)
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
    .select(SELECT_PEDIDO_COM_ITENS)
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
    .select(SELECT_PEDIDO_COM_ITENS)
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Hub admin lista pedidos de UMA loja-alvo sob service_role (BYPASSRLS).
 * A RLS NÃO protege neste role — a isolação cross-tenant vem SÓ do
 * `.eq("loja_id", lojaId)` explícito. Espelha `listarPedidosDoDono` + escopo por loja.
 * `lojaId` já validado pelo loader (issue 138). Filtro por status opcional.
 */
export async function listarPedidosDaLoja(
  svc: Client,
  lojaId: string,
  filtros?: FiltrosPedidos,
): Promise<PedidoComItens[]> {
  // `loja_id` é uuid no banco — formato inválido nunca vira query (evita 22P02
  // vazando erro cru do Postgres, §14). Fail-closed: escopo inválido → nada.
  // Simetria com o guard de `id` em buscarPedidoDaLoja; não substitui a validação
  // do caller (loader admin), é defesa-em-profundidade.
  if (!schemaUuid.safeParse(lojaId).success) {
    return [];
  }
  let query = svc
    .from("pedidos")
    .select(SELECT_PEDIDO_COM_ITENS)
    .eq("loja_id", lojaId)
    .order("criado_em", { ascending: false });
  if (filtros?.status !== undefined) {
    query = query.eq("status", filtros.status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Hub admin lê um pedido de UMA loja-alvo sob service_role (BYPASSRLS).
 * Duplo `.eq("loja_id", lojaId).eq("id", id)`: um id válido de OUTRA loja → null
 * (a linha não bate o loja_id). Espelha `buscarPedidoDoDono` + escopo por loja.
 * `lojaId` já validado pelo loader (issue 138); guard local é defesa-em-profundidade.
 * id em formato não-UUID → null sem tocar o banco (evita 22P02).
 */
export async function buscarPedidoDaLoja(
  svc: Client,
  lojaId: string,
  id: string,
): Promise<PedidoComItens | null> {
  // Ambos `loja_id` e `id` são uuid no banco — formato inválido em qualquer um
  // deles nunca vira query (evita 22P02, §14). Fail-closed → null.
  if (!schemaUuid.safeParse(lojaId).success || !schemaUuid.safeParse(id).success) {
    return null;
  }
  const { data, error } = await svc
    .from("pedidos")
    .select(SELECT_PEDIDO_COM_ITENS)
    .eq("loja_id", lojaId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
