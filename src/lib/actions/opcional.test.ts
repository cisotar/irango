import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cobertura das Server Actions do LOJISTA tocadas pela issue 208
 * (src/lib/actions/opcional.ts):
 *
 *  - `reordenarOpcionaisDaCategoria` — nova, autorização em lote (RN-4/RN-5b).
 *    Os 32 testes de fase RED da issue (tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts)
 *    provam a RPC via SQL puro; este arquivo prova o CONTRATO DA FRONTEIRA:
 *    parse antes de qualquer I/O, p_loja_id derivado (nunca do payload),
 *    categoria_id revalidada como da própria loja, mensagem genérica única,
 *    service_role nunca usado, revalidatePath pelo slug da própria loja (nunca
 *    a forma coringa `("/loja/[slug]", "page")`).
 *  - `salvarAssociacaoOpcionais` — RN-12: o delta que preserva `ordem` de quem
 *    permanece. Antes desta issue o teste da via ADMIN cobria o delete-all
 *    incondicional (135); a via do LOJISTA nunca teve teste de Server Action —
 *    este arquivo fecha essa lacuna para a parte que a 208 mudou.
 *
 * Resto do CRUD de opcionais (criar/atualizar/remover categoria e opcional,
 * toggle) é código PRÉ-EXISTENTE não tocado por esta issue — lacuna real, mas
 * fora do escopo da 208; não duplicado aqui.
 *
 * Padrão de mocks: espelha src/lib/actions/produto.test.ts (client raiz não
 * thenável; só a cadeia `.from(...)` resolve, por TABELA; `rpc(...)` é
 * terminador próprio no client raiz).
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111";
const LOJA_SLUG = "lanches-base";
const CAT_PROD_PROPRIA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CAT_OPC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAT_OPC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleted?: boolean;
  selected?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];
let respostaPorTabela: Record<string, { data: unknown; error: unknown }>;

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
      queryChain.update = (row: Record<string, unknown>) => {
        op.update = row;
        return queryChain;
      };
      queryChain.delete = () => {
        op.deleted = true;
        return queryChain;
      };
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(
          respostaPorTabela[tabela] ?? { data: null, error: null },
        ).then(onF);
      return queryChain;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve(respostaRpc);
    },
  };
  return client;
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// A escrita do lojista é RLS autenticada — service_role nunca deveria aparecer.
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { reordenarOpcionaisDaCategoria, salvarAssociacaoOpcionais } from "./opcional";

function rpcReordenar(): ChamadaRpc | undefined {
  return chamadasRpc.find((c) => c.nome === "reordenar_opcionais_da_categoria");
}

function opEscrita(tabela: string): Op | undefined {
  return ops.find((o) => o.tabela === tabela && (o.insert || o.update || o.deleted));
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: null, error: null };
  respostaPorTabela = {
    // SELECT de posse: categoria de produto é da própria loja por padrão.
    categorias: { data: { id: CAT_PROD_PROPRIA, loja_id: LOJA_DONO }, error: null },
    opcionais_categorias: { data: { id: CAT_OPC_A, loja_id: LOJA_DONO }, error: null },
    categoria_produto_opcionais: { data: [], error: null },
  };
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DONO, slug: LOJA_SLUG });
});

// ═══════════════════════ reordenarOpcionaisDaCategoria ══════════════════════
describe("reordenarOpcionaisDaCategoria (Server Action — issue 208)", () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      categoria_id: CAT_PROD_PROPRIA,
      categoria_opcional_id: [CAT_OPC_A, CAT_OPC_B],
      ...over,
    };
  }

  it("caminho feliz: chama a RPC uma vez com p_loja_id, p_categoria_id e p_ids → { ok:true }", async () => {
    const r = await reordenarOpcionaisDaCategoria(payload());
    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toHaveLength(1);
    expect(rpcReordenar()?.args).toEqual({
      p_loja_id: LOJA_DONO,
      p_categoria_id: CAT_PROD_PROPRIA,
      p_ids: [CAT_OPC_A, CAT_OPC_B],
    });
  });

  it("p_loja_id é DERIVADO de buscarLojaDoDono, nunca do payload (loja com outro dono na sessão)", async () => {
    // Simula um dono cuja loja tem id diferente do usado nos demais casos —
    // prova que o valor que chega na RPC é sempre o de buscarLojaDoDono, não
    // algo hardcoded ou vindo de outro lugar.
    const OUTRO_DONO = "77777777-7777-7777-7777-777777777777";
    buscarLojaDoDono.mockResolvedValue({ id: OUTRO_DONO, slug: LOJA_SLUG });
    respostaPorTabela.categorias = { data: { id: CAT_PROD_PROPRIA, loja_id: OUTRO_DONO }, error: null };
    await reordenarOpcionaisDaCategoria(payload());
    expect(rpcReordenar()?.args.p_loja_id).toBe(OUTRO_DONO);
  });

  it("propriedade hostil (loja_id) pendurada no payload → { ok:false } via .strict(), zero RPC", async () => {
    const r = await reordenarOpcionaisDaCategoria(
      payload({ loja_id: "99999999-9999-9999-9999-999999999999" }),
    );
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("lista com 1 id → { ok:false }, zero RPC (lista de 1 não tem ordem)", async () => {
    const r = await reordenarOpcionaisDaCategoria(payload({ categoria_opcional_id: [CAT_OPC_A] }));
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("ids duplicados → { ok:false }, zero RPC (defesa em profundidade antes do row_count)", async () => {
    const r = await reordenarOpcionaisDaCategoria(
      payload({ categoria_opcional_id: [CAT_OPC_A, CAT_OPC_A] }),
    );
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("categoria_id ausente / não-uuid → { ok:false }, zero RPC", async () => {
    for (const lixo of [{}, { categoria_id: "nao-e-uuid", categoria_opcional_id: [CAT_OPC_A, CAT_OPC_B] }]) {
      chamadasRpc = [];
      const r = await reordenarOpcionaisDaCategoria(lixo);
      expect(r.ok).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
    }
  });

  it("RN-5b: categoria_id não pertence à própria loja → { ok:false }, zero RPC", async () => {
    respostaPorTabela.categorias = { data: null, error: null };
    const r = await reordenarOpcionaisDaCategoria(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("buscarLojaDoDono → null → { ok:false }, zero RPC", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await reordenarOpcionaisDaCategoria(payload());
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("erro da RPC (id alheio, lista incompleta ou erro de banco): MESMA mensagem genérica, sem vazar detalhe", async () => {
    respostaRpc = { data: null, error: { message: "detalhe interno do postgres", code: "P0001" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarOpcionaisDaCategoria(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
    expect(JSON.stringify(r)).not.toContain("P0001");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("NÃO usa service_role — a escrita do lojista passa pela RLS autenticada", async () => {
    await reordenarOpcionaisDaCategoria(payload());
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("sucesso: revalidatePath do painel E do slug da PRÓPRIA loja, nunca a forma coringa", async () => {
    await reordenarOpcionaisDaCategoria(payload());
    expect(revalidatePath).toHaveBeenCalledWith("/painel/produtos/opcionais");
    expect(revalidatePath).toHaveBeenCalledWith(`/loja/${LOJA_SLUG}`);
    // A forma coringa invalidaria o Router Cache de TODAS as lojas do
    // marketplace a cada reordenação — nunca pode ser chamada assim.
    expect(revalidatePath).not.toHaveBeenCalledWith("/loja/[slug]", "page");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("falha (RPC com erro): revalidatePath NÃO é chamado", async () => {
    respostaRpc = { data: null, error: { message: "erro" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await reordenarOpcionaisDaCategoria(payload());
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ═══════════════════════ salvarAssociacaoOpcionais (RN-12) ══════════════════
describe("salvarAssociacaoOpcionais — RN-12: a associação não zera a ordem (issue 208)", () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      categoria_id: CAT_PROD_PROPRIA,
      categoria_opcional_id: [CAT_OPC_A],
      ...over,
    };
  }

  it("quem PERMANECE marcado não é deletado nem reinserido — zero escrita na tabela de associação", async () => {
    // CAT_OPC_A já está associado e continua marcado: delta vazio.
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_A, ordem: 3 }],
      error: null,
    };
    const r = await salvarAssociacaoOpcionais(payload());
    expect(r).toEqual({ ok: true });
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
  });

  it("grupo novo é inserido com ordem = max(ordem dos que permanecem) + 1", async () => {
    respostaPorTabela.opcionais_categorias = { data: { id: CAT_OPC_B, loja_id: LOJA_DONO }, error: null };
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_A, ordem: 7 }],
      error: null,
    };
    const r = await salvarAssociacaoOpcionais(payload({ categoria_opcional_id: [CAT_OPC_A, CAT_OPC_B] }));
    expect(r).toEqual({ ok: true });
    const insert = opEscrita("categoria_produto_opcionais");
    expect(insert?.insert).toEqual([
      { loja_id: LOJA_DONO, categoria_id: CAT_PROD_PROPRIA, categoria_opcional_id: CAT_OPC_B, ordem: 8 },
    ]);
  });

  it("desmarcar um grupo: DELETE escopado por loja_id + categoria_id + in(categoria_opcional_id removidos)", async () => {
    respostaPorTabela.categoria_produto_opcionais = {
      data: [{ categoria_opcional_id: CAT_OPC_A, ordem: 0 }],
      error: null,
    };
    const r = await salvarAssociacaoOpcionais(payload({ categoria_opcional_id: [] }));
    expect(r).toEqual({ ok: true });
    const del = opEscrita("categoria_produto_opcionais");
    expect(del?.deleted).toBe(true);
    expect(del?.filtros).toContainEqual(["loja_id", LOJA_DONO]);
    expect(del?.filtros).toContainEqual(["categoria_id", CAT_PROD_PROPRIA]);
    expect(del?.filtros).toContainEqual(["categoria_opcional_id", [CAT_OPC_A]]);
  });

  it("erro na leitura de posse (SELECT prévio) → { ok:false }, nenhum DELETE/INSERT roda", async () => {
    respostaPorTabela.categoria_produto_opcionais = {
      data: null,
      error: { message: "erro de leitura" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await salvarAssociacaoOpcionais(payload());
    expect(r.ok).toBe(false);
    expect(opEscrita("categoria_produto_opcionais")).toBeUndefined();
    spy.mockRestore();
  });
});
