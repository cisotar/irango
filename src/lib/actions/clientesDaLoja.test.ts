import { describe, it, expect, vi, beforeEach } from "vitest";

const listar = vi.fn();
const buscarLoja = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ sessao: true })) }));
vi.mock("@/lib/supabase/queries/lojas", () => ({ buscarLojaDoDono: (...a: unknown[]) => buscarLoja(...a) }));
vi.mock("@/lib/supabase/queries/clientes", () => ({ listarClientesDaLoja: (...a: unknown[]) => listar(...a) }));
const listarPedidos = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  listarPedidosDoClienteNaLoja: (...a: unknown[]) => listarPedidos(...a),
}));

import { carregarMaisClientes, carregarMaisPedidosDoCliente } from "./clientesDaLoja";

const ID = "11111111-1111-1111-1111-111111111111";
const LOJA_ID = "22222222-2222-2222-2222-222222222222";
const CURSOR = { ultimo: "2026-10-02T12:00:00+00:00", id: ID };

beforeEach(() => {
  listar.mockReset().mockResolvedValue([]);
  buscarLoja.mockReset().mockResolvedValue({ id: LOJA_ID, timezone: "America/Sao_Paulo" });
  listarPedidos.mockReset().mockResolvedValue([]);
});

describe("carregarMaisClientes (346 D10)", () => {
  it("cursor válido → consulta SÓ a próxima página pelo cursor, client da sessão", async () => {
    expect(await carregarMaisClientes(CURSOR)).toEqual({ ok: true, linhas: [], cursor: null });
    expect(listar).toHaveBeenCalledWith({ sessao: true }, { limite: 50, cursor: CURSOR });
  });
  it.each([undefined, null, { id: ID }, { ultimo: CURSOR.ultimo }, { ...CURSOR, loja_id: ID }, { ...CURSOR, ultimo: "x" }])(
    "cursor inválido %j → erro genérico sem consultar",
    async (c) => {
      const r = await carregarMaisClientes(c);
      expect(r.ok).toBe(false);
      expect(listar).not.toHaveBeenCalled();
    },
  );
  it("erro do banco → só código no log, mensagem genérica", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listar.mockRejectedValue({ code: "42501", message: "detalhe interno" });
    const r = await carregarMaisClientes(CURSOR);
    expect(r).toEqual({ ok: false, erro: expect.not.stringContaining("detalhe") });
    expect(spy).toHaveBeenCalledWith("[painel/clientes] carregar mais", "42501");
    spy.mockRestore();
  });
  it("sem loja → erro genérico", async () => {
    buscarLoja.mockResolvedValue(null);
    expect((await carregarMaisClientes(CURSOR)).ok).toBe(false);
    expect(listar).not.toHaveBeenCalled();
  });
});

describe("carregarMaisClientes com filtro de aniversariantes (347)", () => {
  it("repassa o mês validado junto do cursor", async () => {
    await carregarMaisClientes(CURSOR, 3);
    expect(listar).toHaveBeenCalledWith({ sessao: true }, { mes: 3, limite: 50, cursor: CURSOR });
  });
  it.each([0, 13, 2.5, "3", "x", {}])("mês inválido %j → erro genérico sem consultar", async (m) => {
    expect((await carregarMaisClientes(CURSOR, m)).ok).toBe(false);
    expect(listar).not.toHaveBeenCalled();
  });
});

describe("carregarMaisPedidosDoCliente (347 D3)", () => {
  it("loja da SESSÃO + cliente e página validados; temMais quando veio página cheia", async () => {
    const linha = { id: "p", nome_cliente: "Pessoa Teste", total: 10, status: "entregue", criado_em: "2026-10-01T12:00:00Z", tipo_entrega: "entrega" };
    listarPedidos.mockResolvedValue(Array.from({ length: 50 }, () => linha));
    const r = await carregarMaisPedidosDoCliente(ID, 1);
    expect(r.ok && r.temMais).toBe(true);
    expect(listarPedidos).toHaveBeenCalledWith({ sessao: true }, { lojaId: LOJA_ID, clienteId: ID, pagina: 1, porPagina: 50 });
  });
  it.each([
    ["x", 1],
    [ID, 0],
    [ID, -1],
    [ID, "1"],
    [null, 1],
  ])("entrada inválida (%j, %j) → erro genérico sem consultar", async (c, p) => {
    expect((await carregarMaisPedidosDoCliente(c, p)).ok).toBe(false);
    expect(listarPedidos).not.toHaveBeenCalled();
  });
  it("erro do banco → só código no log, mensagem genérica", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listarPedidos.mockRejectedValue({ code: "42501", message: "detalhe interno" });
    const r = await carregarMaisPedidosDoCliente(ID, 1);
    expect(r).toEqual({ ok: false, erro: expect.not.stringContaining("detalhe") });
    expect(spy).toHaveBeenCalledWith("[painel/clientes] carregar mais pedidos", "42501");
    spy.mockRestore();
  });
  it("sem loja → erro genérico", async () => {
    buscarLoja.mockResolvedValue(null);
    expect((await carregarMaisPedidosDoCliente(ID, 1)).ok).toBe(false);
    expect(listarPedidos).not.toHaveBeenCalled();
  });
});
