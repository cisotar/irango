import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  listarPedidosDoDono,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";
import type { PedidoLinha } from "@/components/painel/TabelaPedidos";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";
import { PedidosClient } from "./PedidosClient";

/**
 * Gestão de pedidos do lojista (issue 049). Server Component.
 *
 * Lê os pedidos via client AUTENTICADO — a RLS `pedidos_acesso_lojista` isola
 * por loja (RN-02). O filtro por status é client-side (PedidosClient): a lista
 * completa já está escopada pela RLS, então filtrar no cliente não vaza dado.
 * Sem loja → onboarding.
 */
export default async function PedidosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const pedidos = await listarPedidosDoDono(supabase);

  return <PedidosClient pedidos={pedidos.map(paraLinha)} />;
}

function paraLinha(pedido: PedidoComItens): PedidoLinha {
  return {
    id: pedido.id,
    nome_cliente: pedido.nome_cliente,
    total: pedido.total,
    status: pedido.status as StatusPedido,
    criado_em: pedido.criado_em,
  };
}
