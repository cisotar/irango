import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarCatalogoPublico,
  buscarProdutosDoLojista,
  buscarProdutosPorIds,
} from "./produtos";

/**
 * Fase RED (TDD) da issue 024 — Queries de `produtos` (camada 2: contrato TS).
 *
 * Importa de `./produtos`, que AINDA NÃO EXISTE — a suite cai vermelha no import.
 * STUB MÍNIMO de assinatura criado em `./produtos.ts` (`throw new Error('TODO: GREEN')`)
 * para que o RED caia na ASSERÇÃO e não num erro de type-check que mascara tudo.
 * A implementação real é da fase GREEN.
 *
 * Contrato que a GREEN precisa satisfazer:
 *  - buscarCatalogoPublico: fonte TABELA `produtos`, filtra `loja_id` + `disponivel = true`
 *    (defesa em profundidade — a RLS produtos_leitura_publica já filtra, mas o filtro
 *    explícito documenta intenção), ordena por `ordem`, e AGRUPA por categoria com
 *    produtos sem categoria caindo num grupo "Outros" no FIM (critério de aceite).
 *  - buscarProdutosDoLojista: fonte TABELA `produtos`, filtra `loja_id`, traz categoria
 *    ANINHADA (select com join `categorias(...)`), inclui indisponíveis (sem filtro
 *    `disponivel`), ordena por `ordem`.
 *  - buscarProdutosPorIds: insumo do recálculo autoritativo (seguranca.md §10) — filtra
 *    por lista de ids (`in`), retorna preco/disponivel/loja_id REAIS. SEM filtro
 *    `disponivel` (o recálculo precisa enxergar item indisponível para RECUSÁ-LO).
 *  - todas: retornam []/agrupamento vazio em "sem linha", PROPAGAM error (§14).
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
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
  builder.in = (...args: unknown[]) => {
    calls.in(...args);
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

// ───────────────────────── buscarCatalogoPublico
describe("024 buscarCatalogoPublico — contrato TS (camada 2, mock)", () => {
  it("consulta a TABELA produtos filtrando por loja_id e disponivel=true, ordenado por ordem", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCatalogoPublico(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("produtos");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    expect(calls.eq).toHaveBeenCalledWith("disponivel", true);
    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("agrupa produtos por categoria e mantém a ordem das categorias", async () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Suco", preco: 7, disponivel: true, ordem: 1 },
      { id: "p3", loja_id: "loja-1", categoria_id: "cat-lanches", nome: "X-Burguer", preco: 20, disponivel: true, ordem: 0 },
    ];
    // Categorias do lojista, na ordem definida.
    const categorias = [
      { id: "cat-lanches", loja_id: "loja-1", nome: "Lanches", ordem: 0, criado_em: "2026-01-01T00:00:00Z" },
      { id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 1, criado_em: "2026-01-01T00:00:00Z" },
    ];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    // Espera-se uma estrutura agrupada e ordenada pela ordem das categorias.
    expect(grupos.map((g) => g.categoria?.nome ?? g.nome)).toEqual(["Lanches", "Bebidas"]);
    const lanches = grupos.find((g) => (g.categoria?.id ?? g.id) === "cat-lanches")!;
    const bebidas = grupos.find((g) => (g.categoria?.id ?? g.id) === "cat-bebidas")!;
    expect(lanches.produtos.map((p) => p.id)).toEqual(["p3"]);
    expect(bebidas.produtos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it('produtos SEM categoria caem no grupo "Outros" e ele fica POR ÚLTIMO', async () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p9", loja_id: "loja-1", categoria_id: null, nome: "Brinde", preco: 0, disponivel: true, ordem: 0 },
    ];
    const categorias = [{ id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 0, criado_em: "2026-01-01T00:00:00Z" }];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    const ultimo = grupos[grupos.length - 1];
    expect(ultimo.nome ?? ultimo.categoria?.nome).toBe("Outros");
    expect(ultimo.produtos.map((p) => p.id)).toEqual(["p9"]);
  });

  it("PROPAGA o error do PostgREST (não mascara como agrupamento vazio)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarCatalogoPublico(client, "loja-1")).rejects.toBeTruthy();
  });
});

// ───────────────────────── buscarProdutosDoLojista
describe("024 buscarProdutosDoLojista — contrato TS (camada 2, mock)", () => {
  it("consulta a TABELA produtos, filtra por loja_id e traz a categoria ANINHADA no select", async () => {
    const rows = [
      { id: "p1", loja_id: "loja-1", nome: "Coca", disponivel: false, ordem: 0, categorias: { id: "c1", nome: "Bebidas" } },
    ];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarProdutosDoLojista(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("produtos");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    // O select precisa pedir a categoria aninhada (join PostgREST).
    const selectArg = String(calls.select.mock.calls[0]?.[0] ?? "");
    expect(selectArg).toContain("categorias");
    expect(out).toEqual(rows);
  });

  it("inclui produtos INDISPONÍVEIS (NÃO filtra disponivel)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosDoLojista(client, "loja-1");
    expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true);
  });

  it("ordena por `ordem` ascendente", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosDoLojista(client, "loja-1");
    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(buscarProdutosDoLojista(client, "loja-1")).rejects.toBeTruthy();
  });
});

// ───────────────────────── buscarProdutosPorIds (insumo do recálculo §10)
describe("024 buscarProdutosPorIds — contrato TS (camada 2, mock)", () => {
  it("filtra por lista de ids (in) e retorna preco/disponivel/loja_id reais", async () => {
    const rows = [
      { id: "p1", loja_id: "loja-1", preco: 12.5, disponivel: true },
      { id: "p2", loja_id: "loja-1", preco: 8, disponivel: false },
    ];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarProdutosPorIds(client, ["p1", "p2"]);

    expect(calls.from).toHaveBeenCalledWith("produtos");
    expect(calls.in).toHaveBeenCalledWith("id", ["p1", "p2"]);
    expect(out).toEqual(rows);
  });

  it("NÃO filtra por disponivel (recálculo precisa ver indisponível para recusá-lo)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosPorIds(client, ["p1"]);
    expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true);
  });

  it("retorna [] quando recebe lista de ids vazia (não consulta o banco)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    const out = await buscarProdutosPorIds(client, []);
    expect(out).toEqual([]);
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("PROPAGA o error do PostgREST (não mascara como [])", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(buscarProdutosPorIds(client, ["p1"])).rejects.toBeTruthy();
  });
});
