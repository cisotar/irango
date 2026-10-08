import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fase RED (TDD) da issue 357 — loader admin `carregarVendasLojaAdmin(lojaId, filtros, agora)`
 * em `src/app/admin/assinantes/[lojaId]/carga-vendas.ts`. Molde: `carga-pedidos.test.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.6 e §8.6; RN-V23 (admin não vê clientes).
 *
 * Ordem inegociável (fail-closed):
 *   validarLojaIdAdmin (real, z.guid) → !ok notFound() → await verificarAdminSaaS() (propaga)
 *   → createServiceClient() → buscarLojaAdminPorId(svc, id) → null notFound()
 *   → carregarRelatorioVendas(svc, loja, filtros, agora)
 * Nunca toca o ranking de clientes (nem import, nem chamada).
 *
 * RED: o módulo ainda não existe; import dinâmico por caso. Dados fictícios.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const ordem: string[] = [];

const verificarAdminSaaS = vi.fn(async () => {
  ordem.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
}));

const svc = { marker: "svc-fake" };
const createServiceClient = vi.fn(() => {
  ordem.push("createServiceClient");
  return svc;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
const notFound = vi.fn(() => {
  ordem.push("notFound");
  throw new NotFoundError();
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

const LOJA = { id: LOJA_ID, timezone: "America/Sao_Paulo", dia_inicio_ciclo: 5, nome: "Loja Teste" };
const buscarLojaAdminPorId = vi.fn(async (_c: unknown, _id: string): Promise<unknown> => {
  ordem.push("buscarLojaAdminPorId");
  return LOJA;
});
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (c: unknown, id: string) => buscarLojaAdminPorId(c, id),
}));

const RELATORIO = { ok: true, contexto: {}, dados: {} };
const carregarRelatorioVendas = vi.fn(async (..._a: unknown[]): Promise<unknown> => {
  ordem.push("carregarRelatorioVendas");
  return RELATORIO;
});
vi.mock("@/lib/vendas/carregarRelatorioVendas", () => ({
  carregarRelatorioVendas: (...a: unknown[]) => carregarRelatorioVendas(...a),
}));

const carregarRankingClientes = vi.fn();
vi.mock("@/lib/vendas/carregarRankingClientes", () => ({
  carregarRankingClientes: (...a: unknown[]) => carregarRankingClientes(...a),
}));

type Filtros = {
  periodo: "hoje" | "semana" | "mes" | "mes_anterior" | "ano" | "personalizado";
  de: string | null;
  ate: string | null;
  entrega: "entrega" | "retirada" | "ambos";
  concluidos: boolean;
};
type Mod = {
  carregarVendasLojaAdmin: (
    lojaId: string,
    filtros: Filtros,
    agora: Date,
  ) => Promise<{ loja: { id: string }; relatorio: unknown }>;
};

async function carregar(): Promise<Mod> {
  return (await import("./carga-vendas")) as unknown as Mod;
}

const FILTROS: Filtros = { periodo: "semana", de: null, ate: null, entrega: "ambos", concluidos: false };
const AGORA = new Date("2026-10-07T15:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  ordem.length = 0;
});

describe("carregarVendasLojaAdmin — lojaId inválido", () => {
  it("'x' → notFound ANTES de provar admin, elevar ou montar", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    await expect(carregarVendasLojaAdmin("x", FILTROS, AGORA)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(carregarRelatorioVendas).not.toHaveBeenCalled();
  });
});

describe("carregarVendasLojaAdmin — admin não provado", () => {
  it("verificarAdminSaaS rejeita → propaga; createServiceClient não é chamado", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));
    await expect(carregarVendasLojaAdmin(LOJA_ID, FILTROS, AGORA)).rejects.toThrow("acesso negado");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(carregarRelatorioVendas).not.toHaveBeenCalled();
  });
});

describe("carregarVendasLojaAdmin — escopo e ordem", () => {
  it("ordem: verificarAdminSaaS → createServiceClient → buscarLojaAdminPorId(svc, LOJA_ID)", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    await carregarVendasLojaAdmin(LOJA_ID, FILTROS, AGORA);
    expect(ordem.slice(0, 3)).toEqual(["verificarAdminSaaS", "createServiceClient", "buscarLojaAdminPorId"]);
    expect(buscarLojaAdminPorId).toHaveBeenCalledWith(svc, LOJA_ID);
  });

  it("loja inexistente → notFound; relatório não é montado", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    buscarLojaAdminPorId.mockResolvedValueOnce(null);
    await expect(carregarVendasLojaAdmin(LOJA_ID, FILTROS, AGORA)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(carregarRelatorioVendas).not.toHaveBeenCalled();
    expect(carregarRankingClientes).not.toHaveBeenCalled();
  });

  it("feliz → carregarRelatorioVendas(svc, loja, filtros, agora) com a loja validada; devolve { loja, relatorio }", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    const r = await carregarVendasLojaAdmin(LOJA_ID, FILTROS, AGORA);
    expect(carregarRelatorioVendas).toHaveBeenCalledTimes(1);
    const [c, loja, filtros, agora] = carregarRelatorioVendas.mock.calls[0]!;
    expect(c).toBe(svc);
    expect((loja as { id: string }).id).toBe(LOJA_ID);
    expect((loja as { id: string }).id).not.toBe(OUTRA_LOJA);
    expect(filtros).toEqual(FILTROS);
    expect(agora).toBe(AGORA);
    expect(r).toEqual({ loja: LOJA, relatorio: RELATORIO });
  });
});

describe("carregarVendasLojaAdmin — RN-V23: admin nunca toca o ranking de clientes", () => {
  it("carregarRankingClientes não é chamado e o arquivo não menciona ranking", async () => {
    const { carregarVendasLojaAdmin } = await carregar();
    await carregarVendasLojaAdmin(LOJA_ID, FILTROS, AGORA);
    expect(carregarRankingClientes).not.toHaveBeenCalled();
    const fonte = readFileSync(join(process.cwd(), "src/app/admin/assinantes/[lojaId]/carga-vendas.ts"), "utf8");
    expect(fonte).not.toMatch(/ranking/i);
  });
});
