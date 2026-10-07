import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 354 — PARIDADE lojista × admin da escrita do ciclo mensal.
 * Molde: `admin-frequencia.paridade.test.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.7 e §8.6.
 *
 * O hub admin escreve com service_role (BYPASSRLS): a única coisa que limita O QUE é
 * gravado é o builder compartilhado `montarPatchCiclo` + o mesmo `schemaCicloVendas`.
 * Para o mesmo payload válido, o patch que chega ao UPDATE nas duas pontas é idêntico e
 * igual a `{ dia_inicio_ciclo: 5 }`; os mesmos payloads inválidos são recusados pelas duas.
 *
 * RED: `src/lib/actions/vendas.ts` e `admin-vendas.ts` não existem; import dinâmico.
 */

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";
const LOJA_DO_DONO = "33333333-3333-4333-8333-333333333333";

type Mundo = "admin" | "lojista";
type Op = { mundo: Mundo; tabela: string; update?: Record<string, unknown>; insert?: unknown; filtros: [string, unknown][] };
let ops: Op[];

function makeClient(mundo: Mundo) {
  return {
    from(tabela: string) {
      const op: Op = { mundo, tabela, filtros: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      q.update = (row: Record<string, unknown>) => {
        op.update = row;
        return q;
      };
      q.insert = (row: unknown) => {
        op.insert = row;
        return q;
      };
      q.eq = (col: string, val: unknown) => {
        op.filtros.push([col, val]);
        return q;
      };
      q.select = () => q;
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, count: 1 }).then(ok, ko);
      return q;
    },
  };
}

const servico = makeClient("admin");
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => servico }));
const autenticado = makeClient("lojista");
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => autenticado }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => undefined),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

type Resultado = { ok: true } | { ok: false; erro: string };

async function lojista(): Promise<(p: unknown) => Promise<Resultado>> {
  const m = (await import("@/lib/actions/vendas")) as unknown as { salvarCicloVendas: (p: unknown) => Promise<Resultado> };
  return m.salvarCicloVendas;
}
async function admin(): Promise<(id: string, p: unknown) => Promise<Resultado>> {
  const m = (await import("./admin-vendas")) as unknown as {
    salvarCicloVendasAdmin: (id: string, p: unknown) => Promise<Resultado>;
  };
  return m.salvarCicloVendasAdmin;
}

const patchDe = (mundo: Mundo) => ops.find((o) => o.mundo === mundo && o.tabela === "lojas" && o.update)?.update;

const INVALIDOS: [string, unknown][] = [
  ["0", { dia_inicio_ciclo: 0 }],
  ["29", { dia_inicio_ciclo: 29 }],
  ['"5"', { dia_inicio_ciclo: "5" }],
  ["chave extra assinatura_status", { dia_inicio_ciclo: 5, assinatura_status: "ativa" }],
];

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DO_DONO, dia_inicio_ciclo: 1 });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("paridade do ciclo mensal — lojista × admin (354)", () => {
  it("mesmo payload válido → o MESMO patch nas duas pontas, igual a { dia_inicio_ciclo: 5 }", async () => {
    const salvarLojista = await lojista();
    const salvarAdmin = await admin();
    expect(await salvarLojista({ dia_inicio_ciclo: 5 })).toEqual({ ok: true });
    expect(await salvarAdmin(LOJA_ALVO, { dia_inicio_ciclo: 5 })).toEqual({ ok: true });
    const pl = patchDe("lojista");
    const pa = patchDe("admin");
    expect(pl).toEqual({ dia_inicio_ciclo: 5 });
    expect(pa).toEqual(pl);
  });

  it.each(INVALIDOS)("payload inválido (%s) é recusado pelas duas, sem UPDATE", async (_r, payload) => {
    const salvarLojista = await lojista();
    const salvarAdmin = await admin();
    expect((await salvarLojista(payload)).ok).toBe(false);
    expect((await salvarAdmin(LOJA_ALVO, payload)).ok).toBe(false);
    expect(patchDe("lojista")).toBeUndefined();
    expect(patchDe("admin")).toBeUndefined();
  });
});
