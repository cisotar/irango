import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 135 (crítica: SIM). As 8 variantes ADMIN do CRUD de
 * opcionais (biblioteca + associação) em `./admin-opcionais`. As actions são STUBs
 * (`throw "TODO: GREEN"`), então TODA expectativa de comportamento abaixo FALHA
 * hoje — RED comprovado. A implementação real é da fase GREEN (executar).
 *
 * Diferença do CRUD do lojista (src/lib/actions/opcional.ts): aqui o admin do SaaS
 * escreve na LOJA-ALVO (`lojaId` da URL admin), via service_role escopado pelo
 * wrapper `escopo` de admin-loja.ts (injeta `eq("loja_id", lojaId)`), provando
 * admin com verificarAdminSaaS() ANTES de elevar. O isolamento NÃO vem de RLS por
 * dono (service_role a bypassa) — vem do escopo explícito e da posse das
 * referências (categoria_opcional_id / categoria_id de produto) provada sob lojaId.
 *
 * Invariantes provadas (issue 135 + RN-O8):
 *  1. preço negativo → reprovado por schemaOpcional, SEM tocar `opcionais`;
 *  2. categoria_opcional_id / categoria_id de OUTRA loja → rejeitado (buscarPorId
 *     escopado por lojaId devolve null) ANTES de gravar;
 *  3. CROSS-LOJA: UPDATE/DELETE/toggle/insert escopados por eq("loja_id", lojaId) —
 *     opcional/categoria/associação de outra loja não é alcançado;
 *  4. admin não provado (verificarAdminSaaS lança) → exceção PROPAGA, zero efeito;
 *  5. associação: DELETE-por-categoria_id cru com eq("loja_id").eq("categoria_id")
 *     (exceção documentada ao wrapper); loja_id gravado = lojaId, nunca do payload.
 *
 * Mock do client encadeável: espelha admin-produtos.test.ts. O client RAIZ
 * (createServiceClient) NÃO é thenável; só a cadeia `.from(...)` termina numa
 * Promise resolvida POR TABELA (`respostaPorTabela`). Cada operação vira uma `Op`
 * com filtros (eq/in), insert/update/delete/select.
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja alheia
const CAT_OPC_PROPRIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // categoria de opcional da loja-alvo
const CAT_OPC_ALHEIA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // categoria de opcional de outra loja
const CAT_PROD_PROPRIA = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // categoria de PRODUTO da loja-alvo
const CAT_PROD_ALHEIA = "dddddddd-dddd-dddd-dddd-dddddddddddd"; // categoria de PRODUTO de outra loja

// ── Captura do que cada operação manda ao banco, por TABELA tocada. ───────────
type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleted?: boolean;
  selected?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta simulada do terminador da cadeia, escolhida pela TABELA.
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
  criarCategoriaOpcionalAdmin,
  atualizarCategoriaOpcionalAdmin,
  removerCategoriaOpcionalAdmin,
  criarOpcionalAdmin,
  atualizarOpcionalAdmin,
  alternarOpcionalAtivoAdmin,
  removerOpcionalAdmin,
  salvarAssociacaoOpcionaisAdmin,
} from "./admin-opcionais";

// ── Payloads válidos sob os schemas de lib/validacoes/opcional.ts ────────────
function payloadCategoriaOpcional(over: Record<string, unknown> = {}) {
  return { nome: "Adicionais", ordem: 0, ...over };
}
function payloadOpcional(over: Record<string, unknown> = {}) {
  return {
    nome: "Bacon extra",
    preco: 5.5,
    categoria_opcional_id: CAT_OPC_PROPRIA,
    ativo: true,
    ordem: 0,
    ...over,
  };
}
function payloadAssociacao(over: Record<string, unknown> = {}) {
  return {
    categoria_id: CAT_PROD_PROPRIA,
    categoria_opcional_id: [CAT_OPC_PROPRIA],
    ...over,
  };
}

// helper: a Op de escrita numa tabela (insert OU update OU delete).
function opEscrita(tabela: string): Op | undefined {
  return ops.find(
    (o) => o.tabela === tabela && (o.insert || o.update || o.deleted),
  );
}
function opsEscrita(tabela: string): Op[] {
  return ops.filter(
    (o) => o.tabela === tabela && (o.insert || o.update || o.deleted),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaPorTabela = {
    // SELECT de posse: por padrão as referências informadas são da LOJA-ALVO.
    opcionais_categorias: {
      data: { id: CAT_OPC_PROPRIA, loja_id: LOJA_ALVO },
      error: null,
    },
    categorias: {
      data: { id: CAT_PROD_PROPRIA, loja_id: LOJA_ALVO },
      error: null,
    },
    opcionais: { data: { id: "opcional-novo" }, error: null },
    categoria_produto_opcionais: { data: null, error: null },
  };
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ─────────────────────── criarCategoriaOpcionalAdmin ────────────────────────
describe("criarCategoriaOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 5 — caminho feliz: insere via service_role escopado na loja-alvo → { ok:true }", async () => {
    const r = await criarCategoriaOpcionalAdmin(
      LOJA_ALVO,
      payloadCategoriaOpcional(),
    );
    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("opcionais_categorias")?.insert).toBeDefined();
  });

  it("caso 3/5 — CROSS-LOJA: loja_id do insert = lojaId da URL, NUNCA do payload", async () => {
    await criarCategoriaOpcionalAdmin(LOJA_ALVO, {
      ...payloadCategoriaOpcional(),
      loja_id: LOJA_OUTRA,
    });
    expect(opEscrita("opcionais_categorias")?.insert?.loja_id).toBe(LOJA_ALVO);
    expect(opEscrita("opcionais_categorias")?.insert?.loja_id).not.toBe(
      LOJA_OUTRA,
    );
  });

  it("payload inválido (campo extra .strict) → { ok:false } sem tocar o banco", async () => {
    const r = await criarCategoriaOpcionalAdmin(LOJA_ALVO, {
      ...payloadCategoriaOpcional(),
      hack: true,
    });
    expect(r.ok).toBe(false);
    expect(opEscrita("opcionais_categorias")).toBeUndefined();
  });

  it("caso 4 — fail-closed: verificarAdminSaaS lança → PROPAGA, service/insert nunca tocados", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      criarCategoriaOpcionalAdmin(LOJA_ALVO, payloadCategoriaOpcional()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais_categorias")).toBeUndefined();
  });
});

// ────────────────────── atualizarCategoriaOpcionalAdmin ─────────────────────
describe("atualizarCategoriaOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: UPDATE escopado por id E loja_id (não alcança categoria de outra loja)", async () => {
    const r = await atualizarCategoriaOpcionalAdmin(
      LOJA_ALVO,
      "cat-opc-1",
      payloadCategoriaOpcional({ nome: "Molhos" }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais_categorias")?.update).toBeDefined();
    expect(opEscrita("opcionais_categorias")?.filtros).toContainEqual([
      "id",
      "cat-opc-1",
    ]);
    expect(opEscrita("opcionais_categorias")?.filtros).toContainEqual([
      "loja_id",
      LOJA_ALVO,
    ]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      atualizarCategoriaOpcionalAdmin(
        LOJA_ALVO,
        "cat-opc-1",
        payloadCategoriaOpcional(),
      ),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais_categorias")).toBeUndefined();
  });
});

// ─────────────────────── removerCategoriaOpcionalAdmin ──────────────────────
describe("removerCategoriaOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: DELETE escopado por id E loja_id", async () => {
    const r = await removerCategoriaOpcionalAdmin(LOJA_ALVO, "cat-opc-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais_categorias")?.deleted).toBe(true);
    expect(opEscrita("opcionais_categorias")?.filtros).toContainEqual([
      "id",
      "cat-opc-1",
    ]);
    expect(opEscrita("opcionais_categorias")?.filtros).toContainEqual([
      "loja_id",
      LOJA_ALVO,
    ]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, nada deletado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      removerCategoriaOpcionalAdmin(LOJA_ALVO, "cat-opc-1"),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais_categorias")).toBeUndefined();
  });
});

// ──────────────────────────── criarOpcionalAdmin ────────────────────────────
describe("criarOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 5 — caminho feliz: prova posse da cat-opcional e insere na loja-alvo → { ok:true }", async () => {
    const r = await criarOpcionalAdmin(LOJA_ALVO, payloadOpcional());
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais")?.insert).toBeDefined();
    // Posse checada com SELECT em opcionais_categorias escopado por loja_id.
    const selPosse = ops.find(
      (o) => o.tabela === "opcionais_categorias" && o.selected,
    );
    expect(selPosse?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(selPosse?.filtros).toContainEqual(["id", CAT_OPC_PROPRIA]);
  });

  it("caso 5 — grava `preco` do payload validado e loja_id = lojaId da URL (nunca do payload)", async () => {
    await criarOpcionalAdmin(LOJA_ALVO, {
      ...payloadOpcional({ preco: 7.25 }),
      loja_id: LOJA_OUTRA,
    });
    // .strict() rejeita loja_id no payload → se aceito, a action deve descartá-lo.
    // Este teste vale quando o schema aceita; a asserção-mestra é o loja_id do escopo.
    expect(opEscrita("opcionais")?.insert?.preco).toBe(7.25);
    expect(opEscrita("opcionais")?.insert?.loja_id).toBe(LOJA_ALVO);
  });

  it("caso 1 — ATAQUE: preço negativo reprovado por schemaOpcional SEM tocar `opcionais`", async () => {
    const r = await criarOpcionalAdmin(LOJA_ALVO, payloadOpcional({ preco: -1 }));
    expect(r.ok).toBe(false);
    expect(opEscrita("opcionais")).toBeUndefined();
  });

  it("borda — preço ZERO é aceito (schemaOpcional usa .min(0); só negativo é rejeitado)", async () => {
    const r = await criarOpcionalAdmin(LOJA_ALVO, payloadOpcional({ preco: 0 }));
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais")?.insert?.preco).toBe(0);
  });

  it("caso 2 — ATAQUE: categoria_opcional_id de OUTRA loja REJEITADO sem inserir o opcional (RN-O8)", async () => {
    // buscarPorId escopado por lojaId não acha a cat-opcional alheia.
    respostaPorTabela.opcionais_categorias = { data: null, error: null };
    const r = await criarOpcionalAdmin(
      LOJA_ALVO,
      payloadOpcional({ categoria_opcional_id: CAT_OPC_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("opcionais")).toBeUndefined();
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, service/insert nunca tocados", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      criarOpcionalAdmin(LOJA_ALVO, payloadOpcional()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

// ─────────────────────────── atualizarOpcionalAdmin ─────────────────────────
describe("atualizarOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: UPDATE escopado por id E loja_id", async () => {
    const r = await atualizarOpcionalAdmin(
      LOJA_ALVO,
      "opcional-1",
      payloadOpcional({ preco: 9 }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais")?.update).toBeDefined();
    expect(opEscrita("opcionais")?.filtros).toContainEqual(["id", "opcional-1"]);
    expect(opEscrita("opcionais")?.filtros).toContainEqual([
      "loja_id",
      LOJA_ALVO,
    ]);
  });

  it("caso 1 — ATAQUE: preço negativo no update reprovado SEM tocar `opcionais`", async () => {
    const r = await atualizarOpcionalAdmin(
      LOJA_ALVO,
      "opcional-1",
      payloadOpcional({ preco: -5 }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("opcionais")).toBeUndefined();
  });

  it("caso 2 — ATAQUE: trocar para categoria_opcional_id de OUTRA loja é rejeitado no update (RN-O8)", async () => {
    respostaPorTabela.opcionais_categorias = { data: null, error: null };
    const r = await atualizarOpcionalAdmin(
      LOJA_ALVO,
      "opcional-1",
      payloadOpcional({ categoria_opcional_id: CAT_OPC_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("opcionais")).toBeUndefined();
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      atualizarOpcionalAdmin(LOJA_ALVO, "opcional-1", payloadOpcional()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

// ───────────────────────── alternarOpcionalAtivoAdmin ───────────────────────
describe("alternarOpcionalAtivoAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: UPDATE do flag escopado por id E loja_id", async () => {
    const r = await alternarOpcionalAtivoAdmin(LOJA_ALVO, "opcional-1", false);
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais")?.update?.ativo).toBe(false);
    expect(opEscrita("opcionais")?.filtros).toContainEqual(["id", "opcional-1"]);
    expect(opEscrita("opcionais")?.filtros).toContainEqual([
      "loja_id",
      LOJA_ALVO,
    ]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, sem efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      alternarOpcionalAtivoAdmin(LOJA_ALVO, "opcional-1", true),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

// ─────────────────────────── removerOpcionalAdmin ───────────────────────────
describe("removerOpcionalAdmin (Server Action — admin SaaS)", () => {
  it("caso 3 — CROSS-LOJA: DELETE escopado por id E loja_id", async () => {
    const r = await removerOpcionalAdmin(LOJA_ALVO, "opcional-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("opcionais")?.deleted).toBe(true);
    expect(opEscrita("opcionais")?.filtros).toContainEqual(["id", "opcional-1"]);
    expect(opEscrita("opcionais")?.filtros).toContainEqual([
      "loja_id",
      LOJA_ALVO,
    ]);
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, nada deletado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      removerOpcionalAdmin(LOJA_ALVO, "opcional-1"),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

// ────────────────────── salvarAssociacaoOpcionaisAdmin ──────────────────────
describe("salvarAssociacaoOpcionaisAdmin (Server Action — admin SaaS)", () => {
  it("caso 5 — DELETE-por-categoria_id cru carrega eq('loja_id') E eq('categoria_id') (exceção documentada)", async () => {
    const r = await salvarAssociacaoOpcionaisAdmin(
      LOJA_ALVO,
      payloadAssociacao(),
    );
    expect(r).toEqual({ ok: true });
    const del = ops.find(
      (o) => o.tabela === "categoria_produto_opcionais" && o.deleted,
    );
    expect(del).toBeDefined();
    expect(del?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(del?.filtros).toContainEqual(["categoria_id", CAT_PROD_PROPRIA]);
  });

  it("caso 5 — INSERT da associação grava loja_id = lojaId da URL (nunca do payload)", async () => {
    await salvarAssociacaoOpcionaisAdmin(LOJA_ALVO, payloadAssociacao());
    const ins = ops.find(
      (o) => o.tabela === "categoria_produto_opcionais" && o.insert,
    );
    expect(ins?.insert?.loja_id).toBe(LOJA_ALVO);
    expect(ins?.insert?.categoria_id).toBe(CAT_PROD_PROPRIA);
    expect(ins?.insert?.categoria_opcional_id).toBe(CAT_OPC_PROPRIA);
  });

  it("caso 2 — ATAQUE: categoria_id (produto) de OUTRA loja rejeitado sem DELETE/INSERT (posse ponta produto)", async () => {
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await salvarAssociacaoOpcionaisAdmin(
      LOJA_ALVO,
      payloadAssociacao({ categoria_id: CAT_PROD_ALHEIA }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
  });

  it("caso 2 — ATAQUE: categoria_opcional_id de OUTRA loja rejeitado sem DELETE/INSERT (posse ponta opcional, RN-O8)", async () => {
    // Ponta produto ok; cada cat-opcional é checada e a alheia não é achada.
    respostaPorTabela.opcionais_categorias = { data: null, error: null };
    const r = await salvarAssociacaoOpcionaisAdmin(
      LOJA_ALVO,
      payloadAssociacao({ categoria_opcional_id: [CAT_OPC_ALHEIA] }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
  });

  it("caso 5 — lista vazia: DELETE executa (substituição), INSERT não roda → { ok:true }", async () => {
    const r = await salvarAssociacaoOpcionaisAdmin(
      LOJA_ALVO,
      payloadAssociacao({ categoria_opcional_id: [] }),
    );
    expect(r).toEqual({ ok: true });
    const del = ops.find(
      (o) => o.tabela === "categoria_produto_opcionais" && o.deleted,
    );
    expect(del).toBeDefined();
    const ins = ops.find(
      (o) => o.tabela === "categoria_produto_opcionais" && o.insert,
    );
    expect(ins).toBeUndefined();
  });

  it("caso 4 — fail-closed: admin negado → PROPAGA, nenhuma associação tocada", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      salvarAssociacaoOpcionaisAdmin(LOJA_ALVO, payloadAssociacao()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
  });
});
