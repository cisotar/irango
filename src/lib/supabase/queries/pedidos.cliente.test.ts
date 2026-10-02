import { describe, it, expect } from "vitest";
import * as pedidosMod from "./pedidos";

/**
 * Fase RED (TDD) da issue 342 — queries novas de `pedidos` para o cliente.
 * Arquivo NOVO; `pedidos.test.ts` intocado.
 *
 * Contrato (alvo: `src/lib/supabase/queries/pedidos.ts`):
 *  - `listarPedidosDoCliente(client, clienteId, pagina = 0)`: client da SESSÃO;
 *    select SÓ `id, loja_id, status, total, criado_em, token_acesso` + `lojas(nome, slug)`;
 *    `.eq("cliente_id", clienteId)` EXPLÍCITO (RLS soma por OR: lojista+cliente também lê os
 *    pedidos da própria loja — sem o filtro, o histórico mostraria pedidos de terceiros);
 *    `order criado_em desc`; 20 por página via `.range(p*20, p*20+19)`; propaga `error`.
 *  - `contarUsosCupomDoCliente(svc, { lojaId, clienteId, codigo })`: `count` exato com
 *    `head: true`, filtrando `loja_id`, `cliente_id`, `cupom_codigo` (TODOS os status — RN-C06);
 *    propaga `error`.
 *
 * Por que é RED: as funções não existem (acesso por chave no namespace, sem stub).
 */

type Chamada = { metodo: string; args: unknown[] };
type Terminal = { data?: unknown; error?: unknown; count?: number | null };

function fakeClient(terminal: Terminal) {
  const chamadas: Chamada[] = [];
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then")
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: terminal.data ?? null, error: terminal.error ?? null, count: terminal.count ?? null }).then(ok, ko);
        return (...args: unknown[]) => {
          chamadas.push({ metodo: String(p), args });
          return b;
        };
      },
    },
  );
  const client = { from: (...args: unknown[]) => (chamadas.push({ metodo: "from", args }), b) };
  return { client, chamadas };
}

function fn(nome: string): (...a: unknown[]) => Promise<unknown> {
  const f = (pedidosMod as unknown as Record<string, unknown>)[nome];
  if (typeof f !== "function") throw new Error(`[RED 342] ${nome} não existe em queries/pedidos.ts (P28 cria).`);
  return f as (...a: unknown[]) => Promise<unknown>;
}

const CLIENTE = "c3420000-0000-4000-8000-0000000000ca";
const LOJA = "11111111-1111-1111-1111-111111111111";

function args(chamadas: Chamada[], metodo: string): unknown[][] {
  return chamadas.filter((c) => c.metodo === metodo).map((c) => c.args);
}

describe("342 listarPedidosDoCliente", () => {
  it("lê de pedidos, só as colunas do histórico + lojas(nome, slug)", async () => {
    const { client, chamadas } = fakeClient({ data: [] });
    await fn("listarPedidosDoCliente")(client, CLIENTE);
    expect(args(chamadas, "from")).toEqual([["pedidos"]]);
    const sel = String(args(chamadas, "select")[0]?.[0] ?? "").replace(/\s+/g, "");
    for (const col of ["id", "loja_id", "status", "total", "criado_em", "token_acesso", "lojas(nome,slug)"]) {
      expect(sel).toContain(col);
    }
    // Nada de PII nem itens no histórico.
    for (const proibida of ["nome_cliente", "telefone_cliente", "endereco_entrega", "observacoes", "itens_pedido", "*"]) {
      expect(sel).not.toContain(proibida);
    }
  });

  it("filtra cliente_id EXPLICITAMENTE (lojista+cliente não vê pedidos da própria loja no histórico)", async () => {
    const { client, chamadas } = fakeClient({ data: [] });
    await fn("listarPedidosDoCliente")(client, CLIENTE);
    expect(args(chamadas, "eq")).toContainEqual(["cliente_id", CLIENTE]);
  });

  it("ordena por criado_em desc e pagina 20 por página (página 0 → 0..19; página 2 → 40..59)", async () => {
    const a = fakeClient({ data: [] });
    await fn("listarPedidosDoCliente")(a.client, CLIENTE);
    expect(args(a.chamadas, "order")).toContainEqual(["criado_em", { ascending: false }]);
    expect(args(a.chamadas, "range")).toEqual([[0, 19]]);
    const b = fakeClient({ data: [] });
    await fn("listarPedidosDoCliente")(b.client, CLIENTE, 2);
    expect(args(b.chamadas, "range")).toEqual([[40, 59]]);
  });

  it("devolve as linhas; data null → []", async () => {
    const linha = { id: "p1", loja_id: LOJA, status: "entregue", total: 50, criado_em: "x", token_acesso: "t", lojas: { nome: "L", slug: "l" } };
    expect(await fn("listarPedidosDoCliente")(fakeClient({ data: [linha] }).client, CLIENTE)).toEqual([linha]);
    expect(await fn("listarPedidosDoCliente")(fakeClient({ data: null }).client, CLIENTE)).toEqual([]);
  });

  it("propaga o error do PostgREST (não mascara como [])", async () => {
    const erro = { message: "boom", code: "XX000" };
    await expect(fn("listarPedidosDoCliente")(fakeClient({ error: erro }).client, CLIENTE)).rejects.toBe(erro);
  });
});

describe("342 contarUsosCupomDoCliente", () => {
  it("count exato head:true, filtrando loja_id + cliente_id + cupom_codigo; devolve o número", async () => {
    const { client, chamadas } = fakeClient({ count: 3 });
    const n = await fn("contarUsosCupomDoCliente")(client, { lojaId: LOJA, clienteId: CLIENTE, codigo: "PROMO5" });
    expect(n).toBe(3);
    expect(args(chamadas, "from")).toEqual([["pedidos"]]);
    expect(args(chamadas, "select")[0]?.[1]).toMatchObject({ count: "exact", head: true });
    const eqs = args(chamadas, "eq");
    expect(eqs).toContainEqual(["loja_id", LOJA]);
    expect(eqs).toContainEqual(["cliente_id", CLIENTE]);
    expect(eqs).toContainEqual(["cupom_codigo", "PROMO5"]);
    // Todos os status contam (RN-C06): nenhum filtro de status.
    expect(eqs.some((e) => e[0] === "status")).toBe(false);
    expect(args(chamadas, "neq")).toEqual([]);
    expect(args(chamadas, "in")).toEqual([]);
  });

  it("count null → 0", async () => {
    expect(await fn("contarUsosCupomDoCliente")(fakeClient({ count: null }).client, { lojaId: LOJA, clienteId: CLIENTE, codigo: "X1Y" })).toBe(0);
  });

  it("propaga o error", async () => {
    const erro = { message: "boom" };
    await expect(
      fn("contarUsosCupomDoCliente")(fakeClient({ error: erro }).client, { lojaId: LOJA, clienteId: CLIENTE, codigo: "X1Y" }),
    ).rejects.toBe(erro);
  });
});
