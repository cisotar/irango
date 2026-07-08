/**
 * Número curto do pedido exibido a cliente/lojista — primeiros 8 chars do id,
 * maiúsculo. Fonte única do formato (antes duplicado em whatsappPedido,
 * confirmação, TabelaPedidos, DetalhePedido, ComandaCozinha, ReciboCliente).
 * SEM prefixo "#": o `#` é apresentação; o caller prepende quando quiser.
 */
export function formatarNumeroPedido(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
