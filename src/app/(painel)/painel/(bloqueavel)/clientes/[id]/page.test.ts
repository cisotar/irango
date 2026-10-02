import { describe, it, expect, vi, beforeEach } from "vitest";

// Issue 347: o detalhe é a superfície de IDOR. id não-UUID → 404 sem banco;
// id inexistente e id de cliente de OUTRA loja → a MESMA resposta 404 (a função
// `cliente_da_loja` devolve 0 linhas nos dois casos).

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFound("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
const createClient = vi.fn(async () => ({ sessao: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
const buscarLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({ buscarLojaDoDono: (...a: unknown[]) => buscarLoja(...a) }));
const buscarCliente = vi.fn();
vi.mock("@/lib/supabase/queries/clientes", () => ({ buscarClienteDaLoja: (...a: unknown[]) => buscarCliente(...a) }));
const listarPedidos = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  listarPedidosDoClienteNaLoja: (...a: unknown[]) => listarPedidos(...a),
}));

import DetalheClientePage from "./page";

const LOJA = { id: "22222222-2222-2222-2222-222222222222", timezone: "America/Sao_Paulo" };
const DE_OUTRA_LOJA = "33333333-3333-3333-3333-333333333333";
const INEXISTENTE = "44444444-4444-4444-4444-444444444444";
const DA_BASE = "11111111-1111-1111-1111-111111111111";

const abrir = (id: string) => DetalheClientePage({ params: Promise.resolve({ id }) });

async function resposta(id: string): Promise<string> {
  try {
    await abrir(id);
    return "renderizou";
  } catch (e) {
    return e instanceof NotFound ? `404:${e.message}` : `outro:${String(e)}`;
  }
}

beforeEach(() => {
  createClient.mockClear();
  buscarLoja.mockReset().mockResolvedValue(LOJA);
  buscarCliente.mockReset().mockResolvedValue(null);
  listarPedidos.mockReset().mockResolvedValue([]);
});

describe("/painel/clientes/[id] (347)", () => {
  it.each(["abc", "1", "' or 1=1 --", "11111111-1111-1111-1111-11111111111"])(
    "id não-UUID %j → 404 sem bater no banco",
    async (id) => {
      expect(await resposta(id)).toBe("404:NEXT_NOT_FOUND");
      expect(createClient).not.toHaveBeenCalled();
      expect(buscarCliente).not.toHaveBeenCalled();
      expect(listarPedidos).not.toHaveBeenCalled();
    },
  );

  it("id de outra loja e id inexistente → MESMA resposta 404, sem ler pedidos", async () => {
    const alheio = await resposta(DE_OUTRA_LOJA);
    const inexistente = await resposta(INEXISTENTE);
    expect(alheio).toBe("404:NEXT_NOT_FOUND");
    expect(inexistente).toBe(alheio);
    expect(buscarCliente.mock.calls.map((c) => c[1])).toEqual([DE_OUTRA_LOJA, INEXISTENTE]);
    expect(listarPedidos).not.toHaveBeenCalled();
  });

  it("cliente da base → lê pedidos pela loja da SESSÃO e o cliente_id da rota", async () => {
    buscarCliente.mockResolvedValue({
      cliente_id: DA_BASE,
      nome: "Pessoa Teste",
      telefone: "",
      dia_aniversario: 1,
      mes_aniversario: 2,
      aceita_marketing: false,
      total_pedidos: 1,
      total_cancelados: 0,
      ultimo_pedido_em: null,
      ultimo_pedido_status: null,
    });
    expect(await resposta(DA_BASE)).toBe("renderizou");
    expect(listarPedidos).toHaveBeenCalledWith({ sessao: true }, { lojaId: LOJA.id, clienteId: DA_BASE, porPagina: 50 });
  });

  it("erro da consulta propaga (error boundary do Next; nada de 404 enganoso)", async () => {
    buscarCliente.mockRejectedValue({ code: "XX000" });
    await expect(abrir(DA_BASE)).rejects.toEqual({ code: "XX000" });
  });
});
