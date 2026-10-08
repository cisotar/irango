import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 357 — `src/lib/vendas/carregarRankingClientes.ts` (server-only,
 * só do painel do lojista; o admin nunca importa).
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.6 e §8.6; RN-V18..V20.
 *
 * Contrato:
 *   carregarRankingClientes(client, loja {timezone, dia_inicio_ciclo}, ranking {periodo, ordem}, agora)
 *     → { ok: true, rotuloPeriodo, clientes: ClienteRanking[], convidados } | { ok: false }
 *   janelaDoRanking → Promise.all(buscarRankingClientes({…, limite: 20}), contarPedidosConvidados)
 *   → mapeia SEM reordenar; itens_top via schemaItensTop.safeParse (falha → []).
 *
 * Mock só do I/O (`@/lib/supabase/queries/vendas`). RED: módulo ausente. Dados fictícios.
 */

const buscarRankingClientes = vi.fn();
const contarPedidosConvidados = vi.fn();
vi.mock("@/lib/supabase/queries/vendas", () => ({
  buscarVendasPorDia: vi.fn(),
  buscarItensPorCategoria: vi.fn(),
  buscarRankingClientes: (...a: unknown[]) => buscarRankingClientes(...a),
  contarPedidosConvidados: (...a: unknown[]) => contarPedidosConvidados(...a),
}));

type ClienteRanking = {
  clienteId: string;
  nome: string;
  totalPedidos: number;
  totalGasto: number;
  ultimoPedidoEm: string;
  itensTop: { nome: string; quantidade: number }[];
};
type Resultado = { ok: true; rotuloPeriodo: string; clientes: ClienteRanking[]; convidados: number } | { ok: false };
type Mod = {
  carregarRankingClientes: (
    client: unknown,
    loja: { timezone: string; dia_inicio_ciclo: number },
    ranking: { periodo: "semana" | "mes" | "ano" | "tudo"; ordem: "pedidos" | "total" | "ultimo" },
    agora: Date,
  ) => Promise<Resultado>;
};

async function carregar(): Promise<Mod> {
  return (await import("./carregarRankingClientes")) as unknown as Mod;
}

const A = new Date("2026-10-07T15:00:00Z");
const CLIENT = { marker: "client-fake" };
const LOJA = { timezone: "America/Sao_Paulo", dia_inicio_ciclo: 5 };
const TUDO_TOTAL = { periodo: "tudo" as const, ordem: "total" as const };

const CLI_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLI_B = "bbbbbbbb-0000-4000-8000-000000000002";
const LINHA_B = {
  cliente_id: CLI_B,
  nome: "Cliente B",
  total_pedidos: 2,
  total_gasto: 300,
  ultimo_pedido_em: "2026-10-07T12:00:00+00:00",
  itens_top: [{ nome: "Pizza", quantidade: 2 }],
};
const LINHA_A = {
  cliente_id: CLI_A,
  nome: "Cliente A",
  total_pedidos: 5,
  total_gasto: 100,
  ultimo_pedido_em: "2026-10-05T12:00:00+00:00",
  itens_top: [
    { nome: "Coca", quantidade: 5 },
    { nome: "X-Burger", quantidade: 3 },
  ],
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  buscarRankingClientes.mockResolvedValue([LINHA_B, LINHA_A]);
  contarPedidosConvidados.mockResolvedValue(3);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("carregarRankingClientes", () => {
  it("'tudo' + 'total' em A → janela sem início até o fim de hoje local; limite 20", async () => {
    const { carregarRankingClientes } = await carregar();
    await carregarRankingClientes(CLIENT, LOJA, TUDO_TOTAL, A);
    expect(buscarRankingClientes).toHaveBeenCalledWith(CLIENT, {
      inicio: null,
      fim: "2026-10-08T03:00:00.000Z",
      ordem: "total",
      limite: 20,
    });
    expect(contarPedidosConvidados).toHaveBeenCalledWith(CLIENT, {
      inicio: null,
      fim: "2026-10-08T03:00:00.000Z",
    });
  });

  it("mapeia as linhas SEM reordenar ([B, A] → [B, A]) e repassa convidados", async () => {
    const { carregarRankingClientes } = await carregar();
    const r = await carregarRankingClientes(CLIENT, LOJA, TUDO_TOTAL, A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clientes.map((c) => c.clienteId)).toEqual([CLI_B, CLI_A]);
    expect(r.clientes[1]).toEqual({
      clienteId: CLI_A,
      nome: "Cliente A",
      totalPedidos: 5,
      totalGasto: 100,
      ultimoPedidoEm: "2026-10-05T12:00:00+00:00",
      itensTop: [
        { nome: "Coca", quantidade: 5 },
        { nome: "X-Burger", quantidade: 3 },
      ],
    });
    expect(r.convidados).toBe(3);
  });

  it("itens_top inválido ({ x: 1 }) → itensTop []", async () => {
    const { carregarRankingClientes } = await carregar();
    buscarRankingClientes.mockResolvedValueOnce([{ ...LINHA_A, itens_top: { x: 1 } }]);
    const r = await carregarRankingClientes(CLIENT, LOJA, TUDO_TOTAL, A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clientes[0].itensTop).toEqual([]);
  });

  it("erro numa busca → { ok:false }", async () => {
    const { carregarRankingClientes } = await carregar();
    contarPedidosConvidados.mockRejectedValueOnce({ code: "42501", message: "permission denied for function" });
    const r = await carregarRankingClientes(CLIENT, LOJA, TUDO_TOTAL, A);
    expect(r).toEqual({ ok: false });
  });
});
