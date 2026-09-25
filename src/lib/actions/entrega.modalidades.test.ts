import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — spec `specs/modalidades-entrega-loja.md`, fatia A2 (salvar
 * as modalidades de entrega: lojista no painel + admin no hub). Arquivo NOVO:
 * `entregaPagamento.test.ts` e `admin-entrega.test.ts` não são editados.
 *
 * CONTRATO que o GREEN deve satisfazer:
 *
 *   // src/lib/actions/entrega.ts ('use server')
 *   salvarModalidadesEntrega(payload: unknown): Promise<ResultadoEntrega>
 *
 *   // src/app/admin/assinantes/actions/admin-entrega.ts ('use server')
 *   salvarModalidadesEntregaAdmin(lojaId: string, payload: unknown): Promise<ResultadoEntrega>
 *
 *   payload = { aceita_retirada: boolean, aceita_entrega: boolean,
 *               modo_frete: "automatico" | "a_combinar" }
 *
 * Regras:
 *  - zod recusa retirada E entrega desligadas ANTES de qualquer I/O (espelho do
 *    CHECK `lojas_ao_menos_uma_modalidade`); idem `modo_frete` fora do enum;
 *  - o UPDATE grava SÓ as três colunas (allowlist coluna a coluna, sem spread):
 *    `dono_id`, `ativo`, `id`, `loja_id`, billing… do payload nunca chegam lá;
 *  - lojista: client AUTENTICADO, loja = `buscarLojaDoDono()` (nunca do payload);
 *  - admin: `validarLojaIdAdmin` + zod antes de elevar, prova de admin propaga,
 *    escrita via `escopo.atualizarLoja` (`eq("id", lojaId)`);
 *  - zonas continuam salvas: salvar modalidades não toca `zonas_entrega`,
 *    `taxas_entrega` nem `bairros_zona`.
 *
 * O fake de banco é um avaliador em memória (RLS por dono no client
 * autenticado; sem RLS no service_role) — o teste afirma QUAL linha mudou.
 */

import { salvarModalidadesEntrega } from "./entrega";
import { salvarModalidadesEntregaAdmin } from "@/app/admin/assinantes/actions/admin-entrega";

// ───────────────────────────────────────────── fake de banco (avaliador em memória)
type Linha = Record<string, unknown>;
type Filtro = { col: string; op: string; val: unknown };
type Operacao = { tabela: string; op: string; patch?: Linha; filtros: Filtro[]; afetadas: number };

function avaliar(linha: Linha, f: Filtro): boolean {
  const v = linha[f.col];
  switch (f.op) {
    case "eq":
    case "is":
      return v === f.val;
    case "neq":
      return v !== f.val;
    case "in":
      return (f.val as unknown[]).includes(v);
    default:
      throw new Error(`fake: operador de filtro não suportado: ${f.op}`);
  }
}

function criarBanco(opts: { dono: string | null }) {
  const tabelas: Record<string, Linha[]> = { lojas: [] };
  const operacoes: Operacao[] = [];

  const visivel = (tabela: string, l: Linha) =>
    opts.dono === null || tabela !== "lojas" || l.dono_id === opts.dono;

  function from(tabela: string) {
    const q = {
      op: "select",
      patch: undefined as Linha | undefined,
      filtros: [] as Filtro[],
      unica: null as null | "single" | "maybeSingle",
      retornar: false,
      contar: false,
    };
    const b: Record<string, unknown> = {};
    const push = (col: string, op: string, val: unknown) => {
      q.filtros.push({ col, op, val });
      return b;
    };
    b.select = () => {
      if (q.op !== "select") q.retornar = true;
      return b;
    };
    for (const op of ["update", "insert", "upsert", "delete"]) {
      b[op] = (patch?: Linha, o?: { count?: string }) => {
        q.op = op;
        q.patch = op === "delete" ? undefined : patch;
        q.contar = (op === "delete" ? (patch as { count?: string } | undefined) : o)?.count === "exact";
        return b;
      };
    }
    b.eq = (c: string, v: unknown) => push(c, "eq", v);
    b.neq = (c: string, v: unknown) => push(c, "neq", v);
    b.is = (c: string, v: unknown) => push(c, "is", v);
    b.in = (c: string, v: unknown[]) => push(c, "in", v);
    b.match = (m: Linha) => {
      for (const [c, v] of Object.entries(m)) push(c, "eq", v);
      return b;
    };
    b.limit = () => b;
    b.order = () => b;
    b.single = () => {
      q.unica = "single";
      return b;
    };
    b.maybeSingle = () => {
      q.unica = "maybeSingle";
      return b;
    };
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => executar())
        .then(ok, erro);

    function executar() {
      const linhas = (tabelas[tabela] ?? []).filter(
        (l) => visivel(tabela, l) && q.filtros.every((f) => avaliar(l, f)),
      );
      if (q.op === "select") {
        operacoes.push({ tabela, op: "select", filtros: [...q.filtros], afetadas: linhas.length });
        const copia = linhas.map((l) => ({ ...l }));
        if (q.unica === "single") {
          return copia.length === 1
            ? { data: copia[0], error: null }
            : { data: null, error: { code: "PGRST116", message: "0 rows" } };
        }
        if (q.unica === "maybeSingle") return { data: copia[0] ?? null, error: null };
        return { data: copia, error: null };
      }
      if (q.op === "update") {
        const patch = q.patch ?? {};
        const depois = linhas.map((l) => ({ ...l, ...patch }));
        if (
          tabela === "lojas" &&
          depois.some((l) => l.aceita_retirada === false && l.aceita_entrega === false)
        ) {
          operacoes.push({ tabela, op: "update", patch, filtros: [...q.filtros], afetadas: 0 });
          return {
            data: null,
            error: { code: "23514", message: 'violates check constraint "lojas_ao_menos_uma_modalidade"' },
            count: null,
          };
        }
        for (const l of linhas) Object.assign(l, patch);
        operacoes.push({ tabela, op: "update", patch, filtros: [...q.filtros], afetadas: linhas.length });
        return {
          data: q.retornar ? linhas.map((l) => ({ ...l })) : null,
          error: null,
          count: q.contar ? linhas.length : null,
        };
      }
      // insert/upsert/delete: nenhuma é esperada neste fluxo — só registradas.
      operacoes.push({ tabela, op: q.op, patch: q.patch, filtros: [...q.filtros], afetadas: 0 });
      return { data: null, error: null, count: 0 };
    }
    return b;
  }

  const client = {
    from,
    auth: {
      getUser: async () => ({
        data: { user: opts.dono ? { id: opts.dono } : null },
        error: null,
      }),
    },
  };
  return { client, tabelas, operacoes };
}

// ───────────────────────────────────────────── mocks de I/O
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

let autenticado: ReturnType<typeof criarBanco>;
let servico: ReturnType<typeof criarBanco>;

const createClient = vi.fn(async () => autenticado.client);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const createServiceClient = vi.fn(() => servico.client);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => ADMIN_ID,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const COLUNAS_MODALIDADE = ["aceita_entrega", "aceita_retirada", "modo_frete"];
const TABELAS_DE_ZONA = ["zonas_entrega", "taxas_entrega", "bairros_zona"];

function lojaRow(id: string, dono: string): Linha {
  return {
    id,
    dono_id: dono,
    slug: id === LOJA_A ? "loja-a" : "loja-b",
    nome: id === LOJA_A ? "Loja A" : "Loja B",
    ativo: true,
    assinatura_status: "ativa",
    aceita_retirada: true,
    aceita_entrega: true,
    modo_frete: "automatico",
  };
}

function popular(banco: ReturnType<typeof criarBanco>) {
  banco.tabelas.lojas.push(lojaRow(LOJA_A, DONO_A), lojaRow(LOJA_B, DONO_B));
}

const loja = (banco: ReturnType<typeof criarBanco>, id: string) =>
  banco.tabelas.lojas.find((l) => l.id === id)!;

const updatesEmLojas = (banco: ReturnType<typeof criarBanco>) =>
  banco.operacoes.filter((o) => o.tabela === "lojas" && o.op === "update");

const opsEmZonas = (banco: ReturnType<typeof criarBanco>) =>
  banco.operacoes.filter((o) => TABELAS_DE_ZONA.includes(o.tabela) && o.op !== "select");

const SO_RETIRADA = { aceita_retirada: true, aceita_entrega: false, modo_frete: "automatico" };
const A_COMBINAR = { aceita_retirada: true, aceita_entrega: true, modo_frete: "a_combinar" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  autenticado = criarBanco({ dono: DONO_A });
  servico = criarBanco({ dono: null });
  popular(autenticado);
  popular(servico);
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════ lojista
describe("salvarModalidadesEntrega (lojista)", () => {
  it("é uma Server Action exportada por src/lib/actions/entrega.ts", () => {
    expect(typeof salvarModalidadesEntrega).toBe("function");
  });

  it("payload válido → UPDATE em lojas com EXATAMENTE as três colunas, na loja do dono", async () => {
    const r = await salvarModalidadesEntrega(SO_RETIRADA);

    expect(r).toEqual({ ok: true });
    const upds = updatesEmLojas(autenticado);
    expect(upds).toHaveLength(1);
    expect(upds[0].patch).toEqual(SO_RETIRADA);
    expect(upds[0].filtros).toContainEqual({ col: "id", op: "eq", val: LOJA_A });
    expect(loja(autenticado, LOJA_A)).toMatchObject(SO_RETIRADA);
    expect(loja(autenticado, LOJA_B)).toMatchObject({ aceita_entrega: true, modo_frete: "automatico" });
  });

  it("modo a combinar é gravado", async () => {
    const r = await salvarModalidadesEntrega(A_COMBINAR);
    expect(r).toEqual({ ok: true });
    expect(loja(autenticado, LOJA_A)).toMatchObject({ modo_frete: "a_combinar" });
  });

  it("retirada E entrega desligadas → recusa ANTES de qualquer I/O", async () => {
    const r = await salvarModalidadesEntrega({
      aceita_retirada: false,
      aceita_entrega: false,
      modo_frete: "automatico",
    });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    expect(autenticado.operacoes).toHaveLength(0);
  });

  it.each([
    ["modo_frete fora do enum", { aceita_retirada: true, aceita_entrega: true, modo_frete: "x" }],
    ["boolean como string", { aceita_retirada: true, aceita_entrega: "false", modo_frete: "automatico" }],
  ])("%s → recusa ANTES de qualquer I/O", async (_nome, payload) => {
    const r = await salvarModalidadesEntrega(payload);
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("chaves extras (dono_id, ativo, id, loja_id, assinatura_status) NÃO chegam ao UPDATE", async () => {
    await salvarModalidadesEntrega({
      ...SO_RETIRADA,
      dono_id: DONO_B,
      ativo: false,
      id: LOJA_B,
      loja_id: LOJA_B,
      assinatura_status: "cancelada",
    });

    // Recusar (.strict()) ou descartar (allowlist) são ambos aceitáveis; o que
    // NÃO pode é qualquer UPDATE carregar chave fora das três colunas.
    for (const u of updatesEmLojas(autenticado)) {
      expect(Object.keys(u.patch ?? {}).sort()).toEqual(COLUNAS_MODALIDADE);
      expect(u.filtros).toContainEqual({ col: "id", op: "eq", val: LOJA_A });
    }
    expect(loja(autenticado, LOJA_A)).toMatchObject({
      dono_id: DONO_A,
      ativo: true,
      assinatura_status: "ativa",
    });
    expect(loja(autenticado, LOJA_B)).toEqual(lojaRow(LOJA_B, DONO_B));
  });

  it("usa o client AUTENTICADO e a loja de buscarLojaDoDono — nunca service_role", async () => {
    await salvarModalidadesEntrega(SO_RETIRADA);
    expect(createClient).toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("zonas continuam salvas: desligar a entrega ou mudar para a combinar não toca zonas/taxas/bairros", async () => {
    await salvarModalidadesEntrega(SO_RETIRADA);
    await salvarModalidadesEntrega(A_COMBINAR);
    expect(opsEmZonas(autenticado)).toEqual([]);
  });

  it("dono sem loja → recusa sem UPDATE", async () => {
    autenticado = criarBanco({ dono: "dddddddd-dddd-dddd-dddd-dddddddddddd" });
    popular(autenticado);
    const r = await salvarModalidadesEntrega(SO_RETIRADA);
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(updatesEmLojas(autenticado).every((u) => u.afetadas === 0)).toBe(true);
  });
});

// ═════════════════════════════════════════════ admin
describe("salvarModalidadesEntregaAdmin (hub admin)", () => {
  it("é uma Server Action exportada por admin-entrega.ts", () => {
    expect(typeof salvarModalidadesEntregaAdmin).toBe("function");
  });

  it("payload válido → UPDATE em lojas escopado por id = lojaId, EXATAMENTE as três colunas", async () => {
    const r = await salvarModalidadesEntregaAdmin(LOJA_B, SO_RETIRADA);

    expect(r).toEqual({ ok: true });
    const upds = updatesEmLojas(servico);
    expect(upds).toHaveLength(1);
    expect(upds[0].patch).toEqual(SO_RETIRADA);
    expect(upds[0].filtros).toContainEqual({ col: "id", op: "eq", val: LOJA_B });
    expect(loja(servico, LOJA_B)).toMatchObject(SO_RETIRADA);
    expect(loja(servico, LOJA_A)).toMatchObject({ aceita_entrega: true, modo_frete: "automatico" });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
  });

  it("retirada E entrega desligadas → recusa sem elevar para service_role", async () => {
    const r = await salvarModalidadesEntregaAdmin(LOJA_A, {
      aceita_retirada: false,
      aceita_entrega: false,
      modo_frete: "automatico",
    });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(servico.operacoes).toHaveLength(0);
  });

  it("modo_frete fora do enum → recusa sem elevar", async () => {
    const r = await salvarModalidadesEntregaAdmin(LOJA_A, {
      aceita_retirada: true,
      aceita_entrega: true,
      modo_frete: "gratis",
    });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("lojaId não-UUID → recusa sem elevar", async () => {
    const r = await salvarModalidadesEntregaAdmin("nao-e-uuid", SO_RETIRADA);
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("admin NÃO provado → exceção PROPAGA, service_role nunca criado, zero escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(salvarModalidadesEntregaAdmin(LOJA_A, SO_RETIRADA)).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(loja(servico, LOJA_A)).toMatchObject({ aceita_entrega: true });
  });

  it("chaves extras (dono_id, ativo, id, assinatura_status) NÃO chegam ao UPDATE admin", async () => {
    await salvarModalidadesEntregaAdmin(LOJA_A, {
      ...SO_RETIRADA,
      dono_id: DONO_B,
      ativo: false,
      id: LOJA_B,
      assinatura_status: "cancelada",
    });
    // `atualizarLoja` só filtra billing/dono/id: `ativo` passaria se a action
    // espalhasse o payload. A allowlist das três colunas é o que barra.
    for (const u of updatesEmLojas(servico)) {
      expect(Object.keys(u.patch ?? {}).sort()).toEqual(COLUNAS_MODALIDADE);
      expect(u.filtros).toContainEqual({ col: "id", op: "eq", val: LOJA_A });
    }
    expect(loja(servico, LOJA_A)).toMatchObject({ dono_id: DONO_A, ativo: true, assinatura_status: "ativa" });
    expect(loja(servico, LOJA_B)).toEqual(lojaRow(LOJA_B, DONO_B));
  });

  it("zonas continuam salvas: não toca zonas/taxas/bairros", async () => {
    await salvarModalidadesEntregaAdmin(LOJA_A, SO_RETIRADA);
    await salvarModalidadesEntregaAdmin(LOJA_A, A_COMBINAR);
    expect(opsEmZonas(servico)).toEqual([]);
  });
});
