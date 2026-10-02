import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 342 — `excluirConta` com pedido em aberto (decisão 16, RN-C14).
 * Arquivo NOVO; `cliente.test.ts` e irmãos intocados. Preâmbulo no molde de
 * `cliente.excluirConfirmacao.test.ts`.
 *
 * Contrato: o banco (`anonimizar_cliente`) recusa com uma exceção cuja mensagem contém
 * `pedido_em_aberto`. A action traduz para "Aguarde a entrega dos seus pedidos em aberto
 * para excluir a conta." — nada apagado (sem deleteUser), sessão mantida (sem signOut),
 * sem redirect. Qualquer outro erro continua genérico. A tela não pré-checa.
 *
 * Por que é RED: hoje todo erro da RPC vira `MSG_EXCLUSAO` genérica.
 */

const USER_ID = "c3420000-0000-4000-8000-0000000000ca";
const MSG_PEDIDO_ABERTO = "Aguarde a entrega dos seus pedidos em aberto para excluir a conta.";
const MSG_EXCLUSAO = "Não foi possível excluir a conta. Tente novamente.";

// ── fake PostgREST mínimo: só `papeis_usuario` é lido (buscarPapeisDoUsuario real).
let papeis: { papel: string }[] = [{ papel: "cliente" }];
function fakeFrom() {
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then")
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: papeis, error: null }).then(ok, ko);
        return () => b;
      },
    },
  );
  return b;
}

const getUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: (...a: unknown[]) => getUser(...a), signOut: (...a: unknown[]) => signOut(...a) },
      from: () => fakeFrom(),
    }),
}));
const rpc = vi.fn();
const deleteUser = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
    from: () => fakeFrom(),
  }),
}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirecionou extends Error {
  constructor(public destino: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (d: string) => {
    throw new Redirecionou(d);
  },
}));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

import { excluirConta } from "./cliente";

beforeEach(() => {
  vi.clearAllMocks();
  papeis = [{ papel: "cliente" }];
  getUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: `u-${USER_ID}@teste.local`, email_confirmed_at: "2026-01-01T00:00:00Z" } },
    error: null,
  });
  deleteUser.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("342 excluirConta — pedido em aberto (decisão 16)", () => {
  it("só-cliente com pedido em aberto → recusa com a mensagem da decisão 16; sem deleteUser, sem signOut", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "pedido_em_aberto" } });
    const r = await excluirConta({ confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: false, erro: MSG_PEDIDO_ABERTO });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("lojista+cliente com pedido em aberto → mesma recusa (vale para quem perde só o perfil)", async () => {
    papeis = [{ papel: "cliente" }, { papel: "lojista" }];
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "pedido_em_aberto" } });
    const r = await excluirConta({ confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: false, erro: MSG_PEDIDO_ABERTO });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("mensagem do banco com contexto em volta ainda é reconhecida (contém 'pedido_em_aberto')", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "anonimizar_cliente: pedido_em_aberto" },
    });
    expect(await excluirConta({ confirmacao: "EXCLUIR" })).toEqual({ ok: false, erro: MSG_PEDIDO_ABERTO });
  });

  it("outro erro do banco continua genérico (não vaza detalhe)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "erro interno qualquer" } });
    expect(await excluirConta({ confirmacao: "EXCLUIR" })).toEqual({ ok: false, erro: MSG_EXCLUSAO });
  });

  it("todos os pedidos finais (RPC ok) → exclui como no Marco B: deleteUser + signOut + redirect('/')", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(excluirConta({ confirmacao: "EXCLUIR" })).rejects.toMatchObject({ destino: "/" });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(signOut).toHaveBeenCalled();
  });
});
