import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listarPedidosDoClienteNaLoja } from "./pedidos";

// Issue 347: pedidos do detalhe do cliente — RLS do lojista + loja da sessão +
// cliente_id, todos os status, mais recente primeiro, paginado.

type Chamada = { metodo: string; args: unknown[] };
function fakeClient(terminal: { data?: unknown; error?: unknown }) {
  const chamadas: Chamada[] = [];
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then")
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: terminal.data ?? null, error: terminal.error ?? null }).then(ok, ko);
        return (...args: unknown[]) => {
          chamadas.push({ metodo: String(p), args });
          return b;
        };
      },
    },
  );
  const client = { from: (...args: unknown[]) => (chamadas.push({ metodo: "from", args }), b) };
  return { client: client as unknown as SupabaseClient<Database>, chamadas };
}
const args = (c: Chamada[], m: string) => c.filter((x) => x.metodo === m).map((x) => x.args);

const LOJA = "11111111-1111-1111-1111-111111111111";
const CLIENTE = "22222222-2222-2222-2222-222222222222";

describe("listarPedidosDoClienteNaLoja (347)", () => {
  it("filtra loja_id E cliente_id, sem filtro de status, ordem desc e 1ª página de 50", async () => {
    const { client, chamadas } = fakeClient({ data: [{ id: "p" }] });
    expect(await listarPedidosDoClienteNaLoja(client, { lojaId: LOJA, clienteId: CLIENTE, porPagina: 50 })).toEqual([{ id: "p" }]);
    expect(args(chamadas, "from")).toEqual([["pedidos"]]);
    expect(args(chamadas, "eq")).toEqual([["loja_id", LOJA], ["cliente_id", CLIENTE]]);
    expect(args(chamadas, "order")).toEqual([["criado_em", { ascending: false }], ["id", { ascending: false }]]);
    expect(args(chamadas, "range")).toEqual([[0, 49]]);
    const sel = String(args(chamadas, "select")[0][0]);
    for (const proibida of ["telefone_cliente", "endereco_entrega", "itens_pedido", "*"]) expect(sel).not.toContain(proibida);
  });
  it("página 2 → range(100, 149)", async () => {
    const { client, chamadas } = fakeClient({ data: [] });
    await listarPedidosDoClienteNaLoja(client, { lojaId: LOJA, clienteId: CLIENTE, pagina: 2, porPagina: 50 });
    expect(args(chamadas, "range")).toEqual([[100, 149]]);
  });
  it("id fora do formato uuid → [] sem tocar o banco", async () => {
    const { client, chamadas } = fakeClient({ data: [] });
    expect(await listarPedidosDoClienteNaLoja(client, { lojaId: LOJA, clienteId: "x", porPagina: 50 })).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
  it("propaga o error", async () => {
    const erro = { code: "42501" };
    const { client } = fakeClient({ error: erro });
    await expect(listarPedidosDoClienteNaLoja(client, { lojaId: LOJA, clienteId: CLIENTE, porPagina: 50 })).rejects.toBe(erro);
  });
});
