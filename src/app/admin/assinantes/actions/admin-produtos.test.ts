import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 089 (crítica: SIM). Variantes ADMIN do CRUD de produtos
 * em `./admin-produtos`. As actions são STUBs (`throw 'TODO: GREEN'`), então TODA
 * expectativa de comportamento abaixo FALHA hoje — esse é o RED comprovado. A
 * implementação real é da fase GREEN (executar).
 *
 * Diferença do CRUD do lojista (src/lib/actions/produto.ts): aqui o admin do SaaS
 * escreve na LOJA-ALVO (`lojaId` da URL admin), via service_role
 * (createServiceClient), provando admin com verificarAdminSaaS() ANTES de elevar.
 * O isolamento NÃO vem de RLS por dono — vem do escopo explícito `eq("loja_id",
 * lojaId)` em toda escrita, e de validar a posse da categoria sob `lojaId`.
 *
 * Invariantes provadas (issue 089 + spec admin-onboarding-assistido.md RN-1/2/3/6):
 *  1. preço negativo → reprovado por schemaProduto, SEM tocar no banco;
 *  2. categoria_id de OUTRA loja → rejeitado (SELECT de posse escopado por lojaId
 *     não acha) ANTES de gravar;
 *  3. CROSS-LOJA: UPDATE/DELETE/toggle escopados por eq("loja_id", lojaId) — produto
 *     de outra loja não é alcançado;
 *  4. admin não provado (verificarAdminSaaS lança) → exceção PROPAGA, zero efeito;
 *  5. sucesso: grava `preco` (RN-6, valor do payload validado server-side) e demais
 *     campos; `loja_id` = `lojaId` da URL, NUNCA do payload.
 *
 * Padrão de mock do client encadeável: espelha produto.test.ts. O client RAIZ
 * (retornado por createServiceClient) NÃO é thenável; só a cadeia de `.from(...)`
 * termina numa Promise, resolvida POR TABELA (`respostaPorTabela`). Captura cada
 * operação numa `Op` com filtros (`eq`/`in`), insert/update/delete.
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja alheia
const CAT_PROPRIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // categoria da loja-alvo
const CAT_ALHEIA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // categoria de outra loja

// ── Captura do que cada operação manda ao banco, por TABELA tocada. ───────────
type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleted?: boolean;
  selected?: boolean;
  upserted?: Record<string, unknown>[];
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta simulada do terminador da cadeia, escolhida pela TABELA.
// Default: SELECT em `categorias` devolve a categoria própria; escrita ok.
let respostaPorTabela: Record<string, { data: unknown; error: unknown }>;

function makeChain() {
  const client: Record<string, unknown> = {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const queryChain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        queryChain[k] = (...args: unknown[]) => {
          if (k === "eq") op.filtros.push([args[0] as string, args[1]]);
          if (k === "in") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select") op.selected = true;
          return queryChain;
        };
      };
      ["select", "eq", "in", "single", "maybeSingle", "limit", "order"].forEach(
        passthrough,
      );
      queryChain.insert = (row: Record<string, unknown>) => {
        op.insert = row;
        return queryChain;
      };
      queryChain.update = (row: Record<string, unknown>) => {
        op.update = row;
        return queryChain;
      };
      queryChain.upsert = (rows: Record<string, unknown>[]) => {
        op.upserted = rows;
        return queryChain;
      };
      queryChain.delete = () => {
        op.deleted = true;
        return queryChain;
      };
      // Só a cadeia da query é thenável → resolve a resposta da SUA tabela.
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(
          respostaPorTabela[tabela] ?? { data: null, error: null },
        ).then(onF);
      return queryChain;
    },
  };
  return client;
}

// service_role: ESTE é o client das actions admin (escrita escopada por lojaId).
const servico = makeChain();
const createServiceClient = vi.fn(() => servico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Prova de admin. Default passa; teste de negação faz mockRejectedValueOnce.
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// 'use server' é só diretiva; o módulo é importável no runner node. As actions
// admin são STUBs (throw 'TODO: GREEN') → RED na asserção de comportamento.
import {
  criarProdutoAdmin,
  atualizarProdutoAdmin,
  removerProdutoAdmin,
  alternarDisponibilidadeAdmin,
  reordenarProdutosAdmin,
} from "./admin-produtos";

function payloadProduto(over: Record<string, unknown> = {}) {
  return {
    nome: "X-Burger",
    descricao: "delícia",
    preco: 25.9,
    categoria_id: null,
    disponivel: true,
    // Issue 085: schemaProduto (compartilhado com o CRUD do lojista) passa a
    // exigir `oculto` (boolean). Incluído na base para manter os payloads dos
    // testes admin válidos sob o schema mais estrito.
    oculto: false,
    ordem: 0,
    ...over,
  };
}

// helper: a Op de escrita numa tabela (insert OU update OU delete OU upsert).
function opEscrita(tabela: string): Op | undefined {
  return ops.find(
    (o) =>
      o.tabela === tabela && (o.insert || o.update || o.deleted || o.upserted),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaPorTabela = {
    // SELECT de posse: por padrão a categoria informada é da LOJA-ALVO.
    categorias: { data: { id: CAT_PROPRIA, loja_id: LOJA_ALVO }, error: null },
    produtos: { data: { id: "produto-novo" }, error: null },
  };
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ───────────────────────────── criarProdutoAdmin ────────────────────────────
describe("criarProdutoAdmin (Server Action — admin SaaS)", () => {
  it("caso 5 — caminho feliz: valida + insere via service_role escopado na loja-alvo → { ok:true }", async () => {
    const r = await criarProdutoAdmin(LOJA_ALVO, payloadProduto());
    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("produtos")?.insert).toBeDefined();
  });

  it("caso 5 — RN-6: grava `preco` do payload validado server-side", async () => {
    await criarProdutoAdmin(LOJA_ALVO, payloadProduto({ preco: 42.5 }));
    expect(opEscrita("produtos")?.insert?.preco).toBe(42.5);
  });

  it("caso 5 — loja_id = lojaId da URL, NUNCA do payload", async () => {
    await criarProdutoAdmin(LOJA_ALVO, {
      ...payloadProduto(),
      loja_id: LOJA_OUTRA,
    });
    expect(opEscrita("produtos")?.insert?.loja_id).toBe(LOJA_ALVO);
    expect(opEscrita("produtos")?.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("caso 1 — ATAQUE: preço negativo reprovado SEM tocar no banco (schemaProduto)", async () => {
    const r = await criarProdutoAdmin(LOJA_ALVO, payloadProduto({ preco: -1 }));
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("caso 2 — categoria_id da PRÓPRIA loja-alvo é aceito e persiste no insert", async () => {
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadProduto({ categoria_id: CAT_PROPRIA }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.insert?.categoria_id).toBe(CAT_PROPRIA);
    // A posse foi checada com SELECT em categorias escopado por loja_id = lojaId.
    const selCat = ops.find((o) => o.tabela === "categorias" && o.selected);
    expect(selCat?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("caso 2 — ATAQUE: categoria_id de OUTRA loja é REJEITADO sem inserir o produto", async () => {
    // SELECT de posse escopado por lojaId não acha a categoria alheia.
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadProduto({ categoria_id: CAT_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("caso 4 — fail-closed: verificarAdminSaaS lança → PROPAGA e NÃO toca service/insert", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      criarProdutoAdmin(LOJA_ALVO, payloadProduto()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("produtos")).toBeUndefined();
  });
});

// ──────────────────────────── atualizarProdutoAdmin ─────────────────────────
describe("atualizarProdutoAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: UPDATE escopado por id E loja_id (não alcança produto de outra loja)", async () => {
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      "produto-1",
      payloadProduto({ preco: 30 }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update).toBeDefined();
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("caso 5 — update NÃO troca loja_id para outra loja", async () => {
    await atualizarProdutoAdmin(LOJA_ALVO, "produto-1", {
      ...payloadProduto(),
      loja_id: LOJA_OUTRA,
    });
    const upd = opEscrita("produtos")?.update;
    if (upd && "loja_id" in upd) expect(upd.loja_id).toBe(LOJA_ALVO);
    expect(upd?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("caso 1 — ATAQUE: preço negativo no update reprovado SEM tocar no banco", async () => {
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      "produto-1",
      payloadProduto({ preco: -5 }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("caso 2 — ATAQUE: trocar para categoria_id de OUTRA loja é rejeitado no update", async () => {
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      "produto-1",
      payloadProduto({ categoria_id: CAT_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      atualizarProdutoAdmin(LOJA_ALVO, "produto-1", payloadProduto()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("produtos")).toBeUndefined();
  });
});

// ──────────────────────────── removerProdutoAdmin ───────────────────────────
describe("removerProdutoAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: DELETE escopado por id E loja_id", async () => {
    const r = await removerProdutoAdmin(LOJA_ALVO, "produto-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.deleted).toBe(true);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, nada deletado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      removerProdutoAdmin(LOJA_ALVO, "produto-1"),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("produtos")).toBeUndefined();
  });
});

// ────────────────────── alternarDisponibilidadeAdmin ────────────────────────
describe("alternarDisponibilidadeAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: UPDATE do flag escopado por id E loja_id", async () => {
    const r = await alternarDisponibilidadeAdmin(LOJA_ALVO, "produto-1", false);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update?.disponivel).toBe(false);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["id", "produto-1"]);
    expect(opEscrita("produtos")?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, sem efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      alternarDisponibilidadeAdmin(LOJA_ALVO, "produto-1", true),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("produtos")).toBeUndefined();
  });
});

// ──────────────────────────── reordenarProdutosAdmin ────────────────────────
describe("reordenarProdutosAdmin (Server Action — admin SaaS)", () => {
  it("caso 5 — reordena escopado na loja-alvo via service_role → { ok:true }", async () => {
    const r = await reordenarProdutosAdmin(LOJA_ALVO, [
      { id: "produto-1", ordem: 0 },
      { id: "produto-2", ordem: 1 },
    ]);
    expect(r).toEqual({ ok: true });
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("produtos")).toBeDefined();
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, sem efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      reordenarProdutosAdmin(LOJA_ALVO, [{ id: "produto-1", ordem: 0 }]),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("CROSS-LOJA: cada UPDATE de reordenação é escopado por eq('loja_id', lojaAlvo) E eq('id', produtoId)", async () => {
    // Sem esse escopo, reordenarProdutosAdmin poderia alterar a ordem de produtos
    // de qualquer loja — sob service_role, RLS não protege.
    await reordenarProdutosAdmin(LOJA_ALVO, [
      { id: "produto-1", ordem: 0 },
      { id: "produto-2", ordem: 1 },
    ]);

    const escritas = ops.filter(
      (o) => o.tabela === "produtos" && o.update !== undefined,
    );
    expect(escritas.length).toBe(2);
    // TODA linha de reordenação deve carregar o escopo da loja-alvo.
    for (const op of escritas) {
      expect(op.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    }
    // Os ids de produto corretos devem estar presentes.
    expect(escritas[0].filtros).toContainEqual(["id", "produto-1"]);
    expect(escritas[1].filtros).toContainEqual(["id", "produto-2"]);
  });
});
