import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 357 — `src/lib/vendas/carregarRelatorioVendas.ts` (server-only).
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.6 e §8.6.
 *
 * Contrato:
 *   carregarRelatorioVendas(client, loja {id, timezone, dia_inicio_ciclo}, filtros, agora)
 *     → { ok: true, contexto, dados: { totais, barras: {diario, semanal, mensal}, categorias } } | { ok: false }
 *   contexto → Promise.all(buscarVendasPorDia, buscarItensPorCategoria) com a MESMA FaixaVendas;
 *   catch: console.error("[vendas] carregar relatório", codigo) e { ok: false } (sem vazar mensagem).
 *   Nunca chama ranking/convidados (o admin usa este loader e não pode ver clientes).
 *
 * Mock só da camada de I/O (`@/lib/supabase/queries/vendas`). RED: módulo ausente;
 * import dinâmico por caso. Dados fictícios.
 */

const buscarVendasPorDia = vi.fn();
const buscarItensPorCategoria = vi.fn();
const buscarRankingClientes = vi.fn();
const contarPedidosConvidados = vi.fn();
vi.mock("@/lib/supabase/queries/vendas", () => ({
  buscarVendasPorDia: (...a: unknown[]) => buscarVendasPorDia(...a),
  buscarItensPorCategoria: (...a: unknown[]) => buscarItensPorCategoria(...a),
  buscarRankingClientes: (...a: unknown[]) => buscarRankingClientes(...a),
  contarPedidosConvidados: (...a: unknown[]) => contarPedidosConvidados(...a),
}));

type Filtros = {
  periodo: "hoje" | "semana" | "mes" | "mes_anterior" | "ano" | "personalizado";
  de: string | null;
  ate: string | null;
  entrega: "entrega" | "retirada" | "ambos";
  concluidos: boolean;
};
type Resultado =
  | {
      ok: true;
      contexto: { cicloAtual: { rotulo: string } };
      dados: {
        totais: Record<string, number>;
        barras: { diario: unknown[]; semanal: unknown[]; mensal: unknown[] };
        categorias: { nome: string }[];
      };
    }
  | { ok: false };
type Mod = {
  carregarRelatorioVendas: (
    client: unknown,
    loja: { id: string; timezone: string; dia_inicio_ciclo: number },
    filtros: Filtros,
    agora: Date,
  ) => Promise<Resultado>;
};

async function carregar(): Promise<Mod> {
  return (await import("./carregarRelatorioVendas")) as unknown as Mod;
}

const L = "11111111-1111-4111-8111-111111111111";
const SP = "America/Sao_Paulo";
const A = new Date("2026-10-07T15:00:00Z");
const CLIENT = { marker: "client-fake" };
const LOJA = { id: L, timezone: SP, dia_inicio_ciclo: 5 };
const FILTROS_PADRAO: Filtros = { periodo: "mes", de: null, ate: null, entrega: "ambos", concluidos: false };
const SEMANA: Filtros = { ...FILTROS_PADRAO, periodo: "semana" };

const LINHAS_DIA = [
  { dia: "2026-10-06", qtd_pedidos: 2, bruto: 80, descontos: 5, liquido: 75, frete: 8, qtd_frete_a_combinar: 1 },
  { dia: "2026-10-08", qtd_pedidos: 1, bruto: 20.1, descontos: 0, liquido: 20.1, frete: 0, qtd_frete_a_combinar: 0 },
];
const LINHAS_ITENS = [
  { categoria_id: "c1", categoria_nome: "Lanches", item_nome: "X-Burger", quantidade: 2, valor_bruto: 43, categoria_quantidade: 2, categoria_valor_bruto: 43 },
  { categoria_id: null, categoria_nome: null, item_nome: "Avulso", quantidade: 1, valor_bruto: 57.1, categoria_quantidade: 1, categoria_valor_bruto: 57.1 },
];

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  buscarVendasPorDia.mockResolvedValue(LINHAS_DIA);
  buscarItensPorCategoria.mockResolvedValue(LINHAS_ITENS);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("carregarRelatorioVendas — faixa enviada às buscas", () => {
  it("semana em A, ciclo 5 → as duas buscas recebem a MESMA faixa da semana local", async () => {
    const { carregarRelatorioVendas } = await carregar();
    await carregarRelatorioVendas(CLIENT, LOJA, SEMANA, A);
    const faixa = {
      lojaId: L,
      inicio: "2026-10-05T03:00:00.000Z",
      fim: "2026-10-12T03:00:00.000Z",
      tipoEntrega: "ambos",
      soConcluidos: false,
    };
    expect(buscarVendasPorDia).toHaveBeenCalledTimes(1);
    expect(buscarVendasPorDia).toHaveBeenCalledWith(CLIENT, faixa);
    expect(buscarItensPorCategoria).toHaveBeenCalledTimes(1);
    expect(buscarItensPorCategoria).toHaveBeenCalledWith(CLIENT, faixa);
  });

  it("entrega 'entrega' e só concluídos são repassados", async () => {
    const { carregarRelatorioVendas } = await carregar();
    await carregarRelatorioVendas(CLIENT, LOJA, { ...SEMANA, entrega: "entrega", concluidos: true }, A);
    expect(buscarVendasPorDia.mock.calls[0]![1]).toMatchObject({ tipoEntrega: "entrega", soConcluidos: true });
    expect(buscarItensPorCategoria.mock.calls[0]![1]).toMatchObject({ tipoEntrega: "entrega", soConcluidos: true });
  });
});

describe("carregarRelatorioVendas — montagem", () => {
  it("7 barras diárias na semana; totais = Σ das linhas; ciclo atual '05/out a 04/nov'", async () => {
    const { carregarRelatorioVendas } = await carregar();
    const r = await carregarRelatorioVendas(CLIENT, LOJA, SEMANA, A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.barras.diario).toHaveLength(7);
    expect(r.dados.totais).toEqual({
      pedidos: 3,
      bruto: 100.1,
      descontos: 5,
      liquido: 95.1,
      frete: 8,
      freteACombinar: 1,
    });
    expect(r.contexto.cicloAtual.rotulo).toBe("05/out a 04/nov");
    expect(r.dados.categorias.map((c) => c.nome)).toEqual(["Lanches", "Sem categoria"]);
  });

  it("nunca chama ranking nem convidados", async () => {
    const { carregarRelatorioVendas } = await carregar();
    await carregarRelatorioVendas(CLIENT, LOJA, SEMANA, A);
    expect(buscarRankingClientes).not.toHaveBeenCalled();
    expect(contarPedidosConvidados).not.toHaveBeenCalled();
  });
});

describe("carregarRelatorioVendas — falhas", () => {
  it("busca rejeita 42501 → { ok:false } sem vazar a mensagem; log só com o código", async () => {
    const { carregarRelatorioVendas } = await carregar();
    buscarVendasPorDia.mockRejectedValueOnce({ code: "42501", message: "vendas: sem posse da loja" });
    const r = await carregarRelatorioVendas(CLIENT, LOJA, SEMANA, A);
    expect(r).toEqual({ ok: false });
    expect(JSON.stringify(r)).not.toContain("sem posse");
    expect(consoleError).toHaveBeenCalledWith("[vendas] carregar relatório", "42501");
  });

  it("timezone inválido → { ok:false }, sem lançar", async () => {
    const { carregarRelatorioVendas } = await carregar();
    await expect(
      carregarRelatorioVendas(CLIENT, { ...LOJA, timezone: "Nao/Existe" }, SEMANA, A),
    ).resolves.toEqual({ ok: false });
  });
});
