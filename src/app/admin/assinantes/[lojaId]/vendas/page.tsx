import type { ReactElement } from "react";

import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { RelatorioVendas } from "@/components/painel/RelatorioVendas";
import { salvarCicloVendasAdmin } from "@/app/admin/assinantes/actions/admin-vendas";
import { lerParamsVendas } from "@/lib/validacoes/vendas";
import { carregarVendasLojaAdmin } from "../carga-vendas";

/**
 * Aba Vendas do hub admin (issue 358, spec relatorio-vendas rota 3). A mesma
 * parte financeira do painel, lida pelo loader fail-closed `carga-vendas.ts`
 * (valida o `lojaId`, prova admin antes de elevar, escopa por loja). Só o
 * financeiro: dado de cliente não é carregado nem exibido aqui (RN-V20).
 *
 * `salvarCiclo` é a action ADMIN com `.bind(null, lojaId)` (D12): o `lojaId`
 * fica fixado no servidor e a prop é obrigatória no `RelatorioVendas`.
 */
export const dynamic = "force-dynamic";

export default async function VendasAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ lojaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { filtros, avisoFiltros } = lerParamsVendas(await searchParams);
  const { loja, relatorio } = await carregarVendasLojaAdmin(lojaId, filtros, new Date());

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref={`/admin/assinantes/${loja.id}`} voltarRotulo="Dashboard" titulo="Vendas" />
      <RelatorioVendas
        baseVendas={`/admin/assinantes/${loja.id}/vendas`}
        filtros={filtros}
        ranking={null}
        avisoFiltros={avisoFiltros}
        diaInicioCiclo={loja.dia_inicio_ciclo}
        relatorio={relatorio}
        salvarCiclo={salvarCicloVendasAdmin.bind(null, loja.id)}
      />
    </div>
  );
}
