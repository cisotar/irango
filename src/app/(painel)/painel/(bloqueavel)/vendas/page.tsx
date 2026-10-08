import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { RankingClientesFieis } from "@/components/painel/RankingClientesFieis";
import { RelatorioVendas } from "@/components/painel/RelatorioVendas";
import { salvarCicloVendas } from "@/lib/actions/vendas";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { lerParamsVendas } from "@/lib/validacoes/vendas";
import { carregarRankingClientes } from "@/lib/vendas/carregarRankingClientes";
import { carregarRelatorioVendas } from "@/lib/vendas/carregarRelatorioVendas";

const BASE = "/painel/vendas";

/**
 * Relatório de vendas do lojista (issue 358, spec relatorio-vendas rota 2).
 * Server Component: filtros da URL revalidados por zod (`lerParamsVendas`,
 * nunca lança); loja da SESSÃO; valores das funções SQL com o client da sessão
 * (RLS + trava de posse no corpo). O card de clientes fiéis é só deste mundo.
 */
export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { filtros, ranking, avisoFiltros } = lerParamsVendas(await searchParams);

  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) redirect("/painel");

  const agora = new Date();
  const [relatorio, clientes] = await Promise.all([
    carregarRelatorioVendas(supabase, loja, filtros, agora),
    carregarRankingClientes(supabase, loja, ranking, agora),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref="/painel" voltarRotulo="Painel" titulo="Vendas" />
      <RelatorioVendas
        baseVendas={BASE}
        filtros={filtros}
        ranking={ranking}
        avisoFiltros={avisoFiltros}
        diaInicioCiclo={loja.dia_inicio_ciclo}
        relatorio={relatorio}
        salvarCiclo={salvarCicloVendas}
      />
      <RankingClientesFieis
        baseVendas={BASE}
        filtros={filtros}
        ranking={ranking}
        resultado={clientes}
        timezone={loja.timezone}
      />
    </div>
  );
}
