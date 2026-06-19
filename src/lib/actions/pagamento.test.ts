import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// STORAGE_URL_PREFIX deriva de NEXT_PUBLIC_SUPABASE_URL em import-time; vi.hoisted
// fixa a env ANTES do import ESM (a action valida pix_qr_url via schemaStorageUrl).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

/**
 * Regressão: `atualizarFormaPagamento` deve MESCLAR a config jsonb, não
 * substituí-la. O QR Pix (`config.pix_qr_url`) é gravado por `salvarQrPix` em
 * uma escrita separada; se ao salvar a chave o update for total, o QR some do
 * banco — e some do painel e do checkout (config sem `pix_qr_url`).
 *
 * Padrão de mocks espelha cupomGestao.test.ts: client autenticado é um
 * query-builder chainable; a cadeia pós-`from` é o único objeto thenável.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111";

type Captura = {
  tabela?: string;
  update?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
};
let captura: Captura;
let respostaBanco: { data: unknown; error: unknown };

function makeChain() {
  const queryChain: Record<string, unknown> = {};
  const passthrough = (k: string) => {
    queryChain[k] = (...args: unknown[]) => {
      if (k === "eq") captura.filtros.push([args[0] as string, args[1]]);
      return queryChain;
    };
  };
  ["select", "eq", "single", "maybeSingle", "limit"].forEach(passthrough);
  queryChain.update = (row: Record<string, unknown>) => {
    captura.update = row;
    return queryChain;
  };
  queryChain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(respostaBanco).then(onF);

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

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { atualizarFormaPagamento, salvarQrPix } from "./pagamento";
import { STORAGE_URL_PREFIX } from "@/lib/validacoes/pagamento";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

const URL_QR = `${STORAGE_URL_PREFIX}pix-qr/${LOJA_DONO}/qr.png`;

beforeEach(() => {
  vi.clearAllMocks();
  captura = { filtros: [] };
  respostaBanco = { data: { config: {} }, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

describe("atualizarFormaPagamento — merge de config (regressão QR Pix)", () => {
  it("preserva pix_qr_url já salvo ao atualizar só a chave", async () => {
    // Banco já tem o QR persistido (gravado antes por salvarQrPix).
    respostaBanco = {
      data: {
        config: { tipo_chave: "telefone", chave: "5511900000000", pix_qr_url: URL_QR },
      },
      error: null,
    };

    // Form salva só chave/tipo_chave (sem pix_qr_url no payload).
    const r = await atualizarFormaPagamento("forma-1", {
      tipo: "pix",
      config: { tipo_chave: "telefone", chave: "5511988887777" },
    });

    expect(r).toEqual({ ok: true });
    const config = captura.update?.config as Record<string, unknown>;
    expect(config.pix_qr_url).toBe(URL_QR); // não pode sumir
    expect(config.chave).toBe("5511988887777"); // chave nova aplicada
  });

  it("escopa o update por id", async () => {
    await atualizarFormaPagamento("forma-1", {
      tipo: "pix",
      config: { tipo_chave: "telefone", chave: "5511988887777" },
    });
    expect(captura.tabela).toBe("formas_pagamento");
    expect(captura.filtros).toContainEqual(["id", "forma-1"]);
  });

  it("payload inválido é rejeitado SEM tocar no banco", async () => {
    const r = await atualizarFormaPagamento("forma-1", {
      tipo: "pix",
      config: { tipo_chave: "cpf", chave: "nao-eh-cpf" },
    });
    expect(r.ok).toBe(false);
    expect(captura.update).toBeUndefined();
  });
});

const URL_A = `${STORAGE_URL_PREFIX}pix-qr/${LOJA_DONO}/qr.png?v=111`;
const URL_B = `${STORAGE_URL_PREFIX}pix-qr/${LOJA_DONO}/qr.png?v=222`;

describe("salvarQrPix — troca e remoção do QR", () => {
  it("troca: grava a URL nova sobre o QR anterior (preserva chave)", async () => {
    respostaBanco = {
      data: { config: { tipo_chave: "telefone", chave: "5511900000000", pix_qr_url: URL_A } },
      error: null,
    };
    const r = await salvarQrPix("forma-1", URL_B);
    expect(r).toEqual({ ok: true });
    const config = captura.update?.config as Record<string, unknown>;
    expect(config.pix_qr_url).toBe(URL_B);
    expect(config.chave).toBe("5511900000000");
  });

  it("remoção: salvarQrPix(id, undefined) apaga pix_qr_url do config", async () => {
    respostaBanco = {
      data: { config: { tipo_chave: "telefone", chave: "5511900000000", pix_qr_url: URL_A } },
      error: null,
    };
    const r = await salvarQrPix("forma-1", undefined);
    expect(r).toEqual({ ok: true });
    const config = captura.update?.config as Record<string, unknown>;
    expect("pix_qr_url" in config).toBe(false);
    expect(config.chave).toBe("5511900000000");
  });

  it("escopa a escrita por id + loja_id + tipo='pix'", async () => {
    respostaBanco = {
      data: { config: { tipo_chave: "telefone", chave: "5511900000000" } },
      error: null,
    };
    await salvarQrPix("forma-1", URL_B);
    expect(captura.filtros).toContainEqual(["id", "forma-1"]);
    expect(captura.filtros).toContainEqual(["loja_id", LOJA_DONO]);
    expect(captura.filtros).toContainEqual(["tipo", "pix"]);
  });

  it("URL externa é rejeitada SEM tocar no banco", async () => {
    const r = await salvarQrPix("forma-1", "https://evil.com/qr.png");
    expect(r.ok).toBe(false);
    expect(captura.update).toBeUndefined();
  });
});
