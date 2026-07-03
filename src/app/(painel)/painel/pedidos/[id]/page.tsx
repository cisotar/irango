import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarPedidoDoDono } from "@/lib/supabase/queries/pedidos";
import { DetalhePedido } from "@/components/painel/DetalhePedido";

/**
 * Detalhe do pedido (issue 049) — casca fina (issue 125).
 *
 * Lê o pedido via client AUTENTICADO — a RLS `pedidos_acesso_lojista` garante
 * que o lojista só vê pedido da própria loja (RN-02). Pedido de outra loja ou
 * inexistente → `null` → `notFound()`. Toda a apresentação vive no componente
 * compartilhado `DetalhePedido`, consumido também pela page admin (140).
 */
export default async function DetalhePedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createClient();

  const pedido = await buscarPedidoDoDono(supabase, id);
  if (pedido == null) {
    notFound();
  }

  return <DetalhePedido pedido={pedido} />;
}
