import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarPedidoPorToken,
  listarPedidosDoDono,
  buscarPedidoDoDono,
} from "./pedidos";

/**
 * Fase RED (TDD) da issue 026 — Queries de `pedidos` (camada 2: contrato TS).
 *
 * Importa de `./pedidos`, cujas funções são STUBs `throw new Error('TODO: GREEN')`
 * (assinatura mínima criada na fase RED só para o type-check compilar). A asserção
 * cai vermelha porque o stub lança / não consulta a fonte. A implementação real é
 * da fase GREEN.
 *
 * O que estes testes provam (contrato que a GREEN precisa satisfazer):
 *  - cada função consulta a TABELA `pedidos` e faz join de `itens_pedido`
 *    (select com a relação aninhada);
 *  - buscarPedidoPorToken filtra por id E token_acesso (segundo fator) e usa
 *    maybeSingle → token/id errado = null. É a ÚNICA via do cliente ler pedido;
 *    é injetado com client service_role (não há SELECT anon — seguranca.md §2);
 *  - listarPedidosDoDono ordena por criado_em DESC e aplica eq('status', ...)
 *    SÓ quando o filtro é passado;
 *  - buscarPedidoDoDono filtra por id e usa maybeSingle → null em não-encontrado;
 *  - todas PROPAGAM o error do PostgREST (seguranca.md §14) — NUNCA mascaram como
 *    null/[].
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown };

/**
 * Mock encadeável do query builder do supabase-js. Registra as chamadas
 * (from/select/eq/order/maybeSingle) para asserção de fonte/filtros/join e
 * resolve o `terminal` ({ data, error }) tanto no await direto (thenable, p/
 * listagens) quanto via maybeSingle (leituras de 1 linha).
 */
function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
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
  builder.maybeSingle = (...args: unknown[]) => {
    calls.maybeSingle(...args);
    return Promise.resolve(terminal);
  };
  // thenable: permite `await from().select().eq().order()` sem maybeSingle (listagem).
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

/** Helper: o argumento do .select() inclui a relação itens_pedido (join aninhado). */
function selectPediuItens(calls: { select: ReturnType<typeof vi.fn> }): boolean {
  return calls.select.mock.calls.some((args) =>
    args.some((a) => typeof a === "string" && a.includes("itens_pedido")),
  );
}

const PEDIDO_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN_OK = "22222222-2222-2222-2222-222222222222";

describe("026 queries de pedidos — contrato TS (camada 2, mock)", () => {
  // ───────────────────────── buscarPedidoPorToken (leitura do cliente, service_role)
  it("buscarPedidoPorToken consulta a TABELA pedidos, faz join de itens e filtra por id E token", async () => {
    const row = { id: PEDIDO_ID, token_acesso: TOKEN_OK, itens_pedido: [{ id: "i1" }] };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarPedidoPorToken(client, PEDIDO_ID, TOKEN_OK);

    expect(calls.from).toHaveBeenCalledWith("pedidos");
    expect(selectPediuItens(calls)).toBe(true);
    // segundo fator: id E token_acesso (token é a "senha" do pedido)
    expect(calls.eq).toHaveBeenCalledWith("id", PEDIDO_ID);
    expect(calls.eq).toHaveBeenCalledWith("token_acesso", TOKEN_OK);
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarPedidoPorToken com token errado → null (maybeSingle não encontra a linha)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarPedidoPorToken(client, PEDIDO_ID, "token-errado");
    expect(out).toBeNull();
  });

  it("buscarPedidoPorToken PROPAGA o error do PostgREST (não mascara como null)", async () => {
    // Asserta o objeto de erro EXATO do PostgREST — distingue "propagou o error"
    // de "lançou por outro motivo" (ex.: stub não implementado). Sem isso o stub
    // que faz `throw 'TODO: GREEN'` passaria por acidente (falso verde).
    const erro = { message: "db down", code: "XX000" };
    const { client } = makeClient({ data: null, error: erro });
    await expect(buscarPedidoPorToken(client, PEDIDO_ID, TOKEN_OK)).rejects.toEqual(erro);
  });

  // ───────────────────────── listarPedidosDoDono (lojista, RLS, com itens)
  it("listarPedidosDoDono consulta a TABELA pedidos, faz join de itens e ordena por criado_em DESC", async () => {
    const rows = [{ id: PEDIDO_ID, itens_pedido: [] }];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await listarPedidosDoDono(client);

    expect(calls.from).toHaveBeenCalledWith("pedidos");
    expect(selectPediuItens(calls)).toBe(true);
    expect(calls.order).toHaveBeenCalledWith("criado_em", { ascending: false });
    expect(out).toEqual(rows);
  });

  it("listarPedidosDoDono com filtro de status aplica eq('status', ...)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await listarPedidosDoDono(client, { status: "pendente" });
    expect(calls.eq).toHaveBeenCalledWith("status", "pendente");
  });

  it("listarPedidosDoDono SEM filtro de status NÃO aplica eq('status', ...)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await listarPedidosDoDono(client);
    const filtrouStatus = calls.eq.mock.calls.some((args) => args[0] === "status");
    expect(filtrouStatus).toBe(false);
  });

  it("listarPedidosDoDono PROPAGA o error do PostgREST (não retorna [] mascarando erro)", async () => {
    const erro = { message: "rls denied", code: "42501" };
    const { client } = makeClient({ data: null, error: erro });
    await expect(listarPedidosDoDono(client)).rejects.toEqual(erro);
  });

  // ───────────────────────── buscarPedidoDoDono (lojista, um pedido + itens)
  it("buscarPedidoDoDono consulta a TABELA pedidos, faz join de itens, filtra por id e usa maybeSingle", async () => {
    const row = { id: PEDIDO_ID, itens_pedido: [{ id: "i1" }] };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarPedidoDoDono(client, PEDIDO_ID);

    expect(calls.from).toHaveBeenCalledWith("pedidos");
    expect(selectPediuItens(calls)).toBe(true);
    expect(calls.eq).toHaveBeenCalledWith("id", PEDIDO_ID);
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarPedidoDoDono retorna null quando o pedido não existe / é de outra loja (RLS) — sem lançar", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarPedidoDoDono(client, PEDIDO_ID);
    expect(out).toBeNull();
  });

  it("buscarPedidoDoDono PROPAGA o error do PostgREST", async () => {
    const erro = { message: "boom", code: "XX000" };
    const { client } = makeClient({ data: null, error: erro });
    await expect(buscarPedidoDoDono(client, PEDIDO_ID)).rejects.toEqual(erro);
  });
});
