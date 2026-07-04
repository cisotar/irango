import type { ReactElement } from "react";

import { paraLinhaPedido } from "@/lib/utils/paraLinhaPedido";
import { PedidosClient } from "@/app/(painel)/painel/pedidos/PedidosClient";
import { carregarDashboardLojaAdmin } from "../carga-pedidos";

/**
 * Aba Pedidos do hub admin (issue 139, specs/paridade-hub-admin-painel.md rota 3).
 * Server Component. `dynamic = "force-dynamic"`: a lista muda por ação e o dado é
 * sensível (nunca cacheado por rota), espelhando as demais abas do hub.
 *
 * Carrega via `carregarDashboardLojaAdmin` (loader server-only fail-closed da issue
 * 138: valida o `lojaId`, prova admin ANTES de elevar a service_role e escopa a
 * leitura por `loja_id`). Como o loader devolve `notFound()` para `lojaId` inválido
 * ANTES de retornar, ao chegar aqui o `lojaId` já está provado válido — daí
 * `basePedidos` é montado NO SERVIDOR a partir dele (o filtro por status do
 * `PedidosClient` é só UX; a lista já chega escopada). Nenhum valor autoritativo é
 * decidido aqui: só fiação e mapeamento de exibição.
 */
export const dynamic = "force-dynamic";

export default async function PedidosAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const pedidos = await carregarDashboardLojaAdmin(lojaId);
  const basePedidos = `/admin/assinantes/${lojaId}/pedidos`;

  return (
    <PedidosClient
      pedidos={pedidos.map(paraLinhaPedido)}
      basePedidos={basePedidos}
    />
  );
}
