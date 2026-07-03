import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 134 (crítica: SIM). Variantes ADMIN do CRUD de cupom em
 * `./admin-cupom`. As actions são STUBs (provam admin via `prepararContextoAdmin`
 * e então `throw 'TODO: GREEN'`), então TODA expectativa de COMPORTAMENTO abaixo
 * (persistir/escopar/validar/mapear 23505) FALHA hoje — esse é o RED comprovado.
 * A implementação real é da fase GREEN (executar).
 *
 * Diferença do CRUD do lojista (src/lib/actions/cupom.ts): aqui o admin do SaaS
 * escreve na LOJA-ALVO (`lojaId` da URL admin) via service_role (bypassa RLS),
 * provando admin com verificarAdminSaaS() ANTES de elevar. O isolamento NÃO vem
 * de RLS por dono — vem do escopo explícito `eq("loja_id", lojaId).eq("id", id)`
 * em toda escrita (helpers `escopo.*` de admin-loja.ts).
 *
 * Invariantes provadas (issue 134 + spec paridade-hub-admin-painel.md rota 5):
 *  1. CROSS-TENANT: UPDATE/DELETE escopados por eq("loja_id", lojaAlvo) E
 *     eq("id", id) — cupom de OUTRA loja não é alcançado;
 *  2. 23505 (UNIQUE loja_id+codigo) → { ok:false, erro:"Este código já existe" };
 *  3. payload inválido (percentual 150) → { ok:false } SEM tocar no banco;
 *  4. loja_id/id do payload são IGNORADOS — insert.loja_id = lojaId da URL, nunca
 *     o do payload (injeção por construção via escopo.inserir);
 *  5. não-admin → verificarAdminSaaS lança → PROPAGA, service client nunca criado.
 *
 * Padrão de mock do client encadeável: espelha admin-produtos.test.ts. O client
 * RAIZ (retornado por createServiceClient) NÃO é thenável; só a cadeia de
 * `.from(...)` termina numa Promise, resolvida POR TABELA (`respostaPorTabela`).
 * Captura cada operação numa `Op` com filtros (`eq`), insert/update/delete.
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja alheia

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
let respostaPorTabela: Record<
  string,
  { data: unknown; error: unknown; count?: number | null }
>;

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
          respostaPorTabela[tabela] ?? { data: null, error: null, count: null },
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
  criarCupomAdmin,
  atualizarCupomAdmin,
  removerCupomAdmin,
} from "./admin-cupom";

// Payload VÁLIDO sob cupomSchema (lib/validacoes/cupom.ts): código alfanumérico,
// percentual 1..100, sem casas extras, expira_em null, ativo boolean.
function payloadCupom(over: Record<string, unknown> = {}) {
  return {
    codigo: "DESC10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    expira_em: null,
    ativo: true,
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
  respostaPorTabela = {
    // Escrita ok por padrão: linha afetada (count 1), sem erro.
    cupons: { data: { id: "cupom-novo" }, error: null, count: 1 },
  };
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ───────────────────────────── criarCupomAdmin ──────────────────────────────
describe("criarCupomAdmin (Server Action — admin SaaS)", () => {
  it("caminho feliz: valida + insere via service_role escopado na loja-alvo → { ok:true }", async () => {
    const r = await criarCupomAdmin(LOJA_ALVO, payloadCupom());
    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(opEscrita("cupons")?.insert).toBeDefined();
    expect(opEscrita("cupons")?.insert?.codigo).toBe("DESC10");
  });

  it("loja_id = lojaId da URL, NUNCA do payload (injeção por construção)", async () => {
    await criarCupomAdmin(LOJA_ALVO, {
      ...payloadCupom(),
      loja_id: LOJA_OUTRA,
    });
    expect(opEscrita("cupons")?.insert?.loja_id).toBe(LOJA_ALVO);
    expect(opEscrita("cupons")?.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("ATAQUE: percentual 150 reprovado por cupomSchema SEM tocar no banco", async () => {
    const r = await criarCupomAdmin(LOJA_ALVO, payloadCupom({ valor: 150 }));
    expect(r.ok).toBe(false);
    expect(opEscrita("cupons")).toBeUndefined();
  });

  it("ATAQUE: código com símbolo reprovado por cupomSchema SEM tocar no banco", async () => {
    const r = await criarCupomAdmin(
      LOJA_ALVO,
      payloadCupom({ codigo: "10% OFF!" }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("cupons")).toBeUndefined();
  });

  it("23505 (código duplicado por loja) → { ok:false, erro:'Este código já existe' }", async () => {
    respostaPorTabela.cupons = { data: null, error: { code: "23505" }, count: null };
    const r = await criarCupomAdmin(LOJA_ALVO, payloadCupom());
    expect(r).toEqual({ ok: false, erro: "Este código já existe" });
  });

  it("fail-closed: verificarAdminSaaS lança → PROPAGA e NÃO cria service client nem insere", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(criarCupomAdmin(LOJA_ALVO, payloadCupom())).rejects.toThrow(
      "Acesso negado.",
    );
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("cupons")).toBeUndefined();
  });
});

// ──────────────────────────── atualizarCupomAdmin ───────────────────────────
describe("atualizarCupomAdmin (Server Action — admin SaaS)", () => {
  it("CROSS-LOJA: UPDATE escopado por id E loja_id (não alcança cupom de outra loja)", async () => {
    const r = await atualizarCupomAdmin(
      LOJA_ALVO,
      "cupom-1",
      payloadCupom({ valor: 20 }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("cupons")?.update).toBeDefined();
    expect(opEscrita("cupons")?.filtros).toContainEqual(["id", "cupom-1"]);
    expect(opEscrita("cupons")?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("patch NÃO carrega loja_id/id do payload (Omit por tipo + escopo por construção)", async () => {
    await atualizarCupomAdmin(LOJA_ALVO, "cupom-1", {
      ...payloadCupom(),
      loja_id: LOJA_OUTRA,
      id: "cupom-forjado",
    });
    const upd = opEscrita("cupons")?.update;
    if (upd && "loja_id" in upd) expect(upd.loja_id).toBe(LOJA_ALVO);
    expect(upd?.loja_id).not.toBe(LOJA_OUTRA);
    // o `id` da linha vem do argumento, nunca do corpo do payload.
    expect(opEscrita("cupons")?.filtros).toContainEqual(["id", "cupom-1"]);
    expect(opEscrita("cupons")?.filtros).not.toContainEqual([
      "id",
      "cupom-forjado",
    ]);
  });

  it("id inexistente / de outra loja → count 0 → { ok:false, erro:'Cupom não encontrado.' }", async () => {
    respostaPorTabela.cupons = { data: null, error: null, count: 0 };
    const r = await atualizarCupomAdmin(LOJA_ALVO, "cupom-alheio", payloadCupom());
    expect(r).toEqual({ ok: false, erro: "Cupom não encontrado." });
  });

  it("ATAQUE: percentual 150 no update reprovado SEM tocar no banco", async () => {
    const r = await atualizarCupomAdmin(
      LOJA_ALVO,
      "cupom-1",
      payloadCupom({ valor: 150 }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("cupons")).toBeUndefined();
  });

  it("23505 no update (código colide com outro cupom da loja) → 'Este código já existe'", async () => {
    respostaPorTabela.cupons = { data: null, error: { code: "23505" }, count: null };
    const r = await atualizarCupomAdmin(LOJA_ALVO, "cupom-1", payloadCupom());
    expect(r).toEqual({ ok: false, erro: "Este código já existe" });
  });

  it("fail-closed: admin negado → PROPAGA, zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(
      atualizarCupomAdmin(LOJA_ALVO, "cupom-1", payloadCupom()),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("cupons")).toBeUndefined();
  });

  // Bug real que isto pega: se alguém trocar cupomSchema por `.partial()` (ou a
  // action passar a aceitar patch parcial "por conveniência" de UI), um PATCH
  // com só `{ ativo: false }` passaria a validar e gravaria uma linha faltando
  // codigo/tipo/valor/pedido_minimo/usos_maximos/expira_em — cupomSchema hoje
  // EXIGE o objeto completo (não há `.partial()`), então isto tem que reprovar
  // ANTES de tocar o banco. Mesmo padrão do teste de "percentual 150", mas aqui
  // o payload em si é a forma real que a UI enviaria para só ativar/desativar.
  it("update parcial (só `ativo`, sem os demais campos) reprovado por cupomSchema SEM tocar no banco", async () => {
    const r = await atualizarCupomAdmin(LOJA_ALVO, "cupom-1", { ativo: false });
    expect(r.ok).toBe(false);
    expect(opEscrita("cupons")).toBeUndefined();
  });
});

// ──────────────────────────── removerCupomAdmin ─────────────────────────────
describe("removerCupomAdmin (Server Action — admin SaaS)", () => {
  it("CROSS-LOJA: DELETE escopado por id E loja_id", async () => {
    const r = await removerCupomAdmin(LOJA_ALVO, "cupom-1");
    expect(r).toEqual({ ok: true });
    expect(opEscrita("cupons")?.deleted).toBe(true);
    expect(opEscrita("cupons")?.filtros).toContainEqual(["id", "cupom-1"]);
    expect(opEscrita("cupons")?.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });

  it("id inexistente / de outra loja → count 0 → { ok:false, erro:'Cupom não encontrado.' }", async () => {
    respostaPorTabela.cupons = { data: null, error: null, count: 0 };
    const r = await removerCupomAdmin(LOJA_ALVO, "cupom-alheio");
    expect(r).toEqual({ ok: false, erro: "Cupom não encontrado." });
  });

  it("fail-closed: admin negado → PROPAGA, nada deletado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(removerCupomAdmin(LOJA_ALVO, "cupom-1")).rejects.toThrow(
      "Acesso negado.",
    );
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(opEscrita("cupons")).toBeUndefined();
  });
});
