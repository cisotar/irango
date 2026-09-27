// TDD RED-first — issue 322 (crítica: SIM): escrita da frequência pelo LOJISTA.
//
// Autoridade: specs/frequencia-exibicao.md RN-5 (escrita escopada), RN-6 (grade
// atômica), RN-8 (`[]` ≠ NULL) · seguranca.md §14 (mensagem de banco não vaza)
// · plan/tecnico-frequencia-exibicao.md C3 (zod), C4 (builders), C5 (actions),
// C6 (payloads), D6 (RPC INVOKER + `p_loja_id`), D13, "Testes do P3" item 8.
//
// ⚠️ SEAM 322 → GREEN. `src/lib/actions/produto.ts` passa a exportar:
//   aplicarFrequenciaEmProdutos(payload)   → rpc("aplicar_frequencia_em_produtos", …)
//   salvarGradeDeDias(payload)             → rpc("salvar_grade_de_dias", …)
//   alternarOcultaCategoria(id, oculta)    → update({ oculta }, { count: "exact" })
//   definirFrequenciaCategoria(payload)    → update(<5 chaves>, { count: "exact" })
// Todas: zod ANTES de qualquer I/O, client AUTENTICADO (nunca service_role),
// `p_loja_id`/`loja_id` = `buscarLojaDoDono`, nunca o payload.
//
// As quatro ainda não existem: resolvidas por NAMESPACE (padrão do RED da 175 /
// 290) para o RED ser "export ausente", não erro de import que derruba o
// arquivo. Os args esperados da RPC são LITERAIS — não chamam o builder de
// produção (o teste não pode reproduzir a fórmula que prova).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MSG_HORA_ORDEM } from "@/lib/validacoes/cardapio";

// Literais de C4/C5 — byte a byte.
const MSG_SALVAR_FREQUENCIA = "Não foi possível salvar a frequência.";
const MSG_CATEGORIA_NAO_ENCONTRADA = "Categoria não encontrada.";
const MSG_PERIODO_ORDEM = "A data de fim não pode ser antes da de início.";
const MSG_LOJA_NAO_ENCONTRADA = "Loja não encontrada.";

const LOJA_DO_DONO = "11111111-1111-4111-8111-111111111111";
const LOJA_OUTRA = "22222222-2222-4222-8222-222222222222";
const SLUG = "loja-do-dono";
const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ── Captura de I/O ───────────────────────────────────────────────────────────
type Op = {
  tabela: string;
  update?: Record<string, unknown>;
  opcoesUpdate?: unknown;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];
let respostaPorTabela: Record<string, { data: unknown; error: unknown; count?: number | null }>;
type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[];
let respostaRpc: { data: unknown; error: unknown };

function makeClient() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "limit", "order"]) {
        q[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          return q;
        };
      }
      q.update = (row: Record<string, unknown>, opcoes?: unknown) => {
        op.update = row;
        op.opcoesUpdate = opcoes;
        return q;
      };
      q.insert = () => q;
      q.upsert = () => q;
      q.delete = () => q;
      q.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(respostaPorTabela[tabela] ?? { data: null, error: null, count: 1 }).then(onF);
      return q;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve(respostaRpc);
    },
  };
}

const authClient = makeClient();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import * as produtoActions from "./produto";

type Resultado = { ok: true } | { ok: false; erro: string };
type Acoes322 = {
  aplicarFrequenciaEmProdutos(payload: unknown): Promise<Resultado>;
  salvarGradeDeDias(payload: unknown): Promise<Resultado>;
  alternarOcultaCategoria(id: unknown, oculta: unknown): Promise<Resultado>;
  definirFrequenciaCategoria(payload: unknown): Promise<Resultado>;
};
const NOMES = [
  "aplicarFrequenciaEmProdutos",
  "salvarGradeDeDias",
  "alternarOcultaCategoria",
  "definirFrequenciaCategoria",
] as const;

function acoes(): Acoes322 {
  const m = produtoActions as unknown as Partial<Acoes322>;
  const faltando = NOMES.filter((n) => typeof m[n] !== "function");
  if (faltando.length > 0) {
    throw new Error(
      `[RED 322] \`src/lib/actions/produto.ts\` ainda não exporta: ${faltando.join(", ")} ` +
        `(C5 do plano técnico).`,
    );
  }
  return m as Acoes322;
}

// ── Payloads (C6) ────────────────────────────────────────────────────────────
const FREQ = {
  dias_semana: [5, 1, 3],
  hora_inicio: "11:00",
  hora_fim: "15:00",
  periodo_inicio: "2026-12-01",
  periodo_fim: "2026-12-31",
};
/** O que chega à RPC: dias normalizados (ordenados), resto idêntico. */
const FREQ_NORMALIZADA = { ...FREQ, dias_semana: [1, 3, 5] };
const CHAVES_FREQUENCIA = ["dias_semana", "hora_fim", "hora_inicio", "periodo_fim", "periodo_inicio"];

const rpcs = (nome: string) => chamadasRpc.filter((c) => c.nome === nome);
const escrita = (tabela: string) => ops.find((o) => o.tabela === tabela && o.update);

beforeEach(() => {
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: 2, error: null };
  respostaPorTabela = { categorias: { data: null, error: null, count: 1 } };
  createClient.mockClear();
  createServiceClient.mockClear();
  revalidatePath.mockClear();
  buscarLojaDoDono.mockReset();
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DO_DONO, slug: SLUG, timezone: "America/Sao_Paulo" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════
describe("[322] aplicarFrequenciaEmProdutos (seleção múltipla e unitária)", () => {
  it("chama a RPC UMA vez com p_loja_id da loja do dono e os dias normalizados", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    const r = await aplicarFrequenciaEmProdutos({ produto_ids: [P1, P2], frequencia: FREQ });

    expect(r).toEqual({ ok: true });
    expect(rpcs("aplicar_frequencia_em_produtos")).toHaveLength(1);
    expect(chamadasRpc).toEqual([
      {
        nome: "aplicar_frequencia_em_produtos",
        args: { p_loja_id: LOJA_DO_DONO, p_ids: [P1, P2], p_frequencia: FREQ_NORMALIZADA },
      },
    ]);
    // Escrita do lojista é RLS autenticada: service_role NUNCA.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("RN-8: dias_semana [] chega `[]` (não null) e p_frequencia tem as 5 chaves", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    await aplicarFrequenciaEmProdutos({ produto_ids: [P1], frequencia: { ...FREQ, dias_semana: [] } });

    expect(chamadasRpc).toHaveLength(1);
    const pf = chamadasRpc[0].args.p_frequencia as Record<string, unknown>;
    expect(pf.dias_semana).toEqual([]);
    expect(pf.dias_semana).not.toBeNull();
    expect(Object.keys(pf).sort()).toEqual(CHAVES_FREQUENCIA);
  });

  it("7 dias ⇒ null; permanente ⇒ as 5 chaves null explícitas", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    await aplicarFrequenciaEmProdutos({
      produto_ids: [P1],
      frequencia: { ...FREQ, dias_semana: [0, 1, 2, 3, 4, 5, 6] },
    });
    await aplicarFrequenciaEmProdutos({
      produto_ids: [P1],
      frequencia: {
        dias_semana: null,
        hora_inicio: null,
        hora_fim: null,
        periodo_inicio: null,
        periodo_fim: null,
      },
    });

    expect(chamadasRpc).toHaveLength(2);
    expect((chamadasRpc[0].args.p_frequencia as Record<string, unknown>).dias_semana).toBeNull();
    expect(chamadasRpc[1].args.p_frequencia).toEqual({
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    });
  });

  it("payload com `loja_id` ⇒ recusa SEM I/O (o escopo nunca vem do corpo)", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    const r = await aplicarFrequenciaEmProdutos({
      produto_ids: [P1],
      frequencia: FREQ,
      loja_id: LOJA_OUTRA,
    });

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR_FREQUENCIA });
    expect(createClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });

  it("hora 15:00/11:00 ⇒ { ok:false, erro: MSG_HORA_ORDEM } antes do banco", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    const r = await aplicarFrequenciaEmProdutos({
      produto_ids: [P1],
      frequencia: { ...FREQ, hora_inicio: "15:00", hora_fim: "11:00" },
    });

    expect(r).toEqual({ ok: false, erro: MSG_HORA_ORDEM });
    expect(createClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });

  it("período invertido ⇒ MSG_PERIODO_ORDEM literal, sem I/O", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    const r = await aplicarFrequenciaEmProdutos({
      produto_ids: [P1],
      frequencia: { ...FREQ, periodo_inicio: "2026-12-31", periodo_fim: "2026-12-01" },
    });

    expect(r).toEqual({ ok: false, erro: MSG_PERIODO_ORDEM });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("chave `dias_semana` ausente ⇒ recusa sem I/O (não vira 'todo dia')", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    const { dias_semana: _d, ...semDias } = FREQ;
    void _d;
    const r = await aplicarFrequenciaEmProdutos({ produto_ids: [P1], frequencia: semDias });

    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("dono sem loja ⇒ 'Loja não encontrada.' e RPC 0×", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await aplicarFrequenciaEmProdutos({ produto_ids: [P1], frequencia: FREQ });

    expect(r).toEqual({ ok: false, erro: MSG_LOJA_NAO_ENCONTRADA });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("§14: erro P0001 da RPC ⇒ genérica; 'linhas afetadas' NÃO vaza (oráculo de existência)", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    respostaRpc = {
      data: null,
      error: { code: "P0001", message: "aplicar_frequencia_em_produtos: 2 ids, 1 linhas afetadas" },
    };
    const r = await aplicarFrequenciaEmProdutos({ produto_ids: [P1, P2], frequencia: FREQ });

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR_FREQUENCIA });
    expect(JSON.stringify(r)).not.toContain("linhas afetadas");
    expect(console.error).toHaveBeenCalled();
  });

  it("revalida /painel/produtos e /loja/<slug>", async () => {
    const { aplicarFrequenciaEmProdutos } = acoes();
    await aplicarFrequenciaEmProdutos({ produto_ids: [P1], frequencia: FREQ });

    const caminhos = revalidatePath.mock.calls.map((c) => c[0]);
    expect(caminhos).toContain("/painel/produtos");
    expect(caminhos).toContain(`/loja/${SLUG}`);
  });
});

describe("[322/RN-6] salvarGradeDeDias (grade produto × dia, tudo ou nada)", () => {
  it("RN-8: linha `[]` chega `[]`, linha de 7 dias chega null; p_loja_id da loja do dono", async () => {
    const { salvarGradeDeDias } = acoes();
    const r = await salvarGradeDeDias({
      itens: [
        { produto_id: P1, dias_semana: [] },
        { produto_id: P2, dias_semana: [0, 1, 2, 3, 4, 5, 6] },
      ],
    });

    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_grade_de_dias",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_itens: [
            { produto_id: P1, dias_semana: [] },
            { produto_id: P2, dias_semana: null },
          ],
        },
      },
    ]);
    const itens = chamadasRpc[0].args.p_itens as Record<string, unknown>[];
    for (const item of itens) expect(Object.keys(item)).toContain("dias_semana");
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("a grade toca SÓ dias_semana: nenhum item carrega hora/período", async () => {
    const { salvarGradeDeDias } = acoes();
    await salvarGradeDeDias({ itens: [{ produto_id: P1, dias_semana: [6, 0] }] });

    expect(chamadasRpc[0].args.p_itens).toEqual([{ produto_id: P1, dias_semana: [0, 6] }]);
  });

  it("payload com `loja_id` ⇒ recusa sem I/O", async () => {
    const { salvarGradeDeDias } = acoes();
    const r = await salvarGradeDeDias({
      itens: [{ produto_id: P1, dias_semana: [1] }],
      loja_id: LOJA_OUTRA,
    });

    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });

  it("item sem a chave dias_semana ⇒ recusa sem I/O", async () => {
    const { salvarGradeDeDias } = acoes();
    const r = await salvarGradeDeDias({ itens: [{ produto_id: P1 }] });

    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("dono sem loja ⇒ 'Loja não encontrada.' e RPC 0×", async () => {
    const { salvarGradeDeDias } = acoes();
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await salvarGradeDeDias({ itens: [{ produto_id: P1, dias_semana: [1] }] });

    expect(r).toEqual({ ok: false, erro: MSG_LOJA_NAO_ENCONTRADA });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("§14: erro P0001 da RPC ⇒ genérica, sem 'linhas afetadas'", async () => {
    const { salvarGradeDeDias } = acoes();
    respostaRpc = {
      data: null,
      error: { code: "P0001", message: "salvar_grade_de_dias: 2 itens, 1 linhas afetadas" },
    };
    const r = await salvarGradeDeDias({
      itens: [
        { produto_id: P1, dias_semana: [1] },
        { produto_id: P2, dias_semana: [2] },
      ],
    });

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR_FREQUENCIA });
    expect(JSON.stringify(r)).not.toContain("linhas afetadas");
  });
});

describe("[322] alternarOcultaCategoria", () => {
  it("patch EXATAMENTE { oculta }, filtros id E loja_id, count exact", async () => {
    const { alternarOcultaCategoria } = acoes();
    const r = await alternarOcultaCategoria(CAT, true);

    expect(r).toEqual({ ok: true });
    const op = escrita("categorias");
    expect(op?.update).toEqual({ oculta: true });
    expect(op?.filtros).toEqual(expect.arrayContaining([["id", CAT], ["loja_id", LOJA_DO_DONO]]));
    expect(op?.opcoesUpdate).toMatchObject({ count: "exact" });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("count 0 (categoria alheia ou inexistente) ⇒ 'Categoria não encontrada.'", async () => {
    const { alternarOcultaCategoria } = acoes();
    respostaPorTabela.categorias = { data: null, error: null, count: 0 };
    const r = await alternarOcultaCategoria(CAT, false);

    expect(r).toEqual({ ok: false, erro: MSG_CATEGORIA_NAO_ENCONTRADA });
  });

  it("oculta não booleano ⇒ recusa sem I/O", async () => {
    const { alternarOcultaCategoria } = acoes();
    const r = await alternarOcultaCategoria(CAT, "true");

    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("id não-uuid ⇒ recusa sem I/O", async () => {
    const { alternarOcultaCategoria } = acoes();
    const r = await alternarOcultaCategoria("nao-e-uuid", true);

    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("dono sem loja ⇒ 'Loja não encontrada.' e nenhum UPDATE", async () => {
    const { alternarOcultaCategoria } = acoes();
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await alternarOcultaCategoria(CAT, true);

    expect(r).toEqual({ ok: false, erro: MSG_LOJA_NAO_ENCONTRADA });
    expect(escrita("categorias")).toBeUndefined();
  });

  it("revalida /painel/produtos e /loja/<slug>", async () => {
    const { alternarOcultaCategoria } = acoes();
    await alternarOcultaCategoria(CAT, true);

    const caminhos = revalidatePath.mock.calls.map((c) => c[0]);
    expect(caminhos).toContain("/painel/produtos");
    expect(caminhos).toContain(`/loja/${SLUG}`);
  });
});

describe("[322] definirFrequenciaCategoria", () => {
  it("patch = as 5 chaves normalizadas, filtros id E loja_id, count exact", async () => {
    const { definirFrequenciaCategoria } = acoes();
    const r = await definirFrequenciaCategoria({ categoria_id: CAT, frequencia: FREQ });

    expect(r).toEqual({ ok: true });
    const op = escrita("categorias");
    expect(op?.update).toEqual(FREQ_NORMALIZADA);
    expect(Object.keys(op?.update ?? {}).sort()).toEqual(CHAVES_FREQUENCIA);
    expect(op?.filtros).toEqual(expect.arrayContaining([["id", CAT], ["loja_id", LOJA_DO_DONO]]));
    expect(op?.opcoesUpdate).toMatchObject({ count: "exact" });
  });

  it("RN-8: categoria com dias [] grava `[]`", async () => {
    const { definirFrequenciaCategoria } = acoes();
    await definirFrequenciaCategoria({ categoria_id: CAT, frequencia: { ...FREQ, dias_semana: [] } });

    expect(escrita("categorias")?.update?.dias_semana).toEqual([]);
  });

  it("count 0 ⇒ 'Categoria não encontrada.'", async () => {
    const { definirFrequenciaCategoria } = acoes();
    respostaPorTabela.categorias = { data: null, error: null, count: 0 };
    const r = await definirFrequenciaCategoria({ categoria_id: CAT, frequencia: FREQ });

    expect(r).toEqual({ ok: false, erro: MSG_CATEGORIA_NAO_ENCONTRADA });
  });

  it("hora 15:00/11:00 ⇒ MSG_HORA_ORDEM sem I/O", async () => {
    const { definirFrequenciaCategoria } = acoes();
    const r = await definirFrequenciaCategoria({
      categoria_id: CAT,
      frequencia: { ...FREQ, hora_inicio: "15:00", hora_fim: "11:00" },
    });

    expect(r).toEqual({ ok: false, erro: MSG_HORA_ORDEM });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("`loja_id` no corpo ou `oculta` dentro da frequência ⇒ recusa sem I/O", async () => {
    const { definirFrequenciaCategoria } = acoes();
    const r1 = await definirFrequenciaCategoria({
      categoria_id: CAT,
      frequencia: FREQ,
      loja_id: LOJA_OUTRA,
    });
    const r2 = await definirFrequenciaCategoria({
      categoria_id: CAT,
      frequencia: { ...FREQ, oculta: true },
    });

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(escrita("categorias")).toBeUndefined();
  });
});
