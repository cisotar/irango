import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 032 — CRUD de cupons do LOJISTA (criarCupom /
 * atualizarCupom / removerCupom). As actions são STUBs (`throw 'TODO: GREEN'`),
 * então TODA expectativa abaixo FALHA hoje — esse é o RED. A implementação é
 * da fase GREEN (executar).
 *
 * Foco de segurança (issue 032 + seguranca.md §2/§14):
 *  - valida `cupomSchema` ANTES de qualquer I/O (lixo nem chega ao banco);
 *  - usa o client AUTENTICADO (RLS `cupons_acesso_proprio`), NUNCA service_role;
 *  - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload —
 *    payload com loja_id de OUTRA loja é IGNORADO (cupom nasce na loja do dono);
 *  - código normalizado (trim + uppercase) ao persistir;
 *  - código duplicado na loja → erro "Este código já existe";
 *  - erro de banco → genérico, sem vazar e.message.
 *
 * Padrão de mocks: o client AUTENTICADO (createClient) é um query-builder
 * chainable que captura a linha enviada (insert/update). buscarLojaDoDono é
 * mockada para fornecer a loja do dono (fonte autoritativa do loja_id).
 */

// ─────────────────────────── mocks de I/O (server-only / auth client / queries)
const LOJA_DONO = "11111111-1111-1111-1111-111111111111"; // loja do auth.uid()
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono

// Captura do que a action manda ao banco, por operação.
type Captura = {
  tabela?: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleteId?: string;
  filtros: Array<[string, unknown]>;
};
let captura: Captura;

// Resposta simulada do terminador da cadeia (.select().single() / await chain).
let respostaBanco: { data: unknown; error: unknown };

// Query-builder chainable mínimo que registra a operação e os filtros.
//
// CRÍTICO: o CLIENT RAIZ (o que createClient() resolve) NÃO pode ser thenável.
// Se o objeto que tem `.from` também tiver `.then`, o `await createClient()`
// assimila o thenable e resolve para respostaBanco em vez do client →
// `supabase.from is not a function`. Só os NÓS retornados por `.from(...)`
// (a cadeia de query) terminam numa Promise. Espelha src/lib/actions/status.test.ts.
function makeChain() {
  // A cadeia da query (pós-from) é o único objeto thenável.
  const queryChain: Record<string, unknown> = {};
  const passthrough = (k: string) => {
    queryChain[k] = (...args: unknown[]) => {
      if (k === "eq") captura.filtros.push([args[0] as string, args[1]]);
      return queryChain;
    };
  };
  ["select", "eq", "single", "maybeSingle", "limit"].forEach(passthrough);
  queryChain.insert = (row: Record<string, unknown>) => {
    captura.insert = row;
    return queryChain;
  };
  queryChain.update = (row: Record<string, unknown>) => {
    captura.update = row;
    return queryChain;
  };
  queryChain.delete = () => queryChain;
  // Torna a cadeia da query "thenável": await queryChain → respostaBanco.
  queryChain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(respostaBanco).then(onF);

  // O client raiz só expõe `.from` — NÃO é thenável.
  const client: Record<string, unknown> = {
    from: (t: string) => {
      captura.tabela = t;
      return queryChain;
    },
  };
  return client;
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// service_role NÃO deve ser usado nesta action (escrita do lojista é RLS).
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarCupom, atualizarCupom, removerCupom } from "./cupom";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

function payloadCupom(over: Record<string, unknown> = {}) {
  return {
    codigo: "promo10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    expira_em: null,
    ativo: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captura = { filtros: [] };
  respostaBanco = { data: { id: "cupom-novo" }, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

describe("criarCupom (Server Action — gestão do lojista)", () => {
  it("caminho feliz: valida + insere via client autenticado → { ok:true }", async () => {
    const r = await criarCupom(payloadCupom());
    expect(r).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(captura.tabela).toBe("cupons");
    expect(captura.insert).toBeDefined();
  });

  it("loja_id é DERIVADO da loja do dono (buscarLojaDoDono), nunca inventado", async () => {
    await criarCupom(payloadCupom());
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
  });

  it("código é normalizado (trim + uppercase) ao persistir", async () => {
    await criarCupom(payloadCupom({ codigo: "  promo10 " }));
    expect(captura.insert?.codigo).toBe("PROMO10");
  });

  it("ATAQUE: payload com loja_id de OUTRA loja é IGNORADO (cupom nasce na do dono)", async () => {
    await criarCupom({ ...payloadCupom(), loja_id: LOJA_OUTRA });
    // O loja_id persistido é sempre o do dono — nunca o injetado no payload.
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
    expect(captura.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("NÃO usa service_role (escrita do lojista passa pela RLS autenticada)", async () => {
    await criarCupom(payloadCupom());
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("ATAQUE: percentual 200 rejeitado SEM tocar no banco (cupomSchema)", async () => {
    const r = await criarCupom(payloadCupom({ valor: 200 }));
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("ATAQUE: código com símbolos rejeitado SEM tocar no banco", async () => {
    const r = await criarCupom(payloadCupom({ codigo: "PRO-MO!" }));
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("ATAQUE: valor negativo rejeitado SEM tocar no banco", async () => {
    const r = await criarCupom(payloadCupom({ valor: -5 }));
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("código duplicado na loja (23505) → erro 'Este código já existe'", async () => {
    respostaBanco = { data: null, error: { code: "23505" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarCupom(payloadCupom());
    expect(r).toEqual({ ok: false, erro: "Este código já existe" });
    spy.mockRestore();
  });

  it("erro de banco genérico → erro sem vazar e.message", async () => {
    respostaBanco = { data: null, error: { message: "senha postgres XYZ", code: "XX000" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarCupom(payloadCupom());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});

describe("atualizarCupom (Server Action — gestão do lojista)", () => {
  it("valida e atualiza o cupom escopado por id via client autenticado", async () => {
    const r = await atualizarCupom("cupom-1", payloadCupom({ valor: 15 }));
    expect(r).toEqual({ ok: true });
    expect(captura.tabela).toBe("cupons");
    expect(captura.update).toBeDefined();
    expect(captura.filtros).toContainEqual(["id", "cupom-1"]);
  });

  it("ATAQUE: update NÃO troca loja_id para outra loja (loja_id fora do update ou = dono)", async () => {
    await atualizarCupom("cupom-1", { ...payloadCupom(), loja_id: LOJA_OUTRA });
    // Se loja_id for persistido no update, jamais pode ser a outra loja.
    if (captura.update && "loja_id" in captura.update) {
      expect(captura.update.loja_id).toBe(LOJA_DONO);
    }
    expect(captura.update?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("ATAQUE: percentual 200 no update rejeitado SEM tocar no banco", async () => {
    const r = await atualizarCupom("cupom-1", payloadCupom({ valor: 200 }));
    expect(r.ok).toBe(false);
    expect(captura.update).toBeUndefined();
  });
});

describe("removerCupom (Server Action — gestão do lojista)", () => {
  it("deleta o cupom escopado por id via client autenticado (RLS isola por dono)", async () => {
    const r = await removerCupom("cupom-1");
    expect(r).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(captura.tabela).toBe("cupons");
    expect(captura.filtros).toContainEqual(["id", "cupom-1"]);
    // RLS impede deletar cupom de outra loja; a action não usa service_role.
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
