import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OrdemRanking, TipoEntregaFiltro } from "@/lib/vendas/tipos";

/**
 * Wrappers das RPCs do relatório de vendas (issues 355/356).
 *
 * - `vendas_por_dia` / `vendas_itens_por_categoria`: SECURITY INVOKER com trava
 *   de posse no corpo; servem ao client da SESSÃO (lojista) e ao service_role
 *   (admin, `p_loja_id` já validado). O escopo é o `WHERE loja_id = p_loja_id`
 *   do SQL — sem `.eq` aqui.
 * - `ranking_clientes_da_loja` / `pedidos_convidados_da_loja`: SECURITY DEFINER
 *   escopadas pela loja de `auth.uid()`; só fazem sentido com o client da sessão.
 *
 * Propagam `error` sem traduzir: o chamador loga o código e mostra a mensagem
 * genérica (seguranca.md §14). Valor monetário vem só do banco.
 */
type Client = SupabaseClient<Database>;
type Fn = Database["public"]["Functions"];

/** Faixa `[inicio, fim)` em ISO UTC, já derivada do calendário local da loja. */
export type FaixaVendas = {
  lojaId: string;
  inicio: string;
  fim: string;
  tipoEntrega: TipoEntregaFiltro;
  soConcluidos: boolean;
};

export type LinhaVendasDia = Fn["vendas_por_dia"]["Returns"][number];

/** D16: o gen types tipa coluna de RETURNS TABLE como não nula; o balde "Sem categoria" é NULL. */
export type LinhaItemCategoria = Omit<
  Fn["vendas_itens_por_categoria"]["Returns"][number],
  "categoria_id" | "categoria_nome"
> & { categoria_id: string | null; categoria_nome: string | null };

export type LinhaRankingCliente = Fn["ranking_clientes_da_loja"]["Returns"][number];

/** "ambos" omite `p_tipo_entrega` (→ NULL no SQL = sem filtro). */
function argsFaixa(faixa: FaixaVendas) {
  return {
    p_loja_id: faixa.lojaId,
    p_inicio: faixa.inicio,
    p_fim: faixa.fim,
    p_so_concluidos: faixa.soConcluidos,
    ...(faixa.tipoEntrega !== "ambos" ? { p_tipo_entrega: faixa.tipoEntrega } : {}),
  };
}

export async function buscarVendasPorDia(client: Client, faixa: FaixaVendas): Promise<LinhaVendasDia[]> {
  const { data, error } = await client.rpc("vendas_por_dia", argsFaixa(faixa));
  if (error) throw error;
  return data ?? [];
}

export async function buscarItensPorCategoria(
  client: Client,
  faixa: FaixaVendas,
): Promise<LinhaItemCategoria[]> {
  const { data, error } = await client.rpc("vendas_itens_por_categoria", argsFaixa(faixa));
  if (error) throw error;
  return data ?? [];
}

/** `inicio` null = desde o início (chave omitida). Ordenação e corte são do SQL. */
export async function buscarRankingClientes(
  client: Client,
  f: { inicio: string | null; fim: string; ordem: OrdemRanking; limite: number },
): Promise<LinhaRankingCliente[]> {
  const { data, error } = await client.rpc("ranking_clientes_da_loja", {
    ...(f.inicio !== null ? { p_inicio: f.inicio } : {}),
    p_fim: f.fim,
    p_ordem: f.ordem,
    p_limite: f.limite,
  });
  if (error) throw error;
  return data ?? [];
}

/** Pedidos de convidado (cliente_id NULL) no mesmo escopo/período do ranking. */
export async function contarPedidosConvidados(
  client: Client,
  f: { inicio: string | null; fim: string },
): Promise<number> {
  const { data, error } = await client.rpc("pedidos_convidados_da_loja", {
    ...(f.inicio !== null ? { p_inicio: f.inicio } : {}),
    p_fim: f.fim,
  });
  if (error) throw error;
  return data ?? 0;
}
