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
// [215] itens (linhas de `opcionais`) dentro de UM grupo da loja-alvo.
const ITEM_1 = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const ITEM_2 = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
const ITEM_3 = "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3";

// ── Captura do que cada operação manda ao banco, por TABELA tocada. ───────────
type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  updateOpts?: { count?: string };
  deleted?: boolean;
  selected?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta simulada do terminador da cadeia, escolhida pela TABELA.
let respostaPorTabela: Record<
  string,
  { data: unknown; error: unknown; count?: number }
>;

// ── [215] Captura das chamadas de RPC do client RAIZ. Até esta issue NENHUMA
//    action admin usava `svc.rpc(...)`; a 215 é a primeira, então o molde do
//    terminador vem literalmente de src/lib/actions/opcional.test.ts:84-87.
type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[];
let respostaRpc: { data: unknown; error: unknown };

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
      queryChain.update = (
        row: Record<string, unknown>,
        opts?: { count?: string },
      ) => {
        op.update = row;
        op.updateOpts = opts;
        return queryChain;
      };
      queryChain.delete = () => {
        op.deleted = true;
        return queryChain;
      };
      // Só a cadeia da query é thenável → resolve a resposta da SUA tabela.
      // UPDATE com `count: "exact"` devolve `count` no PostgREST real; sem modelar
      // isso o mock não distingue "afetou a linha" de "não afetou nenhuma", que é
      // exatamente a janela TOCTOU que o count existe para fechar. Default 1 (afetou
      // a linha); um teste que queira o caso 0 sobrescreve via `respostaPorTabela`.
      queryChain.then = (onF: (v: unknown) => unknown) => {
        const base = respostaPorTabela[tabela] ?? { data: null, error: null };
        const resposta =
          op.update != null && (base as { count?: number }).count == null
            ? { ...base, count: 1 }
            : base;
        return Promise.resolve(resposta).then(onF);
      };
      return queryChain;
    },
    // [215] `rpc` é terminador PRÓPRIO do client raiz (não passa por `.from`):
    // devolve a Promise direto, igual ao supabase-js real.
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve(respostaRpc);
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

// [215] `registrarAcessoAdmin` (best-effort, fire-and-forget: INSERT em
// `admin_acessos`) é espionado — asserir a trilha pelo `ops` dependeria de
// `SAAS_ADMIN_USER_ID` no ambiente e de flush de microtask. O resto do módulo
// (validarLojaIdAdmin, prepararContextoAdmin, escopo, revalidarLojaAdmin) fica
// REAL: é ele que injeta o `.eq("loja_id")` que os testes deste arquivo provam.
const registrarAcessoAdmin = vi.fn();
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: (...a: unknown[]) => registrarAcessoAdmin(...a) };
});

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
  reordenarOpcionaisDaCategoriaAdmin,
  // AINDA NÃO EXISTE (issue 215) — este import é o vermelho da camada 3.
  reordenarItensDoGrupoOpcionalAdmin,
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
beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: null, error: null };
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
    // RN-12 (issue 208): o DELETE não é mais "do conjunto inteiro" — ele só roda
    // para os DESMARCADOS e carrega também o `in("categoria_opcional_id", …)`.
    // Aqui CAT_OPC_ALHEIA está associado hoje e não está na seleção → sai.
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_ALHEIA, ordem: 0 }],
      error: null,
    };
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
    expect(del?.filtros).toContainEqual([
      "categoria_opcional_id",
      [CAT_OPC_ALHEIA],
    ]);
  });

  it("caso 5 — RN-12: quem PERMANECE não é deletado nem reinserido (a `ordem` sobrevive)", async () => {
    // O grupo já associado continua marcado: nada a remover, nada a inserir.
    // É o clique mais comum do painel (re-salvar sem mexer), que com o
    // delete+insert de antes zeraria a ordem de toda a categoria.
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_PROPRIA, ordem: 3 }],
      error: null,
    };
    const r = await salvarAssociacaoOpcionaisAdmin(
      LOJA_ALVO,
      payloadAssociacao(),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
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

  it("caso 5 — lista vazia: DELETE de tudo que estava associado, INSERT não roda → { ok:true }", async () => {
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_PROPRIA, ordem: 0 }],
      error: null,
    };
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

// ─────────────────────── reordenarOpcionaisDaCategoriaAdmin ─────────────────
/**
 * Fase RED (TDD) da issue 215 — este describe foi REESCRITO e é o que FECHA O
 * DÉBITO 211.
 *
 * Antes: a action lia a permutação (1 SELECT) e gravava num LOOP de N `update`
 * com `count: "exact"`. Aquilo não era atômico — uma falha no meio deixava
 * posições parciais gravadas — e o `count` só fechava a janela TOCTOU de cada
 * linha, uma por vez. A 215 torna a RPC `reordenar_opcionais_da_categoria`
 * `security definer` com a trava T2 no corpo, e a via admin passa a usá-la:
 * N+1 round-trips viram 1, e a atomicidade vem da transação do Postgres
 * (caso [211-G5] da suíte pglite).
 *
 * O que este describe prova agora:
 *   - ZERO toque direto em `categoria_produto_opcionais` — nem SELECT, nem
 *     update. Se o loop voltar, [211-A2] falha nomeando as Ops;
 *   - UMA chamada de RPC, com `p_loja_id` = loja-alvo da URL, nunca do payload;
 *   - os guards que já existiam (lojaId inválido, admin negado, categoria de
 *     produto de outra loja, `loja_id` hostil, mensagem genérica) continuam.
 */
describe("reordenarOpcionaisDaCategoriaAdmin (Server Action — issue 215 fecha o 211)", () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      categoria_id: CAT_PROD_PROPRIA,
      categoria_opcional_id: [CAT_OPC_PROPRIA, CAT_OPC_ALHEIA],
      ...over,
    };
  }

  function rpcGrupos(): ChamadaRpc | undefined {
    return chamadasRpc.find((c) => c.nome === "reordenar_opcionais_da_categoria");
  }

  it("[211-A1] caminho feliz: UMA chamada de RPC com p_loja_id da loja-alvo, na ordem do payload → { ok:true }", async () => {
    const r = await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    // A chamada de RPC é asserida ANTES do resultado: assim o vermelho desta
    // fase acusa a AUSÊNCIA da RPC, não um { ok:false } que o caminho antigo
    // devolveria por outro motivo.
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0].nome).toBe("reordenar_opcionais_da_categoria");
    expect(rpcGrupos()?.args).toEqual({
      p_loja_id: LOJA_ALVO,
      p_categoria_id: CAT_PROD_PROPRIA,
      p_ids: [CAT_OPC_PROPRIA, CAT_OPC_ALHEIA],
    });
    expect(r).toEqual({ ok: true });
  });

  it("[211-A2] o loop de N update MORREU: zero SELECT e zero update em categoria_produto_opcionais", async () => {
    // É o critério de aceite do 211. A escrita inteira vive dentro da transação
    // da RPC; qualquer `.from("categoria_produto_opcionais")` sobrando aqui é a
    // volta do N+1 não-atômico.
    await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    const tocadas = ops.filter((o) => o.tabela === "categoria_produto_opcionais");
    expect(
      tocadas,
      `esperava ZERO toque direto na tabela (a RPC faz tudo), veio: ${JSON.stringify(tocadas)}`,
    ).toHaveLength(0);
  });

  it("[211-A3] propriedade hostil loja_id no payload é DESCARTADA — a RPC recebe sempre a loja-alvo da URL", async () => {
    const r = await reordenarOpcionaisDaCategoriaAdmin(
      LOJA_ALVO,
      payload({ loja_id: LOJA_OUTRA }),
    );
    expect(r).toEqual({ ok: true });
    expect(rpcGrupos()?.args.p_loja_id).toBe(LOJA_ALVO);
    expect(JSON.stringify(rpcGrupos()?.args)).not.toContain(LOJA_OUTRA);
  });

  it("[211-A4] RN-5b: categoria_id (de produto) que não pertence à loja-alvo → { ok:false }, zero RPC", async () => {
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[211-A5] permutação incompleta / id alheio: a RPC recusa (P0001) → mensagem genérica, sem vazar detalhe", async () => {
    // A checagem de permutação deixou de ser feita em JS (TOCTOU) e passou a
    // viver dentro da transação — aqui só se prova o TRATAMENTO do erro.
    respostaRpc = {
      data: null,
      error: { message: "ids nao formam a permutacao completa", code: "P0001" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(JSON.stringify(r)).not.toContain("permutacao");
    expect(JSON.stringify(r)).not.toContain("P0001");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[211-A6] falha da RPC → registrarAcessoAdmin NÃO é chamado (trilha não registra sucesso que não houve)", async () => {
    respostaRpc = { data: null, error: { message: "boom", code: "P0001" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    expect(registrarAcessoAdmin).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[211-A7] lojaId inválido (não-uuid) na URL → { ok:false }, service_role nunca criado, zero RPC", async () => {
    const r = await reordenarOpcionaisDaCategoriaAdmin("nao-e-uuid", payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[211-A8] erro de banco na checagem de posse da categoria de produto (lança) → genérico, zero RPC", async () => {
    respostaPorTabela.categorias = { data: null, error: { message: "boom interno" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(JSON.stringify(r)).not.toContain("boom interno");
    expect(chamadasRpc).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[211-A9] fail-closed: admin negado → PROPAGA, zero RPC", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      reordenarOpcionaisDaCategoriaAdmin(LOJA_ALVO, payload()),
    ).rejects.toThrow("Acesso negado.");
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[211-A10] payload inválido (lista de 1, duplicata) → { ok:false }, zero RPC", async () => {
    for (const ids of [[CAT_OPC_PROPRIA], [CAT_OPC_PROPRIA, CAT_OPC_PROPRIA]]) {
      chamadasRpc = [];
      const r = await reordenarOpcionaisDaCategoriaAdmin(
        LOJA_ALVO,
        payload({ categoria_opcional_id: ids }),
      );
      expect(r.ok, `ids ${JSON.stringify(ids)} deveriam ser reprovados`).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
    }
  });
});

// ────────────────────── reordenarItensDoGrupoOpcionalAdmin ──────────────────
/**
 * Fase RED (TDD) da issue 215, camada 3 — o ESPELHO ADMIN da action do lojista.
 *
 * A action AINDA NÃO EXISTE: o import no topo deste arquivo falha e derruba o
 * arquivo inteiro. Vermelho legítimo; nenhuma linha de produção aqui.
 *
 * O espelho existe porque as duas vias gravam a MESMA coluna com a MESMA regra —
 * a única diferença é de onde vem a loja: `auth.uid()` no lojista, `lojaId` da URL
 * admin aqui. O que este describe fecha, e que a suíte pglite não alcança:
 * `p_loja_id` nunca pode vir do payload (é o [215-I4], onde nem `service_role`
 * salva de escrever na loja errada se o argumento for escolhido pelo cliente).
 */
describe("reordenarItensDoGrupoOpcionalAdmin (Server Action — issue 215)", () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      categoria_opcional_id: CAT_OPC_PROPRIA,
      opcional_id: [ITEM_3, ITEM_1, ITEM_2],
      ...over,
    };
  }

  function rpcItens(): ChamadaRpc | undefined {
    return chamadasRpc.find((c) => c.nome === "reordenar_itens_do_grupo_opcional");
  }

  it("[215-B1] caminho feliz: UMA RPC com nome e args exatos, na ordem do payload → { ok:true }", async () => {
    const r = await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0].nome).toBe("reordenar_itens_do_grupo_opcional");
    expect(rpcItens()?.args).toEqual({
      p_loja_id: LOJA_ALVO,
      p_categoria_opcional_id: CAT_OPC_PROPRIA,
      p_ids: [ITEM_3, ITEM_1, ITEM_2],
    });
  });

  it("[215-B2] p_loja_id vem do lojaId da URL, NUNCA do payload (loja_id hostil é descartado)", async () => {
    const r = await reordenarItensDoGrupoOpcionalAdmin(
      LOJA_ALVO,
      payload({ loja_id: LOJA_OUTRA }),
    );
    expect(r).toEqual({ ok: true });
    expect(rpcItens()?.args.p_loja_id).toBe(LOJA_ALVO);
    expect(JSON.stringify(rpcItens()?.args)).not.toContain(LOJA_OUTRA);
  });

  it("[215-B3] lojaId inválido (não-uuid) na URL → { ok:false }, service_role nunca criado, zero RPC", async () => {
    const r = await reordenarItensDoGrupoOpcionalAdmin("nao-e-uuid", payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-B4] fail-closed: admin negado → PROPAGA a exceção, zero RPC", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload()),
    ).rejects.toThrow("Acesso negado.");
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-B5] grupo de OUTRA loja (buscarPorId escopado devolve null) → { ok:false }, zero RPC", async () => {
    respostaPorTabela.opcionais_categorias = { data: null, error: null };
    const r = await reordenarItensDoGrupoOpcionalAdmin(
      LOJA_ALVO,
      payload({ categoria_opcional_id: CAT_OPC_ALHEIA }),
    );
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-B6] o SELECT de posse do grupo é escopado por loja_id (wrapper escopo.buscarPorId)", async () => {
    await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    const posse = ops.find((o) => o.tabela === "opcionais_categorias" && o.selected);
    expect(posse?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(posse?.filtros).toContainEqual(["id", CAT_OPC_PROPRIA]);
  });

  it("[215-B7] payload inválido (lista de 1, duplicata, uuid lixo) → { ok:false }, zero RPC", async () => {
    const casos: unknown[] = [
      payload({ opcional_id: [ITEM_1] }),
      payload({ opcional_id: [ITEM_1, ITEM_1] }),
      payload({ categoria_opcional_id: "nao-e-uuid" }),
      payload({ opcional_id: [ITEM_1, "nao-e-uuid"] }),
      {},
    ];
    for (const caso of casos) {
      chamadasRpc = [];
      const r = await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, caso);
      expect(r.ok, `payload ${JSON.stringify(caso)} deveria ser reprovado`).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
    }
  });

  it("[215-B8] erro da RPC (P0001) → mensagem genérica, detalhe só no console.error do servidor", async () => {
    respostaRpc = {
      data: null,
      error: { message: "ids nao formam a permutacao completa do grupo", code: "P0001" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(JSON.stringify(r)).not.toContain("permutacao");
    expect(JSON.stringify(r)).not.toContain("P0001");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[215-B9] sucesso: registrarAcessoAdmin com acao 'opcional.item.reordenar' e entidadeId do grupo", async () => {
    await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    expect(registrarAcessoAdmin).toHaveBeenCalledTimes(1);
    expect(registrarAcessoAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lojaId: LOJA_ALVO,
        acao: "opcional.item.reordenar",
        entidadeId: CAT_OPC_PROPRIA,
      }),
    );
  });

  it("[215-B10] falha da RPC → registrarAcessoAdmin NÃO é chamado", async () => {
    respostaRpc = { data: null, error: { message: "boom", code: "P0001" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    expect(registrarAcessoAdmin).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[215-B11] nenhuma escrita direta em `opcionais` — a ordem só muda dentro da RPC", async () => {
    await reordenarItensDoGrupoOpcionalAdmin(LOJA_ALVO, payload());
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 215, via admin:
 *
 *   // src/app/admin/assinantes/actions/admin-opcionais.ts
 *   export async function reordenarItensDoGrupoOpcionalAdmin(
 *     lojaId: string,
 *     payload: unknown,
 *   ): Promise<Resultado>
 *
 * Sequência: `validarLojaIdAdmin(lojaId)` → `schemaReordenacaoItensDoGrupo
 * .safeParse(descartarLojaId(payload))` → `prepararContextoAdmin(loja.lojaId)` →
 * `categoriaOpcionalPertenceALoja(escopo, categoria_opcional_id)` →
 * `svc.rpc("reordenar_itens_do_grupo_opcional", { p_loja_id: loja.lojaId,
 *   p_categoria_opcional_id: categoria_opcional_id, p_ids: opcional_id })` →
 * `registrarAcessoAdmin(svc, { lojaId: loja.lojaId, acao: "opcional.item.reordenar",
 *   entidadeId: categoria_opcional_id })` → `revalidarLojaAdmin(loja.lojaId)`.
 * Qualquer falha → `{ ok: false, erro: ERRO_ORDEM_ADMIN }` (constante já existente, :48).
 *
 * E em `reordenarOpcionaisDaCategoriaAdmin`: remover o SELECT de permutação e o
 * loop de N `update` (:464-511), trocando por uma única
 * `svc.rpc("reordenar_opcionais_da_categoria", { p_loja_id: loja.lojaId,
 * p_categoria_id: categoria_id, p_ids: categoria_opcional_id })`.
 *
 * Casos que precisam passar: [211-A1]..[211-A10] e [215-B1]..[215-B11].
 */
