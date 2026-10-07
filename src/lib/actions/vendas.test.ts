import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 354 — Server Action do lojista `salvarCicloVendas(payload)`
 * em `src/lib/actions/vendas.ts` ('use server'). Molde: `entrega.modalidades.test.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.7 e §8.6; RN-V08.
 *
 * Contrato:
 *   schemaCicloVendas.safeParse → falha: { ok:false, erro: "Escolha um dia entre 1 e 28." } SEM I/O
 *   createClient → buscarLojaDoDono (null → genérico)
 *   → from("lojas").update(montarPatchCiclo(d), { count: "exact" }).eq("id", loja.id)
 *   → error / count !== 1 → genérico (sem vazar mensagem) → revalidatePath("/painel/vendas") → { ok:true }
 *   A loja vem SEMPRE da sessão (buscarLojaDoDono), nunca do payload.
 *
 * Mock só de I/O. RED: o módulo não existe; import dinâmico por caso. Dados fictícios.
 */

const LOJA_DA_SESSAO = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const ERRO_GENERICO = "Não foi possível salvar o ciclo. Tente de novo.";

type Op = { tabela: string; update?: unknown; opcoes?: unknown; filtros: [string, unknown][] };
let ops: Op[];
let resposta: { data: unknown; error: unknown; count: number | null };

const client = {
  from(tabela: string) {
    const op: Op = { tabela, filtros: [] };
    ops.push(op);
    const q: Record<string, unknown> = {};
    q.update = (patch: unknown, opcoes?: unknown) => {
      op.update = patch;
      op.opcoes = opcoes;
      return q;
    };
    q.eq = (col: string, val: unknown) => {
      op.filtros.push([col, val]);
      return q;
    };
    q.select = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, ko);
    return q;
  },
};

const createClient = vi.fn(async () => client);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a), revalidateTag: vi.fn() }));

type Resultado = { ok: true } | { ok: false; erro: string };
type Mod = { salvarCicloVendas: (payload: unknown) => Promise<Resultado> };

async function carregar(): Promise<Mod> {
  return (await import("./vendas")) as unknown as Mod;
}

const updates = () => ops.filter((o) => o.update !== undefined);
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  resposta = { data: null, error: null, count: 1 };
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DA_SESSAO, dono_id: "dono", dia_inicio_ciclo: 1 });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("salvarCicloVendas (lojista)", () => {
  it("{ dia_inicio_ciclo: 29 } → erro de validação SEM I/O", async () => {
    const { salvarCicloVendas } = await carregar();
    expect(await salvarCicloVendas({ dia_inicio_ciclo: 29 })).toEqual({
      ok: false,
      erro: "Escolha um dia entre 1 e 28.",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("payload com loja_id alheio → recusado (schema strict), sem update", async () => {
    const { salvarCicloVendas } = await carregar();
    const r = await salvarCicloVendas({ dia_inicio_ciclo: 5, loja_id: OUTRA });
    expect(r.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it("sem loja na sessão → genérico, sem update", async () => {
    const { salvarCicloVendas } = await carregar();
    buscarLojaDoDono.mockResolvedValueOnce(null);
    expect(await salvarCicloVendas({ dia_inicio_ciclo: 5 })).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(updates()).toHaveLength(0);
  });

  it("feliz → update({dia_inicio_ciclo: 5}, {count:'exact'}).eq('id', loja da sessão); revalida /painel/vendas", async () => {
    const { salvarCicloVendas } = await carregar();
    expect(await salvarCicloVendas({ dia_inicio_ciclo: 5 })).toEqual({ ok: true });
    const u = updates();
    expect(u).toHaveLength(1);
    expect(u[0].tabela).toBe("lojas");
    expect(u[0].update).toEqual({ dia_inicio_ciclo: 5 });
    expect(u[0].opcoes).toEqual({ count: "exact" });
    expect(u[0].filtros).toEqual([["id", LOJA_DA_SESSAO]]);
    expect(revalidatePath).toHaveBeenCalledWith("/painel/vendas");
  });

  it("count 0 → genérico", async () => {
    const { salvarCicloVendas } = await carregar();
    resposta = { data: null, error: null, count: 0 };
    expect(await salvarCicloVendas({ dia_inicio_ciclo: 5 })).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("error do banco → genérico; a mensagem interna não vaza", async () => {
    const { salvarCicloVendas } = await carregar();
    resposta = { data: null, error: { code: "42501", message: "detalhe interno x" }, count: null };
    const r = await salvarCicloVendas({ dia_inicio_ciclo: 5 });
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
