import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 354 — Server Action admin `salvarCicloVendasAdmin(lojaId, payload)`
 * em `src/app/admin/assinantes/actions/admin-vendas.ts` ('use server'). Molde: `admin-entrega.test.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.7 e §8.6.
 *
 * Ordem D-4 (fail-closed):
 *   validarLojaIdAdmin (real) → !ok { ok:false, erro:"Loja inválida." }
 *   → schemaCicloVendas.safeParse (falha SEM elevar)
 *   → prepararContextoAdmin(id) FORA do try (real; prova de admin propaga)
 *   → escopo.atualizarLoja(montarPatchCiclo(d)) → error/count !== 1 → genérico
 *   → registrarAcessoAdmin(svc, { acao: "salvar_ciclo_vendas", … })
 *   → revalidatePath(`/admin/assinantes/${id}/vendas`) → { ok:true }
 *
 * `prepararContextoAdmin` é o REAL; só `verificarAdminSaaS`, `createServiceClient` e
 * `next/cache` são mockados. RED: módulo ausente; import dinâmico por caso. Dados fictícios.
 */

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  opcoes?: unknown;
  filtros: [string, unknown][];
};
let ops: Op[];
let respostaLojas: { data: unknown; error: unknown; count: number | null };

const servico = {
  from(tabela: string) {
    const op: Op = { tabela, filtros: [] };
    ops.push(op);
    const q: Record<string, unknown> = {};
    q.update = (row: Record<string, unknown>, opcoes?: unknown) => {
      op.update = row;
      op.opcoes = opcoes;
      return q;
    };
    q.insert = (row: Record<string, unknown>) => {
      op.insert = row;
      return q;
    };
    q.eq = (col: string, val: unknown) => {
      op.filtros.push([col, val]);
      return q;
    };
    q.select = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(tabela === "lojas" ? respostaLojas : { data: null, error: null, count: 1 }).then(ok, ko);
    return q;
  },
};

const createServiceClient = vi.fn(() => servico);
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => ADMIN_ID,
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a), revalidateTag: vi.fn() }));

type Resultado = { ok: true } | { ok: false; erro: string };
type Mod = { salvarCicloVendasAdmin: (lojaId: string, payload: unknown) => Promise<Resultado> };

async function carregar(): Promise<Mod> {
  return (await import("./admin-vendas")) as unknown as Mod;
}

/** `registrarAcessoAdmin` é fire-and-forget: espera a IIFE resolver. */
const drenar = () => new Promise((r) => setTimeout(r, 0));
const updatesLojas = () => ops.filter((o) => o.tabela === "lojas" && o.update);
const acessos = () => ops.filter((o) => o.tabela === "admin_acessos" && o.insert).map((o) => o.insert!);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaLojas = { data: null, error: null, count: 1 };
  verificarAdminSaaS.mockResolvedValue(undefined);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("salvarCicloVendasAdmin — entrada", () => {
  it("lojaId 'x' → { ok:false, erro:'Loja inválida.' } sem guard nem service", async () => {
    const { salvarCicloVendasAdmin } = await carregar();
    expect(await salvarCicloVendasAdmin("x", { dia_inicio_ciclo: 5 })).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    ["0", { dia_inicio_ciclo: 0 }],
    ['"5"', { dia_inicio_ciclo: "5" }],
    ["chave extra assinatura_status", { dia_inicio_ciclo: 5, assinatura_status: "ativa" }],
  ])("payload inválido (%s) → { ok:false } SEM elevar", async (_r, payload) => {
    const { salvarCicloVendasAdmin } = await carregar();
    const r = await salvarCicloVendasAdmin(LOJA_ALVO, payload);
    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updatesLojas()).toHaveLength(0);
  });
});

describe("salvarCicloVendasAdmin — prova de admin", () => {
  it("verificarAdminSaaS rejeita → a action rejeita; createServiceClient não é chamado", async () => {
    const { salvarCicloVendasAdmin } = await carregar();
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));
    await expect(salvarCicloVendasAdmin(LOJA_ALVO, { dia_inicio_ciclo: 5 })).rejects.toThrow("acesso negado");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updatesLojas()).toHaveLength(0);
  });
});

describe("salvarCicloVendasAdmin — escrita", () => {
  it("feliz → update({dia_inicio_ciclo: 5}, {count:'exact'}).eq('id', LOJA_ALVO); log 'salvar_ciclo_vendas'; revalida a rota", async () => {
    const { salvarCicloVendasAdmin } = await carregar();
    expect(await salvarCicloVendasAdmin(LOJA_ALVO, { dia_inicio_ciclo: 5 })).toEqual({ ok: true });
    await drenar();
    const u = updatesLojas();
    expect(u).toHaveLength(1);
    expect(u[0].update).toEqual({ dia_inicio_ciclo: 5 });
    expect(u[0].opcoes).toEqual({ count: "exact" });
    expect(u[0].filtros).toEqual([["id", LOJA_ALVO]]);
    expect(acessos()).toHaveLength(1);
    expect(acessos()[0]).toMatchObject({ loja_id: LOJA_ALVO, acao: "salvar_ciclo_vendas" });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/assinantes/${LOJA_ALVO}/vendas`);
  });

  it("count 0 → { ok:false } genérico, sem revalidar", async () => {
    const { salvarCicloVendasAdmin } = await carregar();
    respostaLojas = { data: null, error: null, count: 0 };
    const r = await salvarCicloVendasAdmin(LOJA_ALVO, { dia_inicio_ciclo: 5 });
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
