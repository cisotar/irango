import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
  buscarOcultosPorProdutos,
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

// ═══════════════════════════════════════════════════════════════════════════
// [331] A1 (auditoria) — `buscarOcultosPorProdutos` é a leitura AUTORITATIVA do
// pedido (D1). O PostgREST corta o resultado em `max_rows` (config.toml, 1000,
// vale também para service_role) sem erro: uma linha oculta cortada faria
// `idsPermitidosDoProduto` LIBERAR o adicional. A query pede `count: "exact"` e
// recusa (lança) quando o total do banco não coube na resposta — fail-closed.
// ═══════════════════════════════════════════════════════════════════════════

type TerminalContado = { data: unknown; error: unknown; count: number | null };

/** Cadeia `from().select(cols, opts).in()` thenable — devolve `count` como o supabase-js. */
function makeClientContado(terminal: TerminalContado) {
  const calls = { from: vi.fn(), select: vi.fn(), in: vi.fn() };
  const builder: Record<string, unknown> = {};
  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.in = (...args: unknown[]) => {
    calls.in(...args);
    return builder;
  };
  builder.then = (resolve: (v: TerminalContado) => unknown) => resolve(terminal);
  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;
  return { client, calls };
}

describe("[331] buscarOcultosPorProdutos — resultado cortado por max_rows é recusado", () => {
  const P1 = "aaaaaaaa-0000-0000-0000-000000000001";
  const G1 = "eeeeeeee-0000-0000-0000-000000000001";
  const linha = { produto_id: P1, categoria_opcional_id: G1 };

  it("pede a contagem EXATA ao PostgREST", async () => {
    const { client, calls } = makeClientContado({ data: [linha], error: null, count: 1 });
    await expect(buscarOcultosPorProdutos(client, [P1])).resolves.toEqual([linha]);
    expect(calls.from).toHaveBeenCalledWith("produto_opcionais_ocultos");
    expect(calls.select.mock.calls[0][1]).toEqual(expect.objectContaining({ count: "exact" }));
    expect(calls.in).toHaveBeenCalledWith("produto_id", [P1]);
  });

  it("count MAIOR que as linhas devolvidas (corte do max_rows) → LANÇA, nunca devolve a lista parcial", async () => {
    // O banco tem 1 linha oculta; a resposta veio sem ela.
    const { client } = makeClientContado({ data: [], error: null, count: 1 });
    await expect(buscarOcultosPorProdutos(client, [P1])).rejects.toBeTruthy();
  });

  it("count ausente (sem como provar que veio tudo) → LANÇA (fail-closed)", async () => {
    const { client } = makeClientContado({ data: [linha], error: null, count: null });
    await expect(buscarOcultosPorProdutos(client, [P1])).rejects.toBeTruthy();
  });

  it("lista de produtos vazia continua sem ir ao banco", async () => {
    const { client, calls } = makeClientContado({ data: [], error: null, count: 0 });
    await expect(buscarOcultosPorProdutos(client, [])).resolves.toEqual([]);
    expect(calls.from).not.toHaveBeenCalled();
  });
});
