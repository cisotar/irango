import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 032 — Server Actions de ENTREGA (salvarZona /
 * salvarTaxa) e PAGAMENTO (salvarFormaPagamento). As actions são STUBs
 * (`throw 'TODO: GREEN'`), então TODA expectativa abaixo FALHA hoje — RED.
 *
 * Foco de segurança (issue 032 + seguranca.md §2/§14):
 *  - valida o schema respectivo ANTES de qualquer I/O;
 *  - client AUTENTICADO (RLS *_escrita_propria), NUNCA service_role;
 *  - loja_id DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload;
 *  - salvarTaxa escopa por zona_id da PRÓPRIA loja (RLS via zona → loja);
 *  - chave pix malformada / url inválida / taxa negativa → rejeitado SEM I/O;
 *  - payload com loja_id de OUTRA loja → ignorado (config nasce na do dono);
 *  - erro de banco → genérico, sem vazar e.message.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111";
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222";

type Captura = {
  tabela?: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
};
let captura: Captura;
let respostaBanco: { data: unknown; error: unknown };

// CRÍTICO: o CLIENT RAIZ (o que createClient() resolve) NÃO pode ser thenável.
// Se o objeto que tem `.from` também tiver `.then`, o `await createClient()`
// assimila o thenable e resolve para respostaBanco em vez do client →
// `supabase.from is not a function`. Só os NÓS retornados por `.from(...)`
// terminam numa Promise. Espelha src/lib/actions/status.test.ts.
function makeChain() {
  const queryChain: Record<string, unknown> = {};
  ["select", "single", "maybeSingle", "limit", "upsert"].forEach((k) => {
    queryChain[k] = (...args: unknown[]) => {
      if (k === "upsert") captura.insert = args[0] as Record<string, unknown>;
      return queryChain;
    };
  });
  queryChain.eq = (col: string, val: unknown) => {
    captura.filtros.push([col, val]);
    return queryChain;
  };
  queryChain.insert = (row: Record<string, unknown>) => {
    captura.insert = row;
    return queryChain;
  };
  queryChain.update = (row: Record<string, unknown>) => {
    captura.update = row;
    return queryChain;
  };
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

const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { salvarZona, salvarTaxa } from "./entrega";
import { salvarFormaPagamento } from "./pagamento";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  captura = { filtros: [] };
  respostaBanco = { data: { id: "linha-nova" }, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

describe("salvarZona (Server Action — entrega)", () => {
  const zonaOk = { nome: "Centro", tipo: "bairro", ativo: true };

  it("caminho feliz: valida + persiste em zonas_entrega via client autenticado", async () => {
    const r = await salvarZona(zonaOk);
    expect(r).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(captura.tabela).toBe("zonas_entrega");
    expect(captura.insert).toBeDefined();
  });

  it("loja_id é DERIVADO da loja do dono, nunca do payload", async () => {
    await salvarZona(zonaOk);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
  });

  it("ATAQUE: payload com loja_id de OUTRA loja é IGNORADO", async () => {
    await salvarZona({ ...zonaOk, loja_id: LOJA_OUTRA });
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
    expect(captura.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("NÃO usa service_role (escrita do lojista passa pela RLS autenticada)", async () => {
    await salvarZona(zonaOk);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("ATAQUE: tipo inválido rejeitado SEM tocar no banco (schemaZona)", async () => {
    const r = await salvarZona({ nome: "X", tipo: "lua", ativo: true });
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("ATAQUE: nome vazio rejeitado SEM tocar no banco", async () => {
    const r = await salvarZona({ nome: "   ", tipo: "bairro", ativo: true });
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });
});

describe("salvarTaxa (Server Action — entrega)", () => {
  const taxaOk = { taxa: 5, pedido_minimo_gratis: null, raio_max_km: null };

  it("caminho feliz: valida + persiste escopado por zona_id via client autenticado", async () => {
    const r = await salvarTaxa("zona-1", taxaOk);
    expect(r).toEqual({ ok: true });
    expect(captura.tabela).toBe("taxas_entrega");
    // A taxa pertence à zona da própria loja (RLS via zona → loja).
    const persistido = (captura.insert ?? captura.update) as Record<string, unknown> | undefined;
    const filtroZona = captura.filtros.some(([, v]) => v === "zona-1");
    expect((persistido?.zona_id === "zona-1") || filtroZona).toBe(true);
  });

  it("ATAQUE: taxa negativa rejeitada SEM tocar no banco (reduziria o total)", async () => {
    const r = await salvarTaxa("zona-1", { ...taxaOk, taxa: -5 });
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
    expect(captura.update).toBeUndefined();
  });

  it("NÃO usa service_role", async () => {
    await salvarTaxa("zona-1", taxaOk);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("salvarFormaPagamento (Server Action — pagamento)", () => {
  const pixOk = { tipo: "pix", config: { tipo_chave: "cpf", chave: "12345678901" } };

  it("caminho feliz: valida + persiste em formas_pagamento via client autenticado", async () => {
    const r = await salvarFormaPagamento(pixOk);
    expect(r).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(captura.tabela).toBe("formas_pagamento");
    expect(captura.insert).toBeDefined();
  });

  it("loja_id é DERIVADO da loja do dono, nunca do payload", async () => {
    await salvarFormaPagamento(pixOk);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
  });

  it("ATAQUE: payload com loja_id de OUTRA loja é IGNORADO", async () => {
    await salvarFormaPagamento({ ...pixOk, loja_id: LOJA_OUTRA });
    expect(captura.insert?.loja_id).toBe(LOJA_DONO);
    expect(captura.insert?.loja_id).not.toBe(LOJA_OUTRA);
  });

  it("ATAQUE: chave pix (cpf) malformada rejeitada SEM tocar no banco", async () => {
    const r = await salvarFormaPagamento({
      tipo: "pix",
      config: { tipo_chave: "cpf", chave: "123" },
    });
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("ATAQUE: link com url inválida rejeitado SEM tocar no banco", async () => {
    const r = await salvarFormaPagamento({ tipo: "link", config: { url: "não-é-url" } });
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
  });

  it("NÃO usa service_role", async () => {
    await salvarFormaPagamento(pixOk);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("erro de banco → genérico, sem vazar e.message", async () => {
    respostaBanco = { data: null, error: { message: "senha postgres XYZ", code: "XX000" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await salvarFormaPagamento(pixOk);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});
