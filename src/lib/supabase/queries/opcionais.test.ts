import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
} from "./opcionais";

/**
 * Contrato de ORDENAÇÃO das leituras de opcionais do painel (issue 216).
 *
 * Por que este arquivo existe: `opcionais.ordem` é `int not null default 0`, e
 * toda linha anterior à 215 vale 0. Sem um SEGUNDO critério estável o Postgres
 * pode devolver ordens diferentes entre requisições — o SSR e o cliente
 * divergem, e o primeiro movimento na sanfona de itens (216) gravaria pela RPC
 * uma permutação que o lojista não pediu. O desempate por `id` é, portanto,
 * pré-requisito da reordenação, não polimento; e é justamente o tipo de linha
 * que some num refactor sem teste que a cobre.
 *
 * Mock: `SupabaseClient<Database>` mínimo com a cadeia
 * `from().select().eq().order()`, thenable no terminal — mesmo padrão de
 * `categorias.test.ts`.
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
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

describe("216 buscarOpcionaisDoLojista — ordem com desempate estável", () => {
  it("consulta a TABELA opcionais filtrando por loja_id", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarOpcionaisDoLojista(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("opcionais");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
  });

  it("ordena por `ordem` e DESEMPATA por `id`, nessa ordem", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarOpcionaisDoLojista(client, "loja-1");

    // A SEQUÊNCIA importa: `id` primeiro tornaria `ordem` irrelevante.
    expect(calls.order.mock.calls).toEqual([
      ["ordem", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("devolve [] sem linha e PROPAGA o error do PostgREST (§14)", async () => {
    const vazio = makeClient({ data: null, error: null });
    await expect(buscarOpcionaisDoLojista(vazio.client, "loja-1")).resolves.toEqual([]);

    const ruim = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(
      buscarOpcionaisDoLojista(ruim.client, "loja-1"),
    ).rejects.toBeTruthy();
  });
});

describe("216 buscarAssociacoesOpcional — desempate já existente (não-regressão)", () => {
  it("mantém `ordem` + `categoria_opcional_id`", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarAssociacoesOpcional(client, "loja-1");

    expect(calls.order.mock.calls).toEqual([
      ["ordem", { ascending: true }],
      ["categoria_opcional_id", { ascending: true }],
    ]);
  });
});
