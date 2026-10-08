import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import {
  buscarRankingClientes,
  contarPedidosConvidados,
  type LinhaRankingCliente,
} from "@/lib/supabase/queries/vendas";
import { codigoDoErro } from "@/lib/utils/codigoDoErro";
import { janelaDoRanking } from "@/lib/utils/periodoVendas";
import { schemaItensTop, type FiltrosRanking } from "@/lib/validacoes/vendas";
import { LIMITE_RANKING } from "@/lib/vendas/tipos";

/**
 * Ranking de clientes fiéis (issue 357/356, RN-V18..V20). SÓ do painel do
 * lojista: as RPCs escopam pela loja de `auth.uid()`, então só fazem sentido com
 * o client da sessão. O hub admin nunca importa este módulo (RN-V23).
 *
 * Ordenação e corte são do SQL: as linhas são mapeadas SEM reordenar. O ranking
 * não traz telefone nem e-mail, só o nome do cliente.
 */
export type ClienteRanking = {
  clienteId: string;
  nome: string;
  totalPedidos: number;
  totalGasto: number;
  ultimoPedidoEm: string;
  itensTop: { nome: string; quantidade: number }[];
};

export type ResultadoRanking =
  | { ok: true; rotuloPeriodo: string; clientes: ClienteRanking[]; convidados: number }
  | { ok: false };

function paraCliente(l: LinhaRankingCliente): ClienteRanking {
  const itens = schemaItensTop.safeParse(l.itens_top);
  return {
    clienteId: l.cliente_id,
    nome: l.nome,
    totalPedidos: Number(l.total_pedidos),
    totalGasto: Number(l.total_gasto),
    ultimoPedidoEm: l.ultimo_pedido_em,
    itensTop: itens.success ? itens.data : [],
  };
}

export async function carregarRankingClientes(
  client: SupabaseClient<Database>,
  loja: Pick<LojaCompleta, "timezone" | "dia_inicio_ciclo">,
  ranking: FiltrosRanking,
  agora: Date,
): Promise<ResultadoRanking> {
  try {
    const janela = janelaDoRanking(ranking.periodo, agora, loja.timezone, loja.dia_inicio_ciclo);
    const [linhas, convidados] = await Promise.all([
      buscarRankingClientes(client, {
        inicio: janela.inicio,
        fim: janela.fim,
        ordem: ranking.ordem,
        limite: LIMITE_RANKING,
      }),
      contarPedidosConvidados(client, { inicio: janela.inicio, fim: janela.fim }),
    ]);
    return {
      ok: true,
      rotuloPeriodo: janela.rotulo,
      clientes: linhas.map(paraCliente),
      convidados,
    };
  } catch (e) {
    console.error("[vendas] carregar clientes fiéis", codigoDoErro(e));
    return { ok: false };
  }
}
