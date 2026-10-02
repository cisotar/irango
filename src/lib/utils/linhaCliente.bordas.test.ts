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
  aceita_marketing: false,
  total_pedidos: 1,
  total_cancelados: 0,
  ultimo_pedido_em: "2026-10-01T12:00:00Z",
  ultimo_pedido_status: "entregue",
};
const SP = "America/Sao_Paulo";
const nulo = null as unknown as number;

describe("paraLinhaCliente bordas (346)", () => {
  it("virada do dia em SP (UTC-3): 02:59:59Z ainda é dia anterior, 03:00:00Z é o novo dia", () => {
    expect(paraLinhaCliente({ ...base, ultimo_pedido_em: "2026-10-01T02:59:59Z" }, SP).ultimoPedido).toBe("30/09/2026");
    expect(paraLinhaCliente({ ...base, ultimo_pedido_em: "2026-10-01T03:00:00Z" }, SP).ultimoPedido).toBe("01/10/2026");
  });
  it("virada de ano e fuso diferente (Manaus UTC-4)", () => {
    expect(paraLinhaCliente({ ...base, ultimo_pedido_em: "2026-01-01T02:00:00Z" }, SP).ultimoPedido).toBe("31/12/2025");
    expect(paraLinhaCliente({ ...base, ultimo_pedido_em: "2026-10-01T03:30:00Z" }, "America/Manaus").ultimoPedido).toBe("30/09/2026");
  });
  it("sufixo (cancelado) só quando o ÚLTIMO status é cancelado e há data", () => {
    expect(
      paraLinhaCliente({ ...base, total_cancelados: 3, ultimo_pedido_status: "entregue" }, SP).ultimoPedido,
    ).toBe("01/10/2026");
    expect(
      paraLinhaCliente({ ...base, ultimo_pedido_em: nulo as unknown as string, ultimo_pedido_status: "cancelado" }, SP).ultimoPedido,
    ).toBe("—");
  });
  it("data inválida não lança nem vira 'NaN'", () => {
    expect(paraLinhaCliente({ ...base, ultimo_pedido_em: "lixo" }, SP).ultimoPedido).toBe("—");
  });
  it("contagens nulas viram 0 e cancelados só aparecem se > 0", () => {
    const l = paraLinhaCliente({ ...base, total_pedidos: nulo, total_cancelados: nulo }, SP);
    expect(l.pedidos).toBe("0 pedidos");
    expect(paraLinhaCliente({ ...base, total_pedidos: 2, total_cancelados: 1 }, SP).pedidos).toBe("2 pedidos · 1 cancelado");
  });
  it("aniversário: pad de 1 dígito; parcial (só dia ou só mês) → '—'", () => {
    expect(paraLinhaCliente({ ...base, dia_aniversario: 1, mes_aniversario: 2 }, SP).aniversario).toBe("01/02");
    expect(paraLinhaCliente({ ...base, dia_aniversario: 5, mes_aniversario: nulo }, SP).aniversario).toBe("—");
    expect(paraLinhaCliente({ ...base, dia_aniversario: nulo, mes_aniversario: 5 }, SP).aniversario).toBe("—");
  });
  it("não vaza campos fora da allowlist (sem e-mail/ano)", () => {
    const l = paraLinhaCliente({ ...base, email: "x@y.z", ano_nascimento: 1990 } as ClienteDaLoja, SP);
    expect(JSON.stringify(l)).not.toMatch(/x@y\.z|1990/);
  });
});
