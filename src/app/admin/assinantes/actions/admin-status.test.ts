import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 133 (crítica: SIM). Variante ADMIN da mudança de status
 * de pedido em `./admin-status`: `atualizarStatusPedidoAdmin(lojaId, id, novoStatus)`.
 * A action é STUB (`throw 'TODO: GREEN'`), então TODA expectativa de comportamento
 * abaixo FALHA hoje — esse é o RED comprovado. A implementação real é da fase GREEN.
 *
 * Diferença da action do lojista (src/lib/actions/status.ts): aqui o admin do SaaS
 * escreve na LOJA-ALVO (`lojaId` da URL admin) via service_role, provando admin com
 * verificarAdminSaaS() ANTES de elevar. O isolamento NÃO vem de RLS por dono — vem
 * do wrapper `escopo` que injeta `.eq("loja_id", lojaId).eq("id", id)` em toda
 * leitura/escrita. A máquina de estados (transicaoPermitida) é revalidada no
 * servidor lendo o `status` atual do banco — o cliente é ignorado como autoridade.
 *
 * Invariantes provadas (issue 133 + specs/paridade-hub-admin-painel.md rota 4):
 *  1. Transição inválida (salto/reversão) rejeitada no servidor → SEM UPDATE;
 *  2. Pedido de OUTRA loja / inexistente (buscarPorId escopado devolve null) →
 *     { ok:false } ANTES de qualquer escrita (cross-tenant);
 *  3. CROSS-LOJA: caminho feliz grava com eq("loja_id", LOJA_A) E eq("id", id),
 *     payload { status } sem loja_id/id; retorno { ok:true, status };
 *  4. admin não provado (verificarAdminSaaS lança) → exceção PROPAGA, service_role
 *     nunca elevada, zero efeito;
 *  5. payload/zod inválido (lojaId não-UUID, novoStatus fora do enum) → { ok:false }
 *     sem I/O;
 *  6. corrida (count:0 no UPDATE) → { ok:false } (não mente ok:true).
 *
 * Padrão de mock do client encadeável: espelha admin-produtos.test.ts. O client
 * RAIZ (createServiceClient) NÃO é thenável; só a cadeia `.from(...)` termina numa
 * Promise. Aqui a MESMA tabela `pedidos` é lida E escrita, então a resposta do
 * terminador é escolhida pela OPERAÇÃO (leitura via `.select` vs. escrita via
 * `.update`), não só pela tabela.
 */

const LOJA_A = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_B = "22222222-2222-2222-2222-222222222222"; // loja alheia
const PEDIDO_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// ── Captura do que cada operação manda ao banco. ─────────────────────────────
type Op = {
  tabela: string;
  update?: Record<string, unknown>;
  selected?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Respostas do terminador, por operação (leitura do status atual vs. escrita).
let leituraPedido: { data: unknown; error: unknown };
let escritaPedido: { data: unknown; error: unknown; count: number | null };

function resolverResposta(op: Op): { data: unknown; error: unknown; count?: number | null } {
  if (op.tabela === "pedidos" && op.update !== undefined) return escritaPedido;
  if (op.tabela === "pedidos") return leituraPedido;
  return { data: null, error: null, count: null };
}

function makeChain() {
  const client: Record<string, unknown> = {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const queryChain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        queryChain[k] = (...args: unknown[]) => {
          if (k === "eq") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select") op.selected = true;
          return queryChain;
        };
      };
      ["select", "eq", "single", "maybeSingle", "limit", "order"].forEach(
        passthrough,
      );
      queryChain.update = (row: Record<string, unknown>) => {
        op.update = row;
        return queryChain;
      };
      // Só a cadeia da query é thenável → resolve a resposta da SUA operação.
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(resolverResposta(op)).then(onF);
      return queryChain;
    },
  };
  return client;
}

// service_role: ESTE é o client da action admin (escrita escopada por lojaId).
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

// 'use server' é só diretiva; o módulo é importável no runner node. A action é
// STUB (throw 'TODO: GREEN') → RED na asserção de comportamento.
import { atualizarStatusPedidoAdmin } from "./admin-status";

// helper: a Op de UPDATE em `pedidos` (escrita real do status).
function opUpdatePedidos(): Op | undefined {
  return ops.find((o) => o.tabela === "pedidos" && o.update !== undefined);
}
// helper: a Op de leitura do status atual (SELECT em `pedidos`).
function opLeituraPedidos(): Op | undefined {
  return ops.find((o) => o.tabela === "pedidos" && o.update === undefined && o.selected);
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  // Default: pedido existe na loja-alvo com status "pendente"; escrita ok, 1 linha.
  leituraPedido = { data: { status: "pendente" }, error: null };
  escritaPedido = { data: [{ id: PEDIDO_ID }], error: null, count: 1 };
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ───────────────── caso 1 — transição inválida rejeitada no servidor ─────────
describe("atualizarStatusPedidoAdmin — máquina de estados revalidada no servidor", () => {
  it("caso 1 — REVERSÃO (entregue→pendente) rejeitada SEM UPDATE", async () => {
    leituraPedido = { data: { status: "entregue" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "pendente");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 1 — SALTO (pendente→entregue) rejeitado SEM UPDATE", async () => {
    leituraPedido = { data: { status: "pendente" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "entregue");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 1 — saída de estado TERMINAL (cancelado→confirmado) rejeitada SEM UPDATE", async () => {
    leituraPedido = { data: { status: "cancelado" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 1 — TERMINAL (entregue) tentando OUTRA transição (entregue→cancelado) também rejeitada SEM UPDATE — prova que o bloqueio é 'terminal não sai', não só 'sem reversão específica'", async () => {
    leituraPedido = { data: { status: "entregue" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "cancelado");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 1 — self-transição em estado NÃO-terminal (pendente→pendente) rejeitada SEM UPDATE — TRANSICOES não tem self-loop", async () => {
    leituraPedido = { data: { status: "pendente" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "pendente");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 1 — self-transição em estado TERMINAL (cancelado→cancelado) rejeitada SEM UPDATE — reenviar o mesmo status não reabre o terminal", async () => {
    leituraPedido = { data: { status: "cancelado" }, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "cancelado");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });
});

// ───────────────── caso 2 — cross-tenant: pedido de outra loja ───────────────
describe("atualizarStatusPedidoAdmin — isolamento cross-tenant", () => {
  it("caso 2 — pedido de OUTRA loja / inexistente (leitura escopada = null) → { ok:false } SEM UPDATE", async () => {
    // Sob escopo por LOJA_A, o pedido da LOJA_B não casa nenhuma linha.
    leituraPedido = { data: null, error: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 2 — a leitura do status atual é escopada por eq('loja_id', LOJA_A) E eq('id', id)", async () => {
    leituraPedido = { data: null, error: null };
    await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    const leitura = opLeituraPedidos();
    expect(leitura?.filtros).toContainEqual(["loja_id", LOJA_A]);
    expect(leitura?.filtros).toContainEqual(["id", PEDIDO_ID]);
    // Nunca deve carregar o escopo da loja alheia.
    expect(leitura?.filtros).not.toContainEqual(["loja_id", LOJA_B]);
  });
});

// ───────────────── caso 3 — caminho feliz: escopo no UPDATE ──────────────────
describe("atualizarStatusPedidoAdmin — escrita escopada na loja-alvo", () => {
  it("caso 3 — transição válida (pendente→confirmado) grava escopado e retorna { ok:true, status }", async () => {
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    expect(r).toEqual({ ok: true, status: "confirmado" });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    const upd = opUpdatePedidos();
    expect(upd?.update).toEqual({ status: "confirmado" });
    expect(upd?.filtros).toContainEqual(["loja_id", LOJA_A]);
    expect(upd?.filtros).toContainEqual(["id", PEDIDO_ID]);
  });

  it("caso 3 — o patch de UPDATE não re-parenteia (loja_id) nem re-chaveia (id)", async () => {
    await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    const upd = opUpdatePedidos()?.update ?? {};
    expect("loja_id" in upd).toBe(false);
    expect("id" in upd).toBe(false);
  });
});

// ───────────────── caso 4 — fail-closed: admin não provado propaga ───────────
describe("atualizarStatusPedidoAdmin — prova de admin ANTES de elevar", () => {
  it("caso 4 — verificarAdminSaaS lança → exceção PROPAGA, service_role NUNCA elevada, zero escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado"),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opUpdatePedidos()).toBeUndefined();
  });
});

// ───────────────── caso 5 — payload/zod inválido rejeitado sem I/O ───────────
describe("atualizarStatusPedidoAdmin — validação server-side (nunca confiar no cliente)", () => {
  it("caso 5 — lojaId NÃO-UUID → { ok:false } sem elevar nem ler/escrever", async () => {
    const r = await atualizarStatusPedidoAdmin("nao-e-uuid", PEDIDO_ID, "confirmado");
    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops.length).toBe(0);
  });

  it("caso 5 — novoStatus FORA do enum → { ok:false } sem elevar nem escrever", async () => {
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "voando");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });

  it("caso 5 — id NÃO-UUID → { ok:false } sem UPDATE", async () => {
    const r = await atualizarStatusPedidoAdmin(LOJA_A, "nao-e-uuid", "confirmado");
    expect(r.ok).toBe(false);
    expect(opUpdatePedidos()).toBeUndefined();
  });
});

// ───────────────── caso 6 — corrida: count:0 no UPDATE não vira sucesso ──────
describe("atualizarStatusPedidoAdmin — corrida/escopo zerado no UPDATE", () => {
  it("caso 6 — leitura ok e transição válida, mas UPDATE casa 0 linhas (count:0) → { ok:false }", async () => {
    escritaPedido = { data: [], error: null, count: 0 };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    expect(r.ok).toBe(false);
  });

  it("caso 6 — erro de banco na escrita → { ok:false } (detalhe só no log)", async () => {
    escritaPedido = { data: null, error: { message: "boom" }, count: null };
    const r = await atualizarStatusPedidoAdmin(LOJA_A, PEDIDO_ID, "confirmado");
    expect(r.ok).toBe(false);
  });
});
