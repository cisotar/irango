import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/metricasPedidos.ts portando 1:1 a lógica hoje inline em
// src/app/(painel)/painel/page.tsx (linhas 80–121):
//   - chaveDia(data): chave AAAA-MM-DD no fuso America/Sao_Paulo
//     via Intl.DateTimeFormat("en-CA", …). NÃO trocar por pt-BR.
//   - calcularMetricasDoDia(pedidos): { pedidosHoje, pendentes, totalDoDia }
//       pendentes  → conta status "pendente" em TODA a lista (não só do dia)
//       pedidosHoje → conta os do dia corrente (fuso SP)
//       totalDoDia  → soma total dos do dia, EXCETO status "cancelado"
import {
  calcularMetricasDoDia,
  chaveDia,
  type Metricas,
} from "./metricasPedidos";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

// ---------------------------------------------------------------------------
// Builder mínimo. A métrica só lê status/total/criado_em de PedidoComItens;
// os demais campos da row não afetam o cálculo, então o cast basta para o teste.
// "hoje" fixo no relógio (beforeEach) = 2026-07-03 12:00 em SP; o default de
// criado_em cai nesse mesmo dia SP.
// ---------------------------------------------------------------------------
function pedido(
  over: Partial<Pick<PedidoComItens, "status" | "total" | "criado_em">> = {},
): PedidoComItens {
  return {
    status: "pendente",
    total: 10,
    criado_em: "2026-07-03T15:00:00Z", // SP: 2026-07-03 12:00
    ...over,
  } as unknown as PedidoComItens;
}

describe("chaveDia — chave AAAA-MM-DD no fuso America/Sao_Paulo", () => {
  it("formata no padrão ISO AAAA-MM-DD (locale en-CA), não DD/MM/AAAA", () => {
    // 2026-07-03 12:00Z → SP (UTC-3) 09:00 do mesmo dia.
    expect(chaveDia(new Date("2026-07-03T12:00:00Z"))).toBe("2026-07-03");
  });

  it("aplica o fuso SP na borda da meia-noite (02:00Z vira dia anterior em SP)", () => {
    // 2026-07-03 02:00Z → SP 2026-07-02 23:00 → dia 02, não 03 (nem UTC).
    expect(chaveDia(new Date("2026-07-03T02:00:00Z"))).toBe("2026-07-02");
  });

  it("limite exato da virada: 03:00:00.000Z é 00:00:00 em SP → já é o novo dia", () => {
    // SP é UTC-3 fixo (sem horário de verão desde 2019). 03:00Z é a meia-noite
    // exata em SP: um erro de offset (ex.: usar -4 por engano) faria isso cair
    // ainda no dia anterior.
    expect(chaveDia(new Date("2026-07-03T03:00:00.000Z"))).toBe("2026-07-03");
  });

  it("1ms antes da virada: 02:59:59.999Z ainda é o dia anterior em SP", () => {
    expect(chaveDia(new Date("2026-07-03T02:59:59.999Z"))).toBe("2026-07-02");
  });
});

describe("calcularMetricasDoDia", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // "hoje" = 2026-07-03 em SP (12:00 SP / 15:00Z).
    vi.setSystemTime(new Date("2026-07-03T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lista vazia → tudo zero", () => {
    const r: Metricas = calcularMetricasDoDia([]);
    expect(r).toEqual({ pedidosHoje: 0, pendentes: 0, totalDoDia: 0 });
  });

  it("pedido pendente de outro dia conta em pendentes, mas não em pedidosHoje nem totalDoDia", () => {
    const r = calcularMetricasDoDia([
      pedido({ status: "pendente", total: 50, criado_em: "2026-07-01T15:00:00Z" }),
    ]);
    expect(r.pendentes).toBe(1);
    expect(r.pedidosHoje).toBe(0);
    expect(r.totalDoDia).toBe(0);
  });

  it("pedido cancelado de hoje conta em pedidosHoje, mas não soma em totalDoDia", () => {
    const r = calcularMetricasDoDia([
      pedido({ status: "cancelado", total: 99, criado_em: "2026-07-03T15:00:00Z" }),
    ]);
    expect(r.pedidosHoje).toBe(1);
    expect(r.totalDoDia).toBe(0);
    expect(r.pendentes).toBe(0);
  });

  it("borda de meia-noite: criado_em 02:00Z de hoje-UTC cai em ontem-SP e NÃO conta como hoje", () => {
    // Relógio: 2026-07-03 SP. Pedido em 2026-07-03T02:00Z → SP 2026-07-02 → não é hoje.
    const r = calcularMetricasDoDia([
      pedido({ status: "confirmado", total: 30, criado_em: "2026-07-03T02:00:00Z" }),
    ]);
    expect(r.pedidosHoje).toBe(0);
    expect(r.totalDoDia).toBe(0);
  });

  it("borda exata: pedido às 03:00:00.000Z (00:00 em ponto SP) já conta como hoje", () => {
    const r = calcularMetricasDoDia([
      pedido({ status: "confirmado", total: 15, criado_em: "2026-07-03T03:00:00.000Z" }),
    ]);
    expect(r.pedidosHoje).toBe(1);
    expect(r.totalDoDia).toBe(15);
  });

  it("borda exata: pedido 1ms antes da virada (02:59:59.999Z) ainda é ontem-SP e não conta", () => {
    const r = calcularMetricasDoDia([
      pedido({ status: "confirmado", total: 15, criado_em: "2026-07-03T02:59:59.999Z" }),
    ]);
    expect(r.pedidosHoje).toBe(0);
    expect(r.totalDoDia).toBe(0);
  });

  it("total zero (cupom de 100%) soma normalmente — não é tratado como ausente/falsy", () => {
    // Regressão a evitar: um `if (pedido.total)` trataria 0 como falsy e pularia
    // a soma silenciosamente, mas 0 é um total válido (pedido gratuito por cupom).
    const r = calcularMetricasDoDia([
      pedido({ status: "confirmado", total: 0, criado_em: "2026-07-03T15:00:00Z" }),
      pedido({ status: "confirmado", total: 20, criado_em: "2026-07-03T16:00:00Z" }),
    ]);
    expect(r.pedidosHoje).toBe(2);
    expect(r.totalDoDia).toBe(20);
  });

  it("status fora do tratamento explícito (ex.: em_preparo/entregue) soma no total e não conta em pendentes", () => {
    // status só tem tratamento especial para "pendente" e "cancelado"; qualquer
    // outro valor do enum do banco (em_preparo, saiu_entrega, entregue) — ou um
    // valor futuro ainda não previsto — deve somar normalmente, não ser
    // silenciosamente descartado por um switch/if-chain exaustivo.
    const r = calcularMetricasDoDia([
      pedido({ status: "em_preparo", total: 30, criado_em: "2026-07-03T15:00:00Z" }),
      pedido({ status: "entregue", total: 22, criado_em: "2026-07-03T16:00:00Z" }),
    ]);
    expect(r.pedidosHoje).toBe(2);
    expect(r.pendentes).toBe(0);
    expect(r.totalDoDia).toBe(52);
  });

  it("pedido de amanhã (futuro, relógio adiantado ou erro de fuso) não conta como hoje", () => {
    // Garante que a comparação de dia é igualdade exata (===), não "<=" — um
    // pedido de data futura não deveria contar como "hoje" só por não ser passado.
    const r = calcularMetricasDoDia([
      pedido({ status: "confirmado", total: 999, criado_em: "2026-07-04T15:00:00Z" }),
    ]);
    expect(r.pedidosHoje).toBe(0);
    expect(r.totalDoDia).toBe(0);
    expect(r.pendentes).toBe(0);
  });

  it("caminho feliz: soma total dos pedidos de hoje (exceto cancelado) e conta pendentes da lista inteira", () => {
    const r = calcularMetricasDoDia([
      pedido({ status: "pendente", total: 12.5, criado_em: "2026-07-03T15:00:00Z" }),
      pedido({ status: "confirmado", total: 7.9, criado_em: "2026-07-03T18:00:00Z" }),
      pedido({ status: "cancelado", total: 100, criado_em: "2026-07-03T16:00:00Z" }),
      pedido({ status: "pendente", total: 40, criado_em: "2026-07-01T15:00:00Z" }), // outro dia
    ]);
    expect(r.pedidosHoje).toBe(3); // 3 do dia (inclui o cancelado)
    expect(r.pendentes).toBe(2); // ambos os pendentes, mesmo o de outro dia
    expect(r.totalDoDia).toBeCloseTo(20.4, 5); // 12.5 + 7.9 (cancelado fora)
  });
});
