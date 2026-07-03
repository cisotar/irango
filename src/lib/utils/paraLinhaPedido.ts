import type { PedidoLinha } from "@/components/painel/TabelaPedidos";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Projeta `PedidoComItens` (row completa + itens) para `PedidoLinha` (shape
 * enxuto de `TabelaPedidos`). Fonte única — reusada pelo painel (`/painel`,
 * `/painel/pedidos`) e pelo hub admin (`/admin/assinantes/[lojaId]/pedidos`),
 * evitando três cópias divergirem se `PedidoLinha` ganhar um campo novo.
 */
export function paraLinhaPedido(pedido: PedidoComItens): PedidoLinha {
  return {
    id: pedido.id,
    nome_cliente: pedido.nome_cliente,
    total: pedido.total,
    status: pedido.status as StatusPedido,
    criado_em: pedido.criado_em,
  };
}
