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
// [215] itens (linhas de `opcionais`) dentro de UM grupo.
const ITEM_1 = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const ITEM_2 = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
const ITEM_3 = "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3";

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

import {
  reordenarOpcionaisDaCategoria,
  salvarAssociacaoOpcionais,
  // AINDA NÃO EXISTE (issue 215) — este import é o vermelho da camada 2.
  reordenarItensDoGrupoOpcional,
} from "./opcional";

function rpcReordenar(): ChamadaRpc | undefined {
  return chamadasRpc.find((c) => c.nome === "reordenar_opcionais_da_categoria");
}

/** [215] A RPC de ITENS é outra função, com outro nome e outros parâmetros. */
function rpcReordenarItens(): ChamadaRpc | undefined {
  return chamadasRpc.find((c) => c.nome === "reordenar_itens_do_grupo_opcional");
}

/** A Op de LEITURA (select sem escrita) numa tabela. */
function opLeitura(tabela: string): Op | undefined {
  return ops.find((o) => o.tabela === tabela && o.selected && !o.insert && !o.update && !o.deleted);
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

  it("sucesso: revalidatePath das DUAS rotas do painel E do slug da PRÓPRIA loja, nunca a forma coringa", async () => {
    await reordenarOpcionaisDaCategoria(payload());
    expect(revalidatePath).toHaveBeenCalledWith("/painel/produtos/opcionais");
    // [217] `/painel/produtos` monta o MESMO cartão de associação dentro de um
    // modal. Sem revalidar a rota irmã, a travessia entre as duas servia a
    // entrada velha do Router Cache — "editei e não atualizou".
    expect(revalidatePath).toHaveBeenCalledWith("/painel/produtos");
    expect(revalidatePath).toHaveBeenCalledWith(`/loja/${LOJA_SLUG}`);
    // A forma coringa invalidaria o Router Cache de TODAS as lojas do
    // marketplace a cada reordenação — nunca pode ser chamada assim.
    expect(revalidatePath).not.toHaveBeenCalledWith("/loja/[slug]", "page");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
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


// ═══════════════════ reordenarItensDoGrupoOpcional (issue 215) ══════════════
/**
 * Fase RED (TDD) da issue 215, camada 2 — a fronteira do LOJISTA.
 *
 * A action AINDA NÃO EXISTE: o import no topo deste arquivo falha e derruba o
 * arquivo inteiro (inclusive os describes verdes da 208). É o vermelho legítimo
 * desta fase; nenhuma linha de produção é escrita aqui.
 *
 * A suíte pglite (tests/migrations/rpc_reordenar_itens_do_grupo_opcional.test.ts,
 * casos [215-I1..I17]) prova a RPC em SQL puro. Este describe prova o CONTRATO
 * DA FRONTEIRA, que SQL nenhum alcança:
 *   - parse ANTES de qualquer I/O (payload lixo → zero rede);
 *   - `p_loja_id` DERIVADO de `buscarLojaDoDono` (auth.uid()), NUNCA do payload —
 *     é o par TypeScript do caso [215-I3], onde trocar o argumento reescreveria a
 *     ordem de outra loja;
 *   - `categoria_opcional_id` (único parâmetro de escopo que vem do cliente)
 *     revalidado como da PRÓPRIA loja antes da RPC;
 *   - nome e forma EXATOS dos args (chamar a RPC da 208 por engano, ou trocar a
 *     ordem do array, passaria num `toHaveBeenCalled()` genérico);
 *   - mensagem genérica única, detalhe só no console.error do servidor;
 *   - service_role NUNCA usado na via do lojista.
 */
describe("reordenarItensDoGrupoOpcional (Server Action — issue 215)", () => {
  function payload(over: Record<string, unknown> = {}) {
    return {
      categoria_opcional_id: CAT_OPC_A,
      // Sequência DELIBERADAMENTE fora de ordem alfabética: se a action ordenar
      // ou normalizar a lista, [215-F1] pega.
      opcional_id: [ITEM_3, ITEM_1, ITEM_2],
      ...over,
    };
  }

  it("[215-F1] caminho feliz: UMA chamada da RPC de ITENS, com nome e args exatos, na ordem do payload", async () => {
    const r = await reordenarItensDoGrupoOpcional(payload());
    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0].nome).toBe("reordenar_itens_do_grupo_opcional");
    expect(rpcReordenarItens()?.args).toEqual({
      p_loja_id: LOJA_DONO,
      p_categoria_opcional_id: CAT_OPC_A,
      p_ids: [ITEM_3, ITEM_1, ITEM_2],
    });
  });

  it("[215-F2] p_loja_id é DERIVADO de buscarLojaDoDono, nunca do payload", async () => {
    const OUTRO_DONO = "77777777-7777-7777-7777-777777777777";
    buscarLojaDoDono.mockResolvedValue({ id: OUTRO_DONO, slug: LOJA_SLUG });
    respostaPorTabela.opcionais_categorias = {
      data: { id: CAT_OPC_A, loja_id: OUTRO_DONO },
      error: null,
    };
    await reordenarItensDoGrupoOpcional(payload());
    expect(rpcReordenarItens()?.args.p_loja_id).toBe(OUTRO_DONO);
  });

  it("[215-F3] propriedade hostil (loja_id) pendurada no payload → { ok:false } via .strict(), zero RPC", async () => {
    const r = await reordenarItensDoGrupoOpcional(
      payload({ loja_id: "99999999-9999-9999-9999-999999999999" }),
    );
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-F4] lista com 1 id → { ok:false }, zero RPC e zero I/O", async () => {
    const r = await reordenarItensDoGrupoOpcional(payload({ opcional_id: [ITEM_1] }));
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
    // Parse ANTES do I/O: nem o SELECT de posse pode ter rodado.
    expect(ops).toHaveLength(0);
  });

  it("[215-F5] ids duplicados → { ok:false }, zero RPC (defesa em profundidade antes do row_count)", async () => {
    const r = await reordenarItensDoGrupoOpcional(
      payload({ opcional_id: [ITEM_1, ITEM_1, ITEM_2] }),
    );
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-F6] categoria_opcional_id ausente / não-uuid / payload lixo → { ok:false }, zero RPC", async () => {
    const lixos: unknown[] = [
      {},
      null,
      "string solta",
      { opcional_id: [ITEM_1, ITEM_2] },
      { categoria_opcional_id: "nao-e-uuid", opcional_id: [ITEM_1, ITEM_2] },
    ];
    for (const lixo of lixos) {
      chamadasRpc = [];
      ops = [];
      const r = await reordenarItensDoGrupoOpcional(lixo);
      expect(r.ok, `payload ${JSON.stringify(lixo)} deveria ser reprovado`).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
      expect(ops).toHaveLength(0);
    }
  });

  it("[215-F7] o SELECT de posse do grupo é escopado por id E loja_id (nunca só por id)", async () => {
    await reordenarItensDoGrupoOpcional(payload());
    const posse = opLeitura("opcionais_categorias");
    expect(posse?.filtros).toContainEqual(["id", CAT_OPC_A]);
    expect(posse?.filtros).toContainEqual(["loja_id", LOJA_DONO]);
  });

  it("[215-F8] grupo de OUTRA loja (SELECT de posse devolve null) → { ok:false }, zero RPC", async () => {
    respostaPorTabela.opcionais_categorias = { data: null, error: null };
    const r = await reordenarItensDoGrupoOpcional(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-F9] buscarLojaDoDono → null (sessão expirada / dono sem loja) → { ok:false }, zero RPC", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await reordenarItensDoGrupoOpcional(payload());
    expect(r.ok).toBe(false);
    expect(chamadasRpc).toHaveLength(0);
  });

  it("[215-F10] erro da RPC (P0001 de id alheio/lista incompleta): MESMA mensagem genérica, detalhe só no log", async () => {
    respostaRpc = {
      data: null,
      error: { message: "ids nao formam a permutacao completa do grupo", code: "P0001" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarItensDoGrupoOpcional(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    // Mensagem distinta por causa viraria oráculo de existência de id.
    expect(JSON.stringify(r)).not.toContain("permutacao");
    expect(JSON.stringify(r)).not.toContain("P0001");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[215-F11] erro 42501 (anon sem EXECUTE) também vira a mesma mensagem genérica", async () => {
    respostaRpc = { data: null, error: { message: "permission denied for function", code: "42501" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reordenarItensDoGrupoOpcional(payload());
    expect(r).toEqual({ ok: false, erro: "Não foi possível salvar a ordem." });
    spy.mockRestore();
  });

  it("[215-F12] NÃO usa service_role — a escrita do lojista passa pelo client autenticado", async () => {
    await reordenarItensDoGrupoOpcional(payload());
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[215-F13] sucesso: revalidatePath das DUAS rotas do painel E do slug da PRÓPRIA loja, nunca a forma coringa", async () => {
    await reordenarItensDoGrupoOpcional(payload());
    expect(revalidatePath).toHaveBeenCalledWith("/painel/produtos/opcionais");
    // [217] A rota irmã que passou a montar o cartão dentro de um modal.
    expect(revalidatePath).toHaveBeenCalledWith("/painel/produtos");
    expect(revalidatePath).toHaveBeenCalledWith(`/loja/${LOJA_SLUG}`);
    expect(revalidatePath).not.toHaveBeenCalledWith("/loja/[slug]", "page");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });

  it("[215-F14] falha (RPC com erro): revalidatePath NÃO é chamado", async () => {
    respostaRpc = { data: null, error: { message: "erro" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await reordenarItensDoGrupoOpcional(payload());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[215-F15] NÃO chama a RPC de GRUPOS da 208 por engano", async () => {
    await reordenarItensDoGrupoOpcional(payload());
    expect(rpcReordenar()).toBeUndefined();
    // E nenhuma escrita direta em `opcionais`: a ordem só muda dentro da RPC.
    expect(opEscrita("opcionais")).toBeUndefined();
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 215, fronteira do lojista:
 *
 *   // src/lib/actions/opcional.ts
 *   export async function reordenarItensDoGrupoOpcional(
 *     payload: unknown,
 *   ): Promise<ResultadoOpcional>
 *
 * Sequência: `schemaReordenacaoItensDoGrupo.safeParse(payload)` → `createClient()`
 * → `buscarLojaDoDono` → `categoriaOpcionalPertenceALoja(supabase, categoria_opcional_id, loja.id)`
 * → `supabase.rpc("reordenar_itens_do_grupo_opcional", { p_loja_id: loja.id,
 *   p_categoria_opcional_id: categoria_opcional_id, p_ids: opcional_id })`
 * → `revalidatePath(CAMINHO_PAINEL)` + `revalidatePath(\`/loja/${loja.slug}\`)`.
 * Qualquer falha → `{ ok: false, erro: ERRO_ORDEM }` (constante já existente, :34).
 *
 * Casos que precisam passar: [215-F1]..[215-F15].
 */
