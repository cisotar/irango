import { describe, it, expect, vi, beforeEach } from "vitest";

const listar = vi.fn();
const buscarLoja = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ sessao: true })) }));
vi.mock("@/lib/supabase/queries/lojas", () => ({ buscarLojaDoDono: (...a: unknown[]) => buscarLoja(...a) }));
vi.mock("@/lib/supabase/queries/clientes", () => ({ listarClientesDaLoja: (...a: unknown[]) => listar(...a) }));

import { carregarMaisClientes } from "./clientesDaLoja";

const ID = "11111111-1111-1111-1111-111111111111";
const CURSOR = { ultimo: "2026-10-02T12:00:00+00:00", id: ID };

beforeEach(() => {
  listar.mockReset().mockResolvedValue([]);
  buscarLoja.mockReset().mockResolvedValue({ timezone: "America/Sao_Paulo" });
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
