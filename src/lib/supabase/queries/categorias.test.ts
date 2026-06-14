import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarCategorias } from "./categorias";

/**
 * Fase RED (TDD) da issue 024 — Queries de `categorias` (camada 2: contrato TS).
 *
 * Importa de `./categorias`, que AINDA NÃO EXISTE — a suite cai vermelha no import.
 * Para que o RED caia na ASSERÇÃO e não num erro de type-check que mascara tudo,
 * a fase RED criou um STUB MÍNIMO de assinatura em `./categorias.ts`
 * (`throw new Error('TODO: GREEN')`). A implementação real é da fase GREEN.
 *
 * O que estes testes provam (contrato que a GREEN precisa satisfazer):
 *  - consulta a TABELA `categorias` (RLS já isola: leitura pública via
 *    loja_esta_ativa, leitura própria do dono — ver seguranca.md §2);
 *  - filtra por `loja_id`;
 *  - ordena por `ordem` ascendente (vitrine mostra na ordem definida pelo lojista);
 *  - retorna `[]` quando não há linha (NÃO lança);
 *  - PROPAGA o error do PostgREST (seguranca.md §14) — NÃO mascara como [].
 *
 * Mock: SupabaseClient<Database> mínimo com a cadeia from().select().eq().order(),
 * thenable no terminal (resolve { data, error } no await direto).
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };

  const builder: Record<string, unknown> = {};

  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq(...args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    calls.order(...args);
    return builder;
  };
  // thenable: permite `await from().select().eq().order()`.
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

describe("024 queries de categorias — contrato TS (camada 2, mock)", () => {
  it("buscarCategorias consulta a TABELA categorias filtrando por loja_id", async () => {
    const rows = [{ id: "c1", loja_id: "loja-1", nome: "Bebidas", ordem: 0 }];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarCategorias(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("categorias");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    expect(out).toEqual(rows);
  });

  it("buscarCategorias ordena por `ordem` ascendente", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCategorias(client, "loja-1");

    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("buscarCategorias retorna [] quando a loja não tem categorias (sem lançar)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const out = await buscarCategorias(client, "loja-vazia");
    expect(out).toEqual([]);
  });

  it("buscarCategorias PROPAGA o error do PostgREST (não mascara como [])", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarCategorias(client, "loja-1")).rejects.toBeTruthy();
  });
});
