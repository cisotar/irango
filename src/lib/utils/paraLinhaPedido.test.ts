import { describe, it, expect } from "vitest";
import { paraLinhaPedido } from "./paraLinhaPedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

function pedido(overrides: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    loja_id: "22222222-2222-2222-2222-222222222222",
    nome_cliente: "Cliente Teste",
    total: 42.5,
    status: "pendente",
    criado_em: "2026-07-03T12:00:00.000Z",
    itens_pedido: [],
    ...overrides,
  } as unknown as PedidoComItens;
}

describe("paraLinhaPedido", () => {
  it("projeta os 5 campos exatos que TabelaPedidos/PedidoLinha consomem", () => {
    const linha = paraLinhaPedido(pedido());
    expect(linha).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      nome_cliente: "Cliente Teste",
      total: 42.5,
      status: "pendente",
      criado_em: "2026-07-03T12:00:00.000Z",
    });
  });

  it("não vaza campos extras de PedidoComItens (ex.: itens_pedido, loja_id)", () => {
    const linha = paraLinhaPedido(pedido());
    expect(linha).not.toHaveProperty("itens_pedido");
    expect(linha).not.toHaveProperty("loja_id");
  });
});
