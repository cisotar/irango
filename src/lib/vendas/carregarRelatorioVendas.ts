import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import {
  buscarItensPorCategoria,
  buscarVendasPorDia,
  type FaixaVendas,
  type LinhaVendasDia,
} from "@/lib/supabase/queries/vendas";
import {
  agruparItensPorCategoria,
  agruparPorCiclo,
  agruparPorSemana,
  barrasDiarias,
  preencherDias,
  somarLinhas,
  type BarraVendas,
  type CategoriaVendas,
  type LinhaDiariaVendas,
  type TotaisVendas,
} from "@/lib/utils/agregarVendas";
import { codigoDoErro } from "@/lib/utils/codigoDoErro";
import { montarContextoVendas, type ContextoVendas } from "@/lib/utils/periodoVendas";
import type { FiltrosVendas } from "@/lib/validacoes/vendas";

/**
 * Montagem do relatório de vendas (issue 357), compartilhada pelo painel
 * (client da SESSÃO) e pelo hub admin (service_role, loja já validada).
 * Plano: plan/tecnico-relatorio-vendas.md §7.6 (D13).
 *
 * Os valores vêm das funções SQL (`vendas_por_dia`, `vendas_itens_por_categoria`),
 * chamadas com a MESMA faixa; aqui só se preenche dias vazios e se reagrupa.
 * De propósito este módulo não conhece clientes: o admin o usa (RN-V23).
 *
 * Toda falha (RPC, posse recusada, fuso inválido) vira `{ ok: false }`; o log
 * leva só o código do erro (seguranca.md §14).
 */
export type LojaVendas = Pick<LojaCompleta, "id" | "timezone" | "dia_inicio_ciclo">;

export type DadosVendas = {
  totais: TotaisVendas;
  barras: { diario: BarraVendas[]; semanal: BarraVendas[]; mensal: BarraVendas[] };
  categorias: CategoriaVendas[];
};

export type ResultadoRelatorioVendas =
  | { ok: true; contexto: ContextoVendas; dados: DadosVendas }
  | { ok: false };

function paraLinhaDiaria(l: LinhaVendasDia): LinhaDiariaVendas {
  return {
    dia: l.dia,
    pedidos: Number(l.qtd_pedidos),
    bruto: Number(l.bruto),
    descontos: Number(l.descontos),
    liquido: Number(l.liquido),
    frete: Number(l.frete),
    freteACombinar: Number(l.qtd_frete_a_combinar),
  };
}

export async function carregarRelatorioVendas(
  client: SupabaseClient<Database>,
  loja: LojaVendas,
  filtros: FiltrosVendas,
  agora: Date,
): Promise<ResultadoRelatorioVendas> {
  try {
    const contexto = montarContextoVendas(loja, filtros, agora);
    const faixa: FaixaVendas = {
      lojaId: loja.id,
      inicio: contexto.janela.inicio,
      fim: contexto.janela.fim,
      tipoEntrega: filtros.entrega,
      soConcluidos: filtros.concluidos,
    };
    const [porDia, itens] = await Promise.all([
      buscarVendasPorDia(client, faixa),
      buscarItensPorCategoria(client, faixa),
    ]);

    const dias = preencherDias(porDia.map(paraLinhaDiaria), contexto.janela);
    return {
      ok: true,
      contexto,
      dados: {
        totais: somarLinhas(dias),
        barras: {
          diario: barrasDiarias(dias),
          semanal: agruparPorSemana(dias),
          mensal: agruparPorCiclo(dias, loja.dia_inicio_ciclo),
        },
        categorias: agruparItensPorCategoria(itens),
      },
    };
  } catch (e) {
    console.error("[vendas] carregar relatório", codigoDoErro(e));
    return { ok: false };
  }
}
