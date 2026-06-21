import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { aplicarStatusAdmin } from "./adminAssinatura";

/**
 * Fase RED (TDD) da issue 080 — query `aplicarStatusAdmin`.
 *
 * Importa de `./adminAssinatura`, cujo corpo é STUB (`throw 'TODO: GREEN'`).
 * TODA expectativa abaixo FALHA hoje — RED. A GREEN implementa o UPDATE.
 *
 * Contrato provado (D-2 / Contratos de Dados da issue):
 *  - escreve na tabela `lojas`, escopado por `.eq("id", lojaId)`;
 *  - patch contém `assinatura_status` = status passado;
 *  - patch SEMPRE seta `assinatura_atualizada_em` (auditoria);
 *  - `fimPeriodo: null`  → `assinatura_fim_periodo` = null (cortesia);
 *  - `fimPeriodo: Date`  → `assinatura_fim_periodo` = ISO desse instante (corte);
 *  - retorna nº de linhas afetadas (0 = loja inexistente, sem vazar).
 *
 * Mock: query builder encadeável `from().update().eq()` thenável, capturando a
 * tabela, o patch e os filtros. O terminal resolve `{ error, count }`.
 */

type Client = SupabaseClient<Database>;

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

type Captura = {
  tabela?: string;
  update?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
};
let cap: Captura;
let terminal: { error: unknown; count: number | null };

function makeClient(): Client {
  const builder: Record<string, unknown> = {};
  builder.update = (row: Record<string, unknown>) => {
    cap.update = row;
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    cap.filtros.push([col, val]);
    return builder;
  };
  builder.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(terminal).then(onF);
  return {
    from: (tabela: string) => {
      cap.tabela = tabela;
      return builder;
    },
  } as unknown as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
  cap = { filtros: [] };
  terminal = { error: null, count: 1 };
});

describe("aplicarStatusAdmin — fase RED issue 080", () => {
  it("concederCortesia: status='cortesia' + fim_periodo=null, escopado por id", async () => {
    await aplicarStatusAdmin(makeClient(), LOJA_ID, "cortesia", null);

    expect(cap.tabela).toBe("lojas");
    expect(cap.update).toMatchObject({
      assinatura_status: "cortesia",
      assinatura_fim_periodo: null,
    });
    expect(cap.update?.assinatura_atualizada_em).toEqual(expect.any(String));
    expect(cap.filtros).toContainEqual(["id", LOJA_ID]);
  });

  it("suspenderLoja: status='suspensa' + fim_periodo = ISO do corte", async () => {
    const corte = new Date("2026-06-21T12:00:00.000Z");
    await aplicarStatusAdmin(makeClient(), LOJA_ID, "suspensa", corte);

    expect(cap.tabela).toBe("lojas");
    expect(cap.update).toMatchObject({
      assinatura_status: "suspensa",
      assinatura_fim_periodo: corte.toISOString(),
    });
    expect(cap.filtros).toContainEqual(["id", LOJA_ID]);
  });

  it("retorna { linhasAfetadas: 0 } quando a loja não existe (count=0)", async () => {
    terminal = { error: null, count: 0 };
    const r = await aplicarStatusAdmin(makeClient(), LOJA_ID, "ativa", undefined);
    expect(r).toEqual({ linhasAfetadas: 0 });
  });
});
