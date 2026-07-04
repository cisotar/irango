import type { ReactElement } from "react";

import { DetalhePedido } from "@/components/painel/DetalhePedido";
import { atualizarStatusPedidoAdmin } from "@/app/admin/assinantes/actions/admin-status";
import { carregarPedidoDetalheAdmin } from "../../carga-pedido-detalhe";

/**
 * Detalhe do pedido no hub admin (issue 140, specs/paridade-hub-admin-painel.md
 * rota 4). Server Component. `dynamic = "force-dynamic"`: o dado é PII sensível e
 * muda por ação — nunca cacheado por rota, espelhando as demais abas do hub.
 *
 * Carrega via `carregarPedidoDetalheAdmin` (loader server-only fail-closed da 140:
 * valida o `lojaId`, prova admin ANTES de elevar a service_role, escopa a leitura
 * por `loja_id`+`id`; `null` → `notFound()`). Ao chegar aqui o `lojaId` já está
 * provado válido — daí `basePedidos` é montado NO SERVIDOR a partir dele.
 *
 * `acaoStatus` usa `.bind(null, lojaId)` (NÃO arrow inline): `atualizarStatusPedidoAdmin`
 * é `'use server'`, e só Server Actions e seus `.bind` cruzam a fronteira
 * server→client para o `AcoesStatus` (`'use client'`). O `.bind` fixa `lojaId` no
 * servidor (nunca vem do payload do cliente) e produz uma Server Action ligada com
 * assinatura `(id, novoStatus) => Promise<ResultadoAtualizarStatus>`, que casa o
 * tipo `AcaoStatus`. A autoridade da transição vive inteiramente na action (133).
 */
export const dynamic = "force-dynamic";

export default async function DetalhePedidoAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string; id: string }>;
}): Promise<ReactElement> {
  const { lojaId, id } = await params;
  const pedido = await carregarPedidoDetalheAdmin(lojaId, id);

  return (
    <DetalhePedido
      pedido={pedido}
      basePedidos={`/admin/assinantes/${lojaId}/pedidos`}
      acaoStatus={atualizarStatusPedidoAdmin.bind(null, lojaId)}
    />
  );
}
