import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock do client AUTENTICADO (server.ts é server-only; importá-lo quebra) ---
// A action DEVE usar o client autenticado (cookie/anon) para que a RLS
// `pedidos_acesso_lojista` escope por loja do auth.uid(). NÃO service_role —
// service_role faria bypass de RLS e deixaria lojista B alterar pedido de A.
//
// Modelamos um query builder encadeável de Supabase:
//   from('pedidos').select('status').eq('id', id).single()   → leitura
//   from('pedidos').update({status}).eq('id', id).select()   → escrita (RLS no WHERE)
//
// Cada teste injeta o comportamento via os mocks abaixo.

const selectResult = { data: null as unknown, error: null as unknown };
const updateResult = { data: null as unknown, error: null as unknown };

// Espiões para asserir QUE caminho foi tomado e COM quê.
const fromSpy = vi.fn();
const selectSpy = vi.fn();
const updateSpy = vi.fn();
const eqSelectSpy = vi.fn();
const eqUpdateSpy = vi.fn();

function makeFakeClient() {
  // Builder de leitura: from().select().eq().single()
  const leituraBuilder = {
    eq: (...a: unknown[]) => {
      eqSelectSpy(...a);
      return {
        single: async () => ({ data: selectResult.data, error: selectResult.error }),
      };
    },
  };
  // Builder de escrita: from().update().eq().select() → resolve uma lista (linhas afetadas)
  const escritaBuilder = {
    eq: (...a: unknown[]) => {
      eqUpdateSpy(...a);
      // Permite encadear novo .eq (ex.: .eq('id').eq('status')) e ainda resolver.
      const thenable = {
        eq: (...b: unknown[]) => {
          eqUpdateSpy(...b);
          return thenable;
        },
        select: async () => ({ data: updateResult.data, error: updateResult.error }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: updateResult.data, error: updateResult.error }),
      };
      return thenable;
    },
  };
  return {
    from: (tabela: string) => {
      fromSpy(tabela);
      return {
        select: (...a: unknown[]) => {
          selectSpy(...a);
          return leituraBuilder;
        },
        update: (...a: unknown[]) => {
          updateSpy(...a);
          return escritaBuilder;
        },
      };
    },
  };
}

let fakeClient: ReturnType<typeof makeFakeClient>;
const createClient = vi.fn(async () => fakeClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { atualizarStatusPedido } from "./status";

const PEDIDO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient = makeFakeClient();
  createClient.mockResolvedValue(fakeClient);
  selectResult.data = null;
  selectResult.error = null;
  updateResult.data = null;
  updateResult.error = null;
});

describe("atualizarStatusPedido (Server Action — orquestração + RLS)", () => {
  it("transição válida: pedido pendente → confirmado faz UPDATE e retorna ok", async () => {
    selectResult.data = { status: "pendente" };
    updateResult.data = [{ id: PEDIDO, status: "confirmado" }];

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r).toEqual({ ok: true, status: "confirmado" });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmado" }),
    );
  });

  it("usa o client AUTENTICADO (createClient), nunca service_role", async () => {
    selectResult.data = { status: "pendente" };
    updateResult.data = [{ id: PEDIDO, status: "confirmado" }];

    await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith("pedidos");
    // O UPDATE filtra por id (RLS de loja é aplicada no servidor pela política).
    expect(eqUpdateSpy).toHaveBeenCalledWith("id", PEDIDO);
  });

  it("transição inválida (salto pendente → entregue) é RECUSADA SEM UPDATE", async () => {
    selectResult.data = { status: "pendente" };

    const r = await atualizarStatusPedido(PEDIDO, "entregue");

    expect(r.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("reversão (entregue → pendente) é RECUSADA SEM UPDATE", async () => {
    selectResult.data = { status: "entregue" };

    const r = await atualizarStatusPedido(PEDIDO, "pendente");

    expect(r.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("cancelar de saiu_entrega é RECUSADO SEM UPDATE", async () => {
    selectResult.data = { status: "saiu_entrega" };

    const r = await atualizarStatusPedido(PEDIDO, "cancelado");

    expect(r.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("novoStatus fora do enum é RECUSADO SEM tocar no banco", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "voando");

    expect(r.ok).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("ATAQUE RLS: lojista B tenta pedido da loja A → leitura não casa linha → recusa", async () => {
    // A RLS pedidos_acesso_lojista filtra por dono_id=auth.uid(); o SELECT do
    // lojista B sobre o pedido da loja A volta vazio (null/PGRST116).
    selectResult.data = null;
    selectResult.error = { code: "PGRST116", message: "0 rows" };

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r.ok).toBe(false);
    // Não tenta UPDATE de pedido que nem consegue ler.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("pedido inexistente (leitura null sem erro) → recusa sem UPDATE", async () => {
    selectResult.data = null;
    selectResult.error = null;

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("UPDATE não afeta linha (RLS bloqueia escrita) → recusa, sem vazar interno", async () => {
    // Mesmo após leitura ok, a RLS WITH CHECK pode barrar (corrida/escopo):
    // UPDATE retorna lista vazia. A action não pode reportar sucesso.
    selectResult.data = { status: "pendente" };
    updateResult.data = []; // nenhuma linha afetada

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r.ok).toBe(false);
  });

  it("erro de banco na escrita → recusa + log [atualizarStatusPedido], sem vazar e.message", async () => {
    selectResult.data = { status: "pendente" };
    updateResult.data = null;
    updateResult.error = { message: "connection refused: senha postgres XYZ" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    expect(spy).toHaveBeenCalledWith(
      "[atualizarStatusPedido]",
      expect.anything(),
    );
    spy.mockRestore();
  });

  it("pedidoId não-UUID é RECUSADO SEM tocar no banco", async () => {
    const r = await atualizarStatusPedido("não-uuid", "confirmado");

    expect(r.ok).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
