// Issue 342 — regra ÚNICA de cupom com limite por cliente (decisões 9 e 9-A;
// specs/cliente-vinculo-pedido.md RN-C06/C08/C09/C10). Pura: quem lê a sessão
// e conta os usos é o chamador (`criarPedido` e `revisarCarrinhoAction`).
// A RPC `criar_pedido` reaplica a mesma regra sob advisory lock (última linha).

export const MSG_CUPOM_ENTRAR_NA_CONTA = "Entre na sua conta para usar este cupom";
export const MSG_CUPOM_LIMITE_ATINGIDO = "Você já usou este cupom o máximo de vezes permitido.";

export type VereditoCupomPorCliente =
  | { permitido: true }
  | { permitido: false; motivo: "entrar_na_conta" | "limite_atingido"; mensagem: string };

export function avaliarCupomPorCliente(e: {
  limitePorCliente: number | null | undefined;
  clienteId: string | null;
  usosDoCliente: number;
}): VereditoCupomPorCliente {
  if (e.limitePorCliente == null) return { permitido: true };
  if (e.clienteId == null) {
    return { permitido: false, motivo: "entrar_na_conta", mensagem: MSG_CUPOM_ENTRAR_NA_CONTA };
  }
  if (e.usosDoCliente >= e.limitePorCliente) {
    return { permitido: false, motivo: "limite_atingido", mensagem: MSG_CUPOM_LIMITE_ATINGIDO };
  }
  return { permitido: true };
}
