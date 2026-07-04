import type { ReactElement } from "react";

import { DashboardLoja } from "@/components/painel/DashboardLoja";
import { carregarDashboardLojaAdmin } from "./carga-pedidos";

/**
 * Dashboard da loja-alvo no hub admin (issue 138,
 * specs/paridade-hub-admin-painel.md rota 2) — equivalente ao `/painel` do
 * lojista, consumindo o `<DashboardLoja>` compartilhado (122): nenhum markup
 * copiado do painel.
 *
 * O cabeçalho + abas + guard de admin já vivem no `layout.tsx` (via
 * `carregarCabecalhoLojaAdmin`). Aqui carregamos os pedidos escopados por loja
 * sob service_role via `carregarDashboardLojaAdmin` (fail-closed: valida o
 * `lojaId`, prova admin e só então eleva a service_role). `basePedidos` aponta
 * para a sub-rota admin de pedidos desta loja — navegação, não barreira; o
 * isolamento por loja está no loader.
 */
export default async function DashboardLojaAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;

  const pedidos = await carregarDashboardLojaAdmin(lojaId);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Dashboard
      </h1>

      <DashboardLoja
        pedidos={pedidos}
        basePedidos={`/admin/assinantes/${lojaId}/pedidos`}
      />
    </div>
  );
}
