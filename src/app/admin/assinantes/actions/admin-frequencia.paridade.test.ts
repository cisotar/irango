import { describe, it, expect, vi, beforeEach } from "vitest";
import { MSG_HORA_ORDEM } from "@/lib/validacoes/cardapio";

/**
 * Fase RED (TDD) — issue 322 (crítica: SIM). PARIDADE lojista × admin da escrita
 * de frequência. Molde: `admin-produtos.paridade.test.ts`.
 *
 * O hub admin escreve com `service_role` (BYPASSRLS): nenhuma regra que more só
 * na RLS protege esta via. O que protege é (1) a ordem D-4
 * `validarLojaIdAdmin → zod → prepararContextoAdmin` (prova de admin FORA do
 * try, propaga), (2) `p_loja_id` = `lojaId` da URL — nunca do payload — e (3) o
 * MESMO contrato de args do lojista (`frequencia-contrato.ts`, C4).
 *
 * Autoridade: specs/frequencia-exibicao.md RN-5, RN-6, RN-8 ·
 * plan/tecnico-frequencia-exibicao.md C4, C5 (tabela admin), D6, D13,
 * "Testes do P3" item 9.
 *
 * ⚠️ SEAM 322 → GREEN:
 *   admin-produtos.ts:   aplicarFrequenciaEmProdutosAdmin(lojaId, payload)
 *                        salvarGradeDeDiasAdmin(lojaId, payload)
 *   admin-categorias.ts: alternarOcultaCategoriaAdmin(lojaId, id, oculta)
 *                        definirFrequenciaCategoriaAdmin(lojaId, payload)
 *   produto.ts (lojista): as 4 equivalentes (para o espelho).
 * Nenhuma existe: resolvidas por NAMESPACE, RED = "export ausente".
 *
 * NENHUMA lógica de produção aqui.
 */

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111"; // loja da URL admin
const LOJA_DO_DONO = "33333333-3333-4333-8333-333333333333"; // loja do lojista (espelho)
const LOJA_OUTRA = "22222222-2222-4222-8222-222222222222";
const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const MSG_SALVAR_FREQUENCIA = "Não foi possível salvar a frequência.";
const MSG_CATEGORIA_NAO_ENCONTRADA = "Categoria não encontrada.";
const MSG_LOJA_INVALIDA = "Loja inválida.";

// ── Captura: um client por mundo, mesma forma ────────────────────────────────
type Op = {
  mundo: "admin" | "lojista";
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  opcoesUpdate?: unknown;
  filtros: Array<[string, unknown]>;
};
type ChamadaRpc = { mundo: "admin" | "lojista"; nome: string; args: Record<string, unknown> };
let ops: Op[];
let chamadasRpc: ChamadaRpc[];
let respostaRpc: { data: unknown; error: unknown };
let respostaPorTabela: Record<string, { data: unknown; error: unknown; count?: number | null }>;

function makeClient(mundo: "admin" | "lojista") {
  return {
    from: (tabela: string) => {
      const op: Op = { mundo, tabela, filtros: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "limit", "order"]) {
        q[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          return q;
        };
      }
      q.insert = (row: Record<string, unknown>) => {
        op.insert = row;
        return q;
      };
      q.update = (row: Record<string, unknown>, opcoes?: unknown) => {
        op.update = row;
        op.opcoesUpdate = opcoes;
        return q;
      };
      q.upsert = () => q;
      q.delete = () => q;
      q.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(respostaPorTabela[tabela] ?? { data: null, error: null, count: 1 }).then(onF);
      return q;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ mundo, nome, args });
      return Promise.resolve(respostaRpc);
    },
  };
}

const servico = makeClient("admin");
const createServiceClient = vi.fn(() => servico);
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

const autenticado = makeClient("lojista");
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => autenticado }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as adminProdutos from "./admin-produtos";
import * as adminCategorias from "./admin-categorias";
import * as lojista from "@/lib/actions/produto";

type Resultado = { ok: true } | { ok: false; erro: string };
type AcoesAdmin = {
  aplicarFrequenciaEmProdutosAdmin(lojaId: unknown, payload: unknown): Promise<Resultado>;
  salvarGradeDeDiasAdmin(lojaId: unknown, payload: unknown): Promise<Resultado>;
  alternarOcultaCategoriaAdmin(lojaId: unknown, id: unknown, oculta: unknown): Promise<Resultado>;
  definirFrequenciaCategoriaAdmin(lojaId: unknown, payload: unknown): Promise<Resultado>;
};
type AcoesLojista = {
  aplicarFrequenciaEmProdutos(payload: unknown): Promise<Resultado>;
  salvarGradeDeDias(payload: unknown): Promise<Resultado>;
  alternarOcultaCategoria(id: unknown, oculta: unknown): Promise<Resultado>;
  definirFrequenciaCategoria(payload: unknown): Promise<Resultado>;
};

function exigir<T>(mod: unknown, nomes: readonly string[], arquivo: string): T {
  const m = mod as Record<string, unknown>;
  const faltando = nomes.filter((n) => typeof m[n] !== "function");
  if (faltando.length > 0) {
    throw new Error(`[RED 322] \`${arquivo}\` ainda não exporta: ${faltando.join(", ")} (C5).`);
  }
  return m as T;
}

function admin(): AcoesAdmin {
  const p = exigir<Pick<AcoesAdmin, "aplicarFrequenciaEmProdutosAdmin" | "salvarGradeDeDiasAdmin">>(
    adminProdutos,
    ["aplicarFrequenciaEmProdutosAdmin", "salvarGradeDeDiasAdmin"],
    "admin-produtos.ts",
  );
  const c = exigir<
    Pick<AcoesAdmin, "alternarOcultaCategoriaAdmin" | "definirFrequenciaCategoriaAdmin">
  >(
    adminCategorias,
    ["alternarOcultaCategoriaAdmin", "definirFrequenciaCategoriaAdmin"],
    "admin-categorias.ts",
  );
  return { ...p, ...c };
}

function doLojista(): AcoesLojista {
  return exigir<AcoesLojista>(
    lojista,
    [
      "aplicarFrequenciaEmProdutos",
      "salvarGradeDeDias",
      "alternarOcultaCategoria",
      "definirFrequenciaCategoria",
    ],
    "src/lib/actions/produto.ts",
  );
}

// ── Payloads ─────────────────────────────────────────────────────────────────
const FREQ = {
  dias_semana: [5, 1, 3],
  hora_inicio: "11:00",
  hora_fim: "15:00",
  periodo_inicio: "2026-12-01",
  periodo_fim: "2026-12-31",
};
const FREQ_RN8 = { ...FREQ, dias_semana: [] as number[] };
const FREQ_INVALIDA = { ...FREQ, hora_inicio: "15:00", hora_fim: "11:00" };

const PAYLOAD_SELECAO = { produto_ids: [P1, P2], frequencia: FREQ_RN8 };
const PAYLOAD_GRADE = {
  itens: [
    { produto_id: P1, dias_semana: [] },
    { produto_id: P2, dias_semana: [6, 0] },
  ],
};
const PAYLOAD_CATEGORIA = { categoria_id: CAT, frequencia: FREQ };

const rpcDe = (mundo: "admin" | "lojista") => chamadasRpc.filter((c) => c.mundo === mundo);
const escritaDe = (mundo: "admin" | "lojista", tabela: string) =>
  ops.find((o) => o.mundo === mundo && o.tabela === tabela && (o.update || o.insert));
const semLoja = (args: Record<string, unknown>) => {
  const { p_loja_id: _l, ...resto } = args;
  void _l;
  return resto;
};
/** `registrarAcessoAdmin` é fire-and-forget: espera a IIFE resolver. */
const drenar = () => new Promise((r) => setTimeout(r, 0));
const acoesLogadas = () =>
  ops
    .filter((o) => o.tabela === "admin_acessos" && o.insert)
    .map((o) => o.insert as Record<string, unknown>);

beforeEach(() => {
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: 2, error: null };
  respostaPorTabela = {
    categorias: { data: null, error: null, count: 1 },
    lojas: { data: { id: LOJA_ALVO, slug: "loja-alvo", timezone: "America/Sao_Paulo" }, error: null, count: 1 },
  };
  verificarAdminSaaS.mockReset();
  verificarAdminSaaS.mockResolvedValue(undefined);
  createServiceClient.mockClear();
  buscarLojaDoDono.mockReset();
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DO_DONO, slug: "loja-do-dono", timezone: "America/Sao_Paulo" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════
describe("[322/D-4] lojaId inválido ⇒ 'Loja inválida.' sem prova de admin nem service_role", () => {
  it.each([
    ["aplicarFrequenciaEmProdutosAdmin", (a: AcoesAdmin) => a.aplicarFrequenciaEmProdutosAdmin("x", PAYLOAD_SELECAO)],
    ["salvarGradeDeDiasAdmin", (a: AcoesAdmin) => a.salvarGradeDeDiasAdmin("x", PAYLOAD_GRADE)],
    ["alternarOcultaCategoriaAdmin", (a: AcoesAdmin) => a.alternarOcultaCategoriaAdmin("x", CAT, true)],
    ["definirFrequenciaCategoriaAdmin", (a: AcoesAdmin) => a.definirFrequenciaCategoriaAdmin("x", PAYLOAD_CATEGORIA)],
  ])("%s", async (_nome, chamar) => {
    const r = await chamar(admin());
    expect(r).toEqual({ ok: false, erro: MSG_LOJA_INVALIDA });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });
});

describe("[322/D-4] payload inválido ⇒ recusa ANTES de prepararContextoAdmin", () => {
  it.each([
    [
      "aplicarFrequenciaEmProdutosAdmin (hora invertida)",
      (a: AcoesAdmin) => a.aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, { produto_ids: [P1], frequencia: FREQ_INVALIDA }),
    ],
    [
      "aplicarFrequenciaEmProdutosAdmin (loja_id no corpo)",
      (a: AcoesAdmin) =>
        a.aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, { ...PAYLOAD_SELECAO, loja_id: LOJA_OUTRA }),
    ],
    [
      "salvarGradeDeDiasAdmin (item sem dias_semana)",
      (a: AcoesAdmin) => a.salvarGradeDeDiasAdmin(LOJA_ALVO, { itens: [{ produto_id: P1 }] }),
    ],
    [
      "alternarOcultaCategoriaAdmin (oculta não booleano)",
      (a: AcoesAdmin) => a.alternarOcultaCategoriaAdmin(LOJA_ALVO, CAT, "sim"),
    ],
    [
      "definirFrequenciaCategoriaAdmin (hora invertida)",
      (a: AcoesAdmin) =>
        a.definirFrequenciaCategoriaAdmin(LOJA_ALVO, { categoria_id: CAT, frequencia: FREQ_INVALIDA }),
    ],
  ])("%s", async (_nome, chamar) => {
    const r = await chamar(admin());
    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it("hora invertida devolve a MESMA mensagem do lojista (MSG_HORA_ORDEM)", async () => {
    const r = await admin().aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, {
      produto_ids: [P1],
      frequencia: FREQ_INVALIDA,
    });
    expect(r).toEqual({ ok: false, erro: MSG_HORA_ORDEM });
  });
});

describe("[322/D-4] prova de admin falha ⇒ a action REJEITA e nada é escrito", () => {
  it.each([
    ["aplicarFrequenciaEmProdutosAdmin", (a: AcoesAdmin) => a.aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, PAYLOAD_SELECAO)],
    ["salvarGradeDeDiasAdmin", (a: AcoesAdmin) => a.salvarGradeDeDiasAdmin(LOJA_ALVO, PAYLOAD_GRADE)],
    ["alternarOcultaCategoriaAdmin", (a: AcoesAdmin) => a.alternarOcultaCategoriaAdmin(LOJA_ALVO, CAT, true)],
    ["definirFrequenciaCategoriaAdmin", (a: AcoesAdmin) => a.definirFrequenciaCategoriaAdmin(LOJA_ALVO, PAYLOAD_CATEGORIA)],
  ])("%s", async (_nome, chamar) => {
    const acoes = admin();
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(chamar(acoes)).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
    expect(ops.filter((o) => o.update || o.insert)).toHaveLength(0);
  });
});

describe("[322/RN-5] mesmo payload nos dois mundos ⇒ args idênticos exceto p_loja_id", () => {
  it("seleção (com dias_semana []): admin usa LOJA_ALVO; RN-8 chega [] nos dois", async () => {
    const a = admin();
    const l = doLojista();
    expect(await a.aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, PAYLOAD_SELECAO)).toEqual({ ok: true });
    expect(await l.aplicarFrequenciaEmProdutos(PAYLOAD_SELECAO)).toEqual({ ok: true });

    const [ra] = rpcDe("admin");
    const [rl] = rpcDe("lojista");
    expect(ra.nome).toBe("aplicar_frequencia_em_produtos");
    expect(rl.nome).toBe("aplicar_frequencia_em_produtos");
    expect(ra.args.p_loja_id).toBe(LOJA_ALVO);
    expect(rl.args.p_loja_id).toBe(LOJA_DO_DONO);
    expect(semLoja(ra.args)).toEqual(semLoja(rl.args));
    expect((ra.args.p_frequencia as Record<string, unknown>).dias_semana).toEqual([]);
    expect(ra.args).toEqual({
      p_loja_id: LOJA_ALVO,
      p_ids: [P1, P2],
      p_frequencia: { ...FREQ, dias_semana: [] },
    });
  });

  it("grade: admin usa LOJA_ALVO; `[]` fica `[]`, [6,0] vira [0,6]", async () => {
    const a = admin();
    const l = doLojista();
    await a.salvarGradeDeDiasAdmin(LOJA_ALVO, PAYLOAD_GRADE);
    await l.salvarGradeDeDias(PAYLOAD_GRADE);

    const [ra] = rpcDe("admin");
    const [rl] = rpcDe("lojista");
    expect(ra.nome).toBe("salvar_grade_de_dias");
    expect(ra.args).toEqual({
      p_loja_id: LOJA_ALVO,
      p_itens: [
        { produto_id: P1, dias_semana: [] },
        { produto_id: P2, dias_semana: [0, 6] },
      ],
    });
    expect(semLoja(ra.args)).toEqual(semLoja(rl.args));
  });

  it("`loja_id` hostil no payload NUNCA chega ao p_loja_id (recusado pelo strict)", async () => {
    const r = await admin().salvarGradeDeDiasAdmin(LOJA_ALVO, { ...PAYLOAD_GRADE, loja_id: LOJA_OUTRA });
    expect(r.ok).toBe(false);
    expect(chamadasRpc.some((c) => c.args.p_loja_id === LOJA_OUTRA)).toBe(false);
  });

  it("erro da RPC ⇒ a MESMA genérica do lojista; 'linhas afetadas' não vaza", async () => {
    respostaRpc = {
      data: null,
      error: { code: "P0001", message: "aplicar_frequencia_em_produtos: 2 ids, 1 linhas afetadas" },
    };
    const ra = await admin().aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, PAYLOAD_SELECAO);
    const rl = await doLojista().aplicarFrequenciaEmProdutos(PAYLOAD_SELECAO);
    expect(ra).toEqual({ ok: false, erro: MSG_SALVAR_FREQUENCIA });
    expect(ra).toEqual(rl);
    expect(JSON.stringify(ra)).not.toContain("linhas afetadas");
  });

  it("erro da RPC na grade ⇒ genérica", async () => {
    respostaRpc = {
      data: null,
      error: { code: "P0001", message: "salvar_grade_de_dias: 2 itens, 1 linhas afetadas" },
    };
    const r = await admin().salvarGradeDeDiasAdmin(LOJA_ALVO, PAYLOAD_GRADE);
    expect(r).toEqual({ ok: false, erro: MSG_SALVAR_FREQUENCIA });
  });
});

describe("[322/RN-5] categoria: UPDATE escopado por LOJA_ALVO + id, patch igual ao do lojista", () => {
  it("alternarOcultaCategoriaAdmin: patch { oculta }, filtros loja_id=LOJA_ALVO e id", async () => {
    const a = admin();
    const l = doLojista();
    expect(await a.alternarOcultaCategoriaAdmin(LOJA_ALVO, CAT, true)).toEqual({ ok: true });
    await l.alternarOcultaCategoria(CAT, true);

    const oa = escritaDe("admin", "categorias");
    const ol = escritaDe("lojista", "categorias");
    expect(oa?.update).toEqual({ oculta: true });
    expect(oa?.update).toEqual(ol?.update);
    expect(oa?.filtros).toEqual(expect.arrayContaining([["loja_id", LOJA_ALVO], ["id", CAT]]));
    expect(oa?.opcoesUpdate).toMatchObject({ count: "exact" });
  });

  it("definirFrequenciaCategoriaAdmin: patch = 5 chaves normalizadas, igual ao lojista", async () => {
    const a = admin();
    const l = doLojista();
    expect(await a.definirFrequenciaCategoriaAdmin(LOJA_ALVO, PAYLOAD_CATEGORIA)).toEqual({ ok: true });
    await l.definirFrequenciaCategoria(PAYLOAD_CATEGORIA);

    const oa = escritaDe("admin", "categorias");
    const ol = escritaDe("lojista", "categorias");
    expect(oa?.update).toEqual({ ...FREQ, dias_semana: [1, 3, 5] });
    expect(oa?.update).toEqual(ol?.update);
    expect(oa?.filtros).toEqual(expect.arrayContaining([["loja_id", LOJA_ALVO], ["id", CAT]]));
  });

  it("count 0 (categoria de outra loja) ⇒ 'Categoria não encontrada.' nas duas actions", async () => {
    respostaPorTabela.categorias = { data: null, error: null, count: 0 };
    const a = admin();
    expect(await a.alternarOcultaCategoriaAdmin(LOJA_ALVO, CAT, true)).toEqual({
      ok: false,
      erro: MSG_CATEGORIA_NAO_ENCONTRADA,
    });
    expect(await a.definirFrequenciaCategoriaAdmin(LOJA_ALVO, PAYLOAD_CATEGORIA)).toEqual({
      ok: false,
      erro: MSG_CATEGORIA_NAO_ENCONTRADA,
    });
  });
});

describe("[322] auditoria: admin_acessos recebe a ação certa", () => {
  it("as 4 ações logam produto.frequencia_lote, produto.grade_dias, categoria.oculta, categoria.frequencia", async () => {
    const a = admin();
    await a.aplicarFrequenciaEmProdutosAdmin(LOJA_ALVO, PAYLOAD_SELECAO);
    await a.salvarGradeDeDiasAdmin(LOJA_ALVO, PAYLOAD_GRADE);
    await a.alternarOcultaCategoriaAdmin(LOJA_ALVO, CAT, true);
    await a.definirFrequenciaCategoriaAdmin(LOJA_ALVO, PAYLOAD_CATEGORIA);
    await drenar();

    const logs = acoesLogadas();
    expect(logs.map((l) => l.acao).sort()).toEqual(
      ["categoria.frequencia", "categoria.oculta", "produto.frequencia_lote", "produto.grade_dias"],
    );
    for (const l of logs) expect(l.loja_id).toBe(LOJA_ALVO);
    const lote = logs.find((l) => l.acao === "produto.frequencia_lote");
    expect(lote?.metadados).toMatchObject({ produtos: 2 });
  });
});
