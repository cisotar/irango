import { describe, it, expect } from "vitest";
import type { ClienteDaLoja } from "@/lib/supabase/queries/clientes";
import { paraLinhaCliente } from "./linhaCliente";

// Dados fictícios.
const base: ClienteDaLoja = {
  cliente_id: "11111111-1111-1111-1111-111111111111",
  nome: "Pessoa Teste",
  telefone: "11900000000",
  dia_aniversario: 4,
  mes_aniversario: 3,
  aceita_marketing: true,
  total_pedidos: 3,
  total_cancelados: 0,
  ultimo_pedido_em: "2026-10-01T02:30:00Z",
  ultimo_pedido_status: "entregue",
};
const TZ = "America/Sao_Paulo";

describe("paraLinhaCliente (346 D9)", () => {
  it("formata a linha completa; data no fuso da loja (UTC 01/10 02:30 = 30/09 em SP)", () => {
    expect(paraLinhaCliente(base, TZ)).toEqual({
      id: base.cliente_id,
      nome: "Pessoa Teste",
      telefone: { texto: "(11) 90000-0000", href: "https://wa.me/5511900000000" },
      pedidos: "3 pedidos",
      ultimoPedido: "30/09/2026",
      aniversario: "04/03",
      promocoes: "Aceita",
    });
  });
  it("cancelados exibidos e não contabilizados; último cancelado marcado", () => {
    const l = paraLinhaCliente(
      { ...base, total_pedidos: 0, total_cancelados: 2, ultimo_pedido_status: "cancelado" },
      TZ,
    );
    expect(l.pedidos).toBe("0 pedidos · 2 cancelados");
    expect(l.ultimoPedido).toBe("30/09/2026 (cancelado)");
  });
  it("singular", () => {
    expect(paraLinhaCliente({ ...base, total_pedidos: 1, total_cancelados: 1 }, TZ).pedidos).toBe(
      "1 pedido · 1 cancelado",
    );
  });
  it("sem nascimento / sem data / não aceita", () => {
    const l = paraLinhaCliente(
      {
        ...base,
        dia_aniversario: null as unknown as number,
        mes_aniversario: null as unknown as number,
        ultimo_pedido_em: null as unknown as string,
        aceita_marketing: false,
      },
      TZ,
    );
    expect(l.aniversario).toBe("—");
    expect(l.ultimoPedido).toBe("—");
    expect(l.promocoes).toBe("Não aceita");
  });
});
