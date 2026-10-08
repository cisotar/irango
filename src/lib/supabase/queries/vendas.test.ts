import { describe, it, expect, vi } from "vitest";

/**
 * Fase RED (TDD) da issue 357 (GREEN na fatia A) — `src/lib/supabase/queries/vendas.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.2 e §8.6.
 *
 * Contrato:
 *   buscarVendasPorDia(client, faixa)        → rpc("vendas_por_dia", args)
 *   buscarItensPorCategoria(client, faixa)   → rpc("vendas_itens_por_categoria", args)
 *     args = { p_loja_id, p_inicio, p_fim, p_so_concluidos } + p_tipo_entrega SÓ quando
 *     tipoEntrega !== "ambos" (ambos → chave omitida → NULL no SQL).
 *   buscarRankingClientes(client, { inicio, fim, ordem, limite }) → rpc("ranking_clientes_da_loja",
 *     { p_fim, p_ordem, p_limite } + p_inicio só quando não é null)
 *   contarPedidosConvidados(client, { inicio, fim }) → rpc("pedidos_convidados_da_loja", …)
 *   `if (error) throw error`; `data ?? []` (convidados: `data ?? 0`). Sem `.eq`: a RPC escopa.
 *
 * RED: o módulo ainda não existe; import dinâmico por caso (sem stub de produção).
 * Mock só do I/O (client Supabase). Dados fictícios.
 */

type Faixa = {
  lojaId: string;
  inicio: string;
  fim: string;
  tipoEntrega: "entrega" | "retirada" | "ambos";
  soConcluidos: boolean;
};
type Mod = {
  buscarVendasPorDia: (c: unknown, f: Faixa) => Promise<unknown[]>;
  buscarItensPorCategoria: (c: unknown, f: Faixa) => Promise<unknown[]>;
  buscarRankingClientes: (
    c: unknown,
    f: { inicio: string | null; fim: string; ordem: string; limite: number },
  ) => Promise<unknown[]>;
  contarPedidosConvidados: (c: unknown, f: { inicio: string | null; fim: string }) => Promise<number>;
};

async function carregar(): Promise<Mod> {
  return (await import("./vendas")) as unknown as Mod;
}

const L = "11111111-1111-4111-8111-111111111111";
const I = "2026-10-05T03:00:00.000Z";
const F = "2026-10-12T03:00:00.000Z";

function fakeRpc(resposta: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_nome: string, _args: Record<string, unknown>) => resposta);
  return { rpc, client: { rpc } };
}

const faixa = (over: Partial<Faixa> = {}): Faixa => ({
  lojaId: L,
  inicio: I,
  fim: F,
  tipoEntrega: "ambos",
  soConcluidos: false,
  ...over,
});

describe("buscarVendasPorDia", () => {
  it("'ambos' → rpc vendas_por_dia SEM a chave p_tipo_entrega; devolve as linhas", async () => {
    const { buscarVendasPorDia } = await carregar();
    const linhas = [{ dia: "2026-10-06", bruto: 10 }];
    const { rpc, client } = fakeRpc({ data: linhas, error: null });
    expect(await buscarVendasPorDia(client, faixa())).toBe(linhas);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe("vendas_por_dia");
    expect(args).toEqual({ p_loja_id: L, p_inicio: I, p_fim: F, p_so_concluidos: false });
    expect("p_tipo_entrega" in args).toBe(false);
  });

  it("'entrega' + só concluídos → p_tipo_entrega 'entrega', p_so_concluidos true", async () => {
    const { buscarVendasPorDia } = await carregar();
    const { rpc, client } = fakeRpc({ data: [], error: null });
    await buscarVendasPorDia(client, faixa({ tipoEntrega: "entrega", soConcluidos: true }));
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_loja_id: L,
      p_inicio: I,
      p_fim: F,
      p_so_concluidos: true,
      p_tipo_entrega: "entrega",
    });
  });

  it("data null → []", async () => {
    const { buscarVendasPorDia } = await carregar();
    const { client } = fakeRpc({ data: null, error: null });
    expect(await buscarVendasPorDia(client, faixa())).toEqual([]);
  });

  it("error → rejeita com o MESMO objeto de erro", async () => {
    const { buscarVendasPorDia } = await carregar();
    const erro = { code: "42501", message: "vendas: sem posse da loja" };
    const { client } = fakeRpc({ data: null, error: erro });
    await expect(buscarVendasPorDia(client, faixa())).rejects.toBe(erro);
  });
});

describe("buscarItensPorCategoria", () => {
  it("'ambos' → rpc vendas_itens_por_categoria sem p_tipo_entrega", async () => {
    const { buscarItensPorCategoria } = await carregar();
    const { rpc, client } = fakeRpc({ data: [], error: null });
    await buscarItensPorCategoria(client, faixa());
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe("vendas_itens_por_categoria");
    expect(args).toEqual({ p_loja_id: L, p_inicio: I, p_fim: F, p_so_concluidos: false });
    expect("p_tipo_entrega" in args).toBe(false);
  });

  it("'retirada' → p_tipo_entrega 'retirada'", async () => {
    const { buscarItensPorCategoria } = await carregar();
    const { rpc, client } = fakeRpc({ data: [], error: null });
    await buscarItensPorCategoria(client, faixa({ tipoEntrega: "retirada" }));
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_tipo_entrega: "retirada" });
  });

  it("error → rejeita com o mesmo objeto", async () => {
    const { buscarItensPorCategoria } = await carregar();
    const erro = { code: "22023", message: "vendas: faixa invertida" };
    const { client } = fakeRpc({ data: null, error: erro });
    await expect(buscarItensPorCategoria(client, faixa())).rejects.toBe(erro);
  });
});

describe("buscarRankingClientes", () => {
  it("inicio null → { p_fim, p_ordem, p_limite } sem p_inicio", async () => {
    const { buscarRankingClientes } = await carregar();
    const { rpc, client } = fakeRpc({ data: [], error: null });
    await buscarRankingClientes(client, { inicio: null, fim: F, ordem: "total", limite: 20 });
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe("ranking_clientes_da_loja");
    expect(args).toEqual({ p_fim: F, p_ordem: "total", p_limite: 20 });
    expect("p_inicio" in args).toBe(false);
  });

  it("com inicio → inclui p_inicio", async () => {
    const { buscarRankingClientes } = await carregar();
    const { rpc, client } = fakeRpc({ data: [], error: null });
    await buscarRankingClientes(client, { inicio: I, fim: F, ordem: "pedidos", limite: 20 });
    expect(rpc.mock.calls[0]![1]).toEqual({ p_inicio: I, p_fim: F, p_ordem: "pedidos", p_limite: 20 });
  });

  it("error → rejeita com o mesmo objeto", async () => {
    const { buscarRankingClientes } = await carregar();
    const erro = { code: "22023", message: "ranking_clientes_da_loja: p_ordem inválido" };
    const { client } = fakeRpc({ data: null, error: erro });
    await expect(
      buscarRankingClientes(client, { inicio: null, fim: F, ordem: "total", limite: 20 }),
    ).rejects.toBe(erro);
  });
});

describe("contarPedidosConvidados", () => {
  it("rpc pedidos_convidados_da_loja; data 3 → 3", async () => {
    const { contarPedidosConvidados } = await carregar();
    const { rpc, client } = fakeRpc({ data: 3, error: null });
    expect(await contarPedidosConvidados(client, { inicio: null, fim: F })).toBe(3);
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe("pedidos_convidados_da_loja");
    expect(args).toEqual({ p_fim: F });
  });

  it("com inicio → inclui p_inicio; data null → 0", async () => {
    const { contarPedidosConvidados } = await carregar();
    const { rpc, client } = fakeRpc({ data: null, error: null });
    expect(await contarPedidosConvidados(client, { inicio: I, fim: F })).toBe(0);
    expect(rpc.mock.calls[0]![1]).toEqual({ p_inicio: I, p_fim: F });
  });

  it("error → rejeita com o mesmo objeto", async () => {
    const { contarPedidosConvidados } = await carregar();
    const erro = { code: "42501", message: "permission denied for function" };
    const { client } = fakeRpc({ data: null, error: erro });
    await expect(contarPedidosConvidados(client, { inicio: null, fim: F })).rejects.toBe(erro);
  });
});
