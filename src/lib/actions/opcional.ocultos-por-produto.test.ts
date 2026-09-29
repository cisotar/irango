import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 331 — fatia F2: as Server Actions EM LOTE que
 * ocultam/exibem um grupo de opcionais por produto (plan/loop-ocultar-opcionais-
 * por-produto.md, "Desenho", camada 2):
 *
 *   salvarOcultacoesOpcionais(alteracoes)              — lojista, `opcional.ts`
 *   salvarOcultacoesOpcionaisAdmin(lojaId, alteracoes) — admin, `admin-opcionais.ts`
 *
 *   alteracoes: { produtoId, categoriaOpcionalId, oculto: boolean }[]
 *   zod `.strict()`, de 1 a 200 itens.
 *   Execução: UM upsert (`ignoreDuplicates`) para os `oculto:true`, DEPOIS o
 *   delete dos `oculto:false`. O upsert falha INTEIRO se houver um par de outra
 *   loja (FK composta — F1) e aí o delete NÃO roda.
 *
 * ── O banco falso deste arquivo
 * Em vez de só gravar QUE métodos foram chamados, o client falso EXECUTA a
 * cadeia sobre uma tabela em memória `produto_opcionais_ocultos`, com as mesmas
 * travas que a migration terá (provadas em SQL real em
 * `tests/migrations/produto_opcionais_ocultos.test.ts`):
 *  - FK composta: produto/grupo de outra loja → 23503, lote INTEIRO recusado;
 *  - UNIQUE (produto, grupo): duplicata sem `ignoreDuplicates` → 23505;
 *  - RLS do lojista: só enxerga/escreve linhas da própria loja (o client de
 *    `service_role` do admin NÃO tem isso — o escopo tem de vir do filtro).
 * Assim "0 linhas", "mesmo estado" e "delete só dos pares pedidos" são
 * afirmados sobre o ESTADO, não sobre a forma da chamada. O delete aceita os
 * filtros `eq`, `in`, `match` e `or("and(col.eq.v,col.eq.v),...")`.
 *
 * Nenhum código de produção aqui. As duas actions ainda não existem: cada caso
 * falha na asserção "não exportada" até a fase GREEN.
 */

const LOJA_A = "11111111-1111-4111-8111-111111111111"; // loja do dono logado / loja-alvo do admin
const LOJA_B = "22222222-2222-4222-8222-222222222222"; // loja alheia
const SLUG_A = "lanches-base";

const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const P3 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const G1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const G2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const PB = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"; // produto da LOJA B
const GB = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2"; // grupo da LOJA B

const TABELA = "produto_opcionais_ocultos";

/** Dono de cada id — é o que a FK composta `(id, loja_id)` confere. */
const LOJA_DO_ID: Record<string, string> = {
  [P1]: LOJA_A,
  [P2]: LOJA_A,
  [P3]: LOJA_A,
  [G1]: LOJA_A,
  [G2]: LOJA_A,
  [PB]: LOJA_B,
  [GB]: LOJA_B,
};

type Linha = { loja_id: string; produto_id: string; categoria_opcional_id: string };
type Chamada = [string, ...unknown[]];
type Op = { tabela: string; chamadas: Chamada[] };
type Erro = { code: string; message: string };

let tabela: Linha[];
let ops: Op[];
let falhaDelete: Erro | null;

const chave = (l: Pick<Linha, "produto_id" | "categoria_opcional_id">) =>
  `${l.produto_id}|${l.categoria_opcional_id}`;

function estado(): string[] {
  return tabela.map((l) => `${l.loja_id}|${chave(l)}`).sort();
}

// ── avaliação dos filtros do DELETE ────────────────────────────────────────

function dividirTopo(s: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of s) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual) partes.push(atual);
  return partes.map((p) => p.trim());
}

function termoOr(termo: string): (l: Linha) => boolean {
  const and = termo.match(/^and\((.*)\)$/);
  if (and) {
    const subs = dividirTopo(and[1]).map(termoOr);
    return (l) => subs.every((f) => f(l));
  }
  const m = termo.match(/^([a-z_]+)\.(eq|in)\.(.*)$/);
  if (!m) throw new Error(`[teste] termo de or() não suportado: ${termo}`);
  const [, col, opr, val] = m;
  if (opr === "eq") return (l) => (l as Record<string, string>)[col] === val;
  const lista = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/"/g, "").trim());
  return (l) => lista.includes((l as Record<string, string>)[col]);
}

function predicadoDoDelete(chamadas: Chamada[]): (l: Linha) => boolean {
  const filtros: Array<(l: Linha) => boolean> = [];
  let depoisDoDelete = false;
  for (const [metodo, ...args] of chamadas) {
    if (metodo === "delete") {
      depoisDoDelete = true;
      continue;
    }
    if (!depoisDoDelete || metodo === "select") continue;
    const col = args[0] as string;
    if (metodo === "eq") filtros.push((l) => (l as Record<string, unknown>)[col] === args[1]);
    else if (metodo === "in")
      filtros.push((l) => (args[1] as unknown[]).includes((l as Record<string, unknown>)[col]));
    else if (metodo === "match") {
      const obj = args[0] as Record<string, unknown>;
      filtros.push((l) => Object.entries(obj).every(([k, v]) => (l as Record<string, unknown>)[k] === v));
    } else if (metodo === "or") filtros.push(filtroOr(col));
    else throw new Error(`[teste] filtro de delete não suportado: ${metodo}`);
  }
  return (l) => filtros.every((f) => f(l));
}

// `or(...)` é um OU de termos no topo: reescrito aqui sem truques.
function filtroOr(expr: string): (l: Linha) => boolean {
  const termos = dividirTopo(expr).map(termoOr);
  return (l) => termos.some((f) => f(l));
}

// ── execução de uma cadeia sobre a tabela em memória ───────────────────────

function executar(op: Op, rls: string | null): { data: unknown; error: Erro | null; count?: number } {
  const verbo = op.chamadas.find(([m]) =>
    ["upsert", "insert", "delete", "update"].includes(m),
  );
  if (op.tabela !== TABELA || verbo == null) return { data: null, error: null };

  const [metodo, a1, a2] = verbo;
  if (metodo === "upsert" || metodo === "insert") {
    const linhas = (Array.isArray(a1) ? a1 : [a1]) as Linha[];
    const opcoes = (a2 ?? {}) as { onConflict?: string; ignoreDuplicates?: boolean };
    const novas: Linha[] = [];
    for (const l of linhas) {
      if (rls != null && l.loja_id !== rls) {
        return {
          data: null,
          error: {
            code: "42501",
            message: `new row violates row-level security policy for table "${TABELA}"`,
          },
        };
      }
      if (LOJA_DO_ID[l.produto_id] !== l.loja_id) {
        return {
          data: null,
          error: {
            code: "23503",
            message: `insert or update on table "${TABELA}" violates foreign key constraint "produto_opcionais_ocultos_produto_fk"`,
          },
        };
      }
      if (LOJA_DO_ID[l.categoria_opcional_id] !== l.loja_id) {
        return {
          data: null,
          error: {
            code: "23503",
            message: `insert or update on table "${TABELA}" violates foreign key constraint "produto_opcionais_ocultos_grupo_fk"`,
          },
        };
      }
      const existe =
        tabela.some((t) => chave(t) === chave(l)) || novas.some((t) => chave(t) === chave(l));
      if (existe) {
        const ignora =
          metodo === "upsert" &&
          opcoes.ignoreDuplicates === true &&
          (opcoes.onConflict ?? "").replace(/\s/g, "") === "produto_id,categoria_opcional_id";
        if (!ignora) {
          return {
            data: null,
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint "${TABELA}_produto_id_categoria_opcional_id_key"`,
            },
          };
        }
        continue;
      }
      novas.push({
        loja_id: l.loja_id,
        produto_id: l.produto_id,
        categoria_opcional_id: l.categoria_opcional_id,
      });
    }
    tabela.push(...novas); // atômico: só aplica se NENHUMA linha falhou
    return { data: null, error: null };
  }
  if (metodo === "delete") {
    if (falhaDelete) return { data: null, error: falhaDelete };
    const casa = predicadoDoDelete(op.chamadas);
    const alvo = (l: Linha) => (rls == null || l.loja_id === rls) && casa(l);
    const antes = tabela.length;
    tabela = tabela.filter((l) => !alvo(l));
    return { data: null, error: null, count: antes - tabela.length };
  }
  // UPDATE: a tabela não tem grant nem policy de UPDATE (F1-16).
  return {
    data: null,
    error: { code: "42501", message: `permission denied for table ${TABELA}` },
  };
}

function criarClient(rls: string | null) {
  return {
    from(nome: string) {
      const op: Op = { tabela: nome, chamadas: [] };
      ops.push(op);
      const cadeia: unknown = new Proxy(
        {},
        {
          get(_alvo, prop) {
            if (prop === "then") {
              return (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
                Promise.resolve()
                  .then(() => executar(op, rls))
                  .then(onF, onR);
            }
            return (...args: unknown[]) => {
              op.chamadas.push([String(prop), ...args]);
              return cadeia;
            };
          },
        },
      );
      return cadeia;
    },
    rpc: vi.fn(async () => ({ data: null, error: { code: "XX000", message: "rpc inesperada" } })),
  };
}

// ── mocks de módulo ─────────────────────────────────────────────────────────

// Lojista: client AUTENTICADO, sob a RLS da loja A.
const clienteLojista = criarClient(LOJA_A);
const createClient = vi.fn(async () => clienteLojista);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

// Admin: service_role (BYPASSRLS) — nenhum escopo implícito.
const clienteServico = criarClient(null);
const createServiceClient = vi.fn(() => clienteServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

const registrarAcessoAdmin = vi.fn();
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: (...a: unknown[]) => registrarAcessoAdmin(...a) };
});

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import * as modLojista from "./opcional";
import * as modAdmin from "@/app/admin/assinantes/actions/admin-opcionais";

type Resultado = { ok: true } | { ok: false; erro: string };
type Alteracao = { produtoId: string; categoriaOpcionalId: string; oculto: boolean };

/** Acesso tolerante: o símbolo ainda não existe (RED por asserção, não por import). */
async function salvarOcultacoesOpcionais(alteracoes: unknown): Promise<Resultado> {
  const fn = (modLojista as unknown as Record<string, unknown>).salvarOcultacoesOpcionais;
  expect(typeof fn, "salvarOcultacoesOpcionais não é exportada de src/lib/actions/opcional.ts").toBe(
    "function",
  );
  return (fn as (a: unknown) => Promise<Resultado>)(alteracoes);
}
async function salvarOcultacoesOpcionaisAdmin(lojaId: unknown, alteracoes: unknown): Promise<Resultado> {
  const fn = (modAdmin as unknown as Record<string, unknown>).salvarOcultacoesOpcionaisAdmin;
  expect(
    typeof fn,
    "salvarOcultacoesOpcionaisAdmin não é exportada de src/app/admin/assinantes/actions/admin-opcionais.ts",
  ).toBe("function");
  return (fn as (l: unknown, a: unknown) => Promise<Resultado>)(lojaId, alteracoes);
}

const alt = (produtoId: string, categoriaOpcionalId: string, oculto: boolean): Alteracao => ({
  produtoId,
  categoriaOpcionalId,
  oculto,
});

function escritas(): Op[] {
  return ops.filter((o) =>
    o.chamadas.some(([m]) => ["upsert", "insert", "delete", "update"].includes(m)),
  );
}
function opsCom(verbo: string): Op[] {
  return ops.filter((o) => o.tabela === TABELA && o.chamadas.some(([m]) => m === verbo));
}

function semRuido<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return fn().finally(() => spy.mockRestore());
}

/** Nenhum detalhe de banco vaza na mensagem (seguranca.md §14). */
function expectErroGenerico(r: Resultado) {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.erro).toBeTruthy();
  expect(r.erro).not.toMatch(/23503|23505|42501|foreign key|produto_opcionais_ocultos|violates/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  falhaDelete = null;
  // Estado inicial: A já tem (P3,G1) oculto; B tem (PB,GB) oculto.
  tabela = [
    { loja_id: LOJA_A, produto_id: P3, categoria_opcional_id: G1 },
    { loja_id: LOJA_B, produto_id: PB, categoria_opcional_id: GB },
  ];
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_A, slug: SLUG_A });
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════ LOJISTA — salvarOcultacoesOpcionais

describe("331 F2 · salvarOcultacoesOpcionais (lojista) — caminho feliz", () => {
  it("oculto:true grava a linha com loja_id DERIVADO de buscarLojaDoDono", async () => {
    const r = await salvarOcultacoesOpcionais([alt(P1, G1, true)]);
    expect(r).toEqual({ ok: true });
    expect(estado()).toContain(`${LOJA_A}|${P1}|${G1}`);
    // Nunca service_role no caminho do lojista.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("o upsert é UM comando, com onConflict (produto_id,categoria_opcional_id) e ignoreDuplicates", async () => {
    await salvarOcultacoesOpcionais([alt(P1, G1, true), alt(P2, G2, true)]);
    const upserts = opsCom("upsert");
    expect(upserts).toHaveLength(1);
    const [, linhas, opcoes] = upserts[0].chamadas.find(([m]) => m === "upsert")!;
    expect(linhas).toHaveLength(2);
    expect(opcoes).toMatchObject({ ignoreDuplicates: true });
    expect(String((opcoes as { onConflict?: string }).onConflict).replace(/\s/g, "")).toBe(
      "produto_id,categoria_opcional_id",
    );
  });

  it("oculto:false apaga SÓ o par pedido (volta a exibir)", async () => {
    const r = await salvarOcultacoesOpcionais([alt(P3, G1, false)]);
    expect(r).toEqual({ ok: true });
    expect(estado()).toEqual([`${LOJA_B}|${PB}|${GB}`]);
  });

  it("delete por PARES exatos, nunca pelo produto cartesiano (P2,G2)+(P3,G1) não leva (P2,G1) nem (P3,G2)", async () => {
    tabela.push(
      { loja_id: LOJA_A, produto_id: P2, categoria_opcional_id: G2 },
      { loja_id: LOJA_A, produto_id: P2, categoria_opcional_id: G1 },
      { loja_id: LOJA_A, produto_id: P3, categoria_opcional_id: G2 },
    );
    const r = await salvarOcultacoesOpcionais([alt(P2, G2, false), alt(P3, G1, false)]);
    expect(r).toEqual({ ok: true });
    expect(estado()).toEqual(
      [
        `${LOJA_A}|${P2}|${G1}`,
        `${LOJA_A}|${P3}|${G2}`,
        `${LOJA_B}|${PB}|${GB}`,
      ].sort(),
    );
  });

  it("lote misto: upsert dos true ANTES do delete dos false", async () => {
    const r = await salvarOcultacoesOpcionais([alt(P1, G2, true), alt(P3, G1, false)]);
    expect(r).toEqual({ ok: true });
    const iUpsert = ops.findIndex((o) => o.chamadas.some(([m]) => m === "upsert"));
    const iDelete = ops.findIndex((o) => o.chamadas.some(([m]) => m === "delete"));
    expect(iUpsert).toBeGreaterThanOrEqual(0);
    expect(iDelete).toBeGreaterThan(iUpsert);
    expect(estado()).toEqual([`${LOJA_A}|${P1}|${G2}`, `${LOJA_B}|${PB}|${GB}`].sort());
  });

  it("lote SÓ de oculto:true não emite DELETE nenhum (delete sem par apagaria a loja inteira)", async () => {
    await salvarOcultacoesOpcionais([alt(P1, G1, true)]);
    expect(opsCom("delete")).toHaveLength(0);
    expect(estado()).toContain(`${LOJA_A}|${P3}|${G1}`);
  });

  it("lote SÓ de oculto:false não emite UPSERT", async () => {
    await salvarOcultacoesOpcionais([alt(P3, G1, false)]);
    expect(opsCom("upsert")).toHaveLength(0);
  });

  it("lote repetido → mesmo estado e {ok:true} nas duas vezes (idempotente)", async () => {
    const lote = [alt(P1, G1, true), alt(P3, G1, false)];
    const r1 = await salvarOcultacoesOpcionais(lote);
    const depois1 = estado();
    const r2 = await salvarOcultacoesOpcionais(lote);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(estado()).toEqual(depois1);
  });

  it("reocultar um par JÁ oculto não é erro (ignoreDuplicates)", async () => {
    const r = await salvarOcultacoesOpcionais([alt(P3, G1, true)]);
    expect(r).toEqual({ ok: true });
    expect(estado().filter((e) => e.endsWith(`${P3}|${G1}`))).toHaveLength(1);
  });

  it("sucesso revalida as duas rotas do painel que mostram as pílulas", async () => {
    await salvarOcultacoesOpcionais([alt(P1, G1, true)]);
    const caminhos = revalidatePath.mock.calls.map((c) => c[0]);
    expect(caminhos).toContain("/painel/produtos");
    expect(caminhos).toContain("/painel/produtos/opcionais");
  });

  it("única tabela escrita: produto_opcionais_ocultos", async () => {
    await salvarOcultacoesOpcionais([alt(P1, G1, true), alt(P3, G1, false)]);
    expect(escritas().every((o) => o.tabela === TABELA)).toBe(true);
    expect(escritas().length).toBeGreaterThan(0);
  });
});

describe("331 F2 · salvarOcultacoesOpcionais (lojista) — cross-tenant e falhas", () => {
  it("lote com 1 par ALHEIO (produto de B) entre válidos → {ok:false}, 0 linhas gravadas, delete NÃO roda", async () => {
    const antes = estado();
    const r = await semRuido(() =>
      salvarOcultacoesOpcionais([
        alt(P1, G1, true),
        alt(PB, G1, true),
        alt(P2, G2, true),
        alt(P3, G1, false),
      ]),
    );
    expectErroGenerico(r);
    expect(estado()).toEqual(antes); // nem os válidos, nem o delete de (P3,G1)
    expect(opsCom("delete")).toHaveLength(0);
  });

  it("lote com GRUPO alheio → {ok:false} e 0 linhas", async () => {
    const antes = estado();
    const r = await semRuido(() => salvarOcultacoesOpcionais([alt(P1, G1, true), alt(P2, GB, true)]));
    expectErroGenerico(r);
    expect(estado()).toEqual(antes);
  });

  it("oculto:false de um par ALHEIO não apaga a linha da loja B", async () => {
    await semRuido(() => salvarOcultacoesOpcionais([alt(PB, GB, false)]));
    expect(estado()).toContain(`${LOJA_B}|${PB}|${GB}`);
  });

  it("falha no DELETE (depois do upsert) → {ok:false} genérico e revalida (o upsert já valeu)", async () => {
    falhaDelete = { code: "XX000", message: "falha simulada de banco" };
    const r = await semRuido(() => salvarOcultacoesOpcionais([alt(P1, G1, true), alt(P3, G1, false)]));
    expectErroGenerico(r);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("loja não encontrada → {ok:false}, nenhuma escrita", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(null);
    const r = await semRuido(() => salvarOcultacoesOpcionais([alt(P1, G1, true)]));
    expect(r.ok).toBe(false);
    expect(escritas()).toHaveLength(0);
  });
});

describe("331 F2 · salvarOcultacoesOpcionais (lojista) — zod ANTES de qualquer I/O", () => {
  const recusaSemIO = async (payload: unknown) => {
    const r = await semRuido(() => salvarOcultacoesOpcionais(payload));
    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  };

  it("lote vazio → recusado", async () => {
    await recusaSemIO([]);
  });

  it("201 itens → recusado (teto 200)", async () => {
    const lote = Array.from({ length: 201 }, () => alt(P1, G1, true));
    await recusaSemIO(lote);
  });

  it("200 itens → aceito (borda do teto)", async () => {
    const lote = Array.from({ length: 200 }, () => alt(P1, G1, true));
    const r = await salvarOcultacoesOpcionais(lote);
    expect(r).toEqual({ ok: true });
  });

  it("campo extra no item (loja_id forjado) → recusado pelo .strict()", async () => {
    await recusaSemIO([{ ...alt(P1, G1, true), loja_id: LOJA_B }]);
  });

  it("campo extra no item (qualquer) → recusado pelo .strict()", async () => {
    await recusaSemIO([{ ...alt(P1, G1, true), preco: 0 }]);
  });

  it("id que não é uuid → recusado", async () => {
    await recusaSemIO([alt("nao-e-uuid", G1, true)]);
  });

  it("`oculto` não booleano → recusado", async () => {
    await recusaSemIO([{ produtoId: P1, categoriaOpcionalId: G1, oculto: "true" }]);
  });

  it("payload que não é array → recusado", async () => {
    await recusaSemIO({ produtoId: P1, categoriaOpcionalId: G1, oculto: true });
  });
});

// ═════════════════════════════════════════════ ADMIN — salvarOcultacoesOpcionaisAdmin

describe("331 F2 · salvarOcultacoesOpcionaisAdmin — autorização e escopo por lojaId", () => {
  it("admin NÃO provado → exceção PROPAGA; service_role nunca criado; nenhuma escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    const fn = (modAdmin as unknown as Record<string, unknown>).salvarOcultacoesOpcionaisAdmin;
    expect(typeof fn, "salvarOcultacoesOpcionaisAdmin não exportada").toBe("function");
    await expect(
      (fn as (l: string, a: unknown) => Promise<Resultado>)(LOJA_A, [alt(P1, G1, true)]),
    ).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(escritas()).toHaveLength(0);
  });

  it("lojaId inválido → {ok:false} antes de provar admin", async () => {
    const r = await semRuido(() => salvarOcultacoesOpcionaisAdmin("nao-e-uuid", [alt(P1, G1, true)]));
    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("payload inválido (201 itens / campo extra) → {ok:false} antes de provar admin", async () => {
    const r1 = await semRuido(() =>
      salvarOcultacoesOpcionaisAdmin(LOJA_A, Array.from({ length: 201 }, () => alt(P1, G1, true))),
    );
    const r2 = await semRuido(() =>
      salvarOcultacoesOpcionaisAdmin(LOJA_A, [{ ...alt(P1, G1, true), extra: 1 }]),
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("caminho feliz: grava na LOJA-ALVO (loja_id da URL), registra o acesso e revalida o hub", async () => {
    const r = await salvarOcultacoesOpcionaisAdmin(LOJA_A, [alt(P1, G1, true), alt(P3, G1, false)]);
    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(estado()).toEqual([`${LOJA_A}|${P1}|${G1}`, `${LOJA_B}|${PB}|${GB}`].sort());
    expect(registrarAcessoAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lojaId: LOJA_A, acao: expect.any(String) }),
    );
    expect(revalidatePath.mock.calls.map((c) => c[0])).toContain(`/admin/assinantes/${LOJA_A}`);
  });

  it("lote com 1 par ALHEIO entre válidos → {ok:false}, 0 linhas, delete não roda (FK vale sob service_role)", async () => {
    const antes = estado();
    const r = await semRuido(() =>
      salvarOcultacoesOpcionaisAdmin(LOJA_A, [
        alt(P1, G1, true),
        alt(PB, GB, true),
        alt(P3, G1, false),
      ]),
    );
    expectErroGenerico(r);
    expect(estado()).toEqual(antes);
    expect(opsCom("delete")).toHaveLength(0);
  });

  it("service_role NÃO tem RLS: o delete de par alheio precisa do escopo loja_id — a linha de B sobrevive", async () => {
    await semRuido(() => salvarOcultacoesOpcionaisAdmin(LOJA_A, [alt(PB, GB, false)]));
    expect(estado()).toContain(`${LOJA_B}|${PB}|${GB}`);
  });

  it("todo DELETE do admin carrega eq('loja_id', lojaId)", async () => {
    await salvarOcultacoesOpcionaisAdmin(LOJA_A, [alt(P3, G1, false)]);
    const deletes = opsCom("delete");
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.chamadas).toContainEqual(["eq", "loja_id", LOJA_A]);
    }
  });

  it("lote SÓ de oculto:true não emite DELETE nenhum", async () => {
    await salvarOcultacoesOpcionaisAdmin(LOJA_A, [alt(P1, G1, true)]);
    expect(opsCom("delete")).toHaveLength(0);
  });

  it("lote repetido → mesmo estado", async () => {
    const lote = [alt(P1, G2, true), alt(P3, G1, false)];
    await salvarOcultacoesOpcionaisAdmin(LOJA_A, lote);
    const depois1 = estado();
    const r2 = await salvarOcultacoesOpcionaisAdmin(LOJA_A, lote);
    expect(r2).toEqual({ ok: true });
    expect(estado()).toEqual(depois1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 331, F2:
 *
 *  src/lib/actions/opcional.ts
 *    export async function salvarOcultacoesOpcionais(alteracoes: unknown): Promise<ResultadoOpcional>
 *  src/app/admin/assinantes/actions/admin-opcionais.ts
 *    export async function salvarOcultacoesOpcionaisAdmin(lojaId: string, alteracoes: unknown): Promise<Resultado>
 *
 *  - schema zod (em lib/validacoes/opcional.ts): array de 1..200 de
 *    { produtoId: uuid, categoriaOpcionalId: uuid, oculto: boolean }.strict();
 *    parse ANTES de qualquer I/O (e, no admin, antes de verificarAdminSaaS).
 *  - loja_id: lojista → buscarLojaDoDono; admin → lojaId da URL (escopo.inserirVarios).
 *  - UM upsert em `produto_opcionais_ocultos` com
 *    { onConflict: "produto_id,categoria_opcional_id", ignoreDuplicates: true }
 *    só se houver oculto:true; erro → {ok:false} genérico e PARA (delete não roda).
 *  - delete dos oculto:false só se houver algum, por PARES exatos
 *    (filtros aceitos pelo teste: eq / in / match / or("and(...),and(...)")),
 *    e no admin SEMPRE com .eq("loja_id", lojaId). Erro → {ok:false} + revalida.
 *  - Sem pre-check de posse (TOCTOU): a FK composta é a trava.
 *  - Revalida "/painel/produtos" e "/painel/produtos/opcionais" (lojista) /
 *    revalidarLojaAdmin + registrarAcessoAdmin (admin).
 *  - Mensagem genérica: nunca 23503/constraint/tabela no `erro`.
 */
