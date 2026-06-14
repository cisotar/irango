// Issue 037 — invariante anti-vazamento da página de confirmação.
//
// `buscarPedidoPorToken` (026) só retorna pedido quando o par (id, token_acesso)
// confere; token errado → null. Esta função pura traduz esse resultado na ação
// da página: pedido → mostrar; ausente → redirecionar para a loja SEM jamais
// embutir dado do pedido no destino (seguranca.md §pedidos). Manter pura/sem I/O
// permite testar a invariante isoladamente (confirmacao.test.ts).

// Genérico em `T` (objeto com `id`) para aceitar o `PedidoComItens` real da
// query sem acoplar a função à forma exata da linha; o teste usa um mock com
// `id`/`token`, que satisfaz a restrição.
export function resolverAcaoConfirmacao<T extends { id: string }>(
  pedido: T | null,
  lojaSlug: string,
):
  | { acao: "mostrar"; pedido: T }
  | { acao: "redirecionar"; destino: string } {
  if (!pedido) return { acao: "redirecionar", destino: `/loja/${lojaSlug}` };
  return { acao: "mostrar", pedido };
}
