import { describe, it, expect, vi, beforeEach } from "vitest";

/** Bordas de `cadastrar` quanto ao papel (issue 332), além do RED. */
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

const USER_ID = "22222222-2222-2222-2222-222222222222";
const signUp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { signUp: (...a: unknown[]) => signUp(...a) } }),
}));
const rpc = vi.fn();
const deleteUser = vi.fn();
const fakeService = {
  auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
  rpc: (...a: unknown[]) => rpc(...a),
};
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeService }));
const contarLojasDoDono = vi.fn();
const slugExiste = vi.fn();
const criarLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  contarLojasDoDono: (...a: unknown[]) => contarLojasDoDono(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
}));
vi.mock("@/lib/assinatura/reconciliar", () => ({ reconciliarAssinatura: vi.fn() }));

import { cadastrar } from "./auth";

const PAYLOAD = { email: "ana@teste.com", senha: "senha1234", aceiteTermos: true as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  rpc.mockResolvedValue({ data: ["lojista"], error: null });
  contarLojasDoDono.mockResolvedValue(0);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockResolvedValue({ id: "l1" });
  deleteUser.mockResolvedValue({ error: null });
});

describe("cadastrar — papel, bordas (issue 332)", () => {
  it("rpc devolve [] → recusa como 'já cadastrado', sem criarLoja nem deleteUser", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await cadastrar(PAYLOAD);
    expect(r).toEqual({ ok: false, erro: "Este email já está cadastrado." });
    expect(criarLoja).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("rpc devolve null sem error → recusa (fail-closed)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await cadastrar(PAYLOAD);
    expect(r).toMatchObject({ ok: false });
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("['cliente','lojista'] → segue e cria a loja", async () => {
    rpc.mockResolvedValue({ data: ["cliente", "lojista"], error: null });
    expect(await cadastrar(PAYLOAD)).toEqual({ ok: true });
    expect(criarLoja).toHaveBeenCalledTimes(1);
  });

  it("rpc rejeita (rede) → mensagem genérica, sem criarLoja, sem deleteUser, sem vazar detalhe", async () => {
    rpc.mockRejectedValue(new Error("conn refused 10.0.0.1"));
    const r = await cadastrar(PAYLOAD);
    expect(r).toEqual({ ok: false, erro: "Não foi possível concluir o cadastro. Tente novamente." });
    expect(JSON.stringify(r)).not.toContain("10.0.0.1");
    expect(criarLoja).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("signUp falha → não atribui papel", async () => {
    signUp.mockResolvedValue({ data: { user: null }, error: { message: "dup" } });
    await cadastrar(PAYLOAD);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("payload inválido → não atribui papel", async () => {
    await cadastrar({ email: "x", senha: "1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("p_usuario_id vem do signUp, não de campo injetado no payload", async () => {
    await cadastrar({ ...PAYLOAD, usuario_id: "99999999-9999-4999-8999-999999999999", papel: "cliente" });
    for (const [, args] of rpc.mock.calls) {
      expect(args).toEqual({ p_usuario_id: USER_ID, p_papel: "lojista" });
    }
  });

  it("criarLoja falhar APÓS o papel ainda compensa com deleteUser (usuário novo)", async () => {
    criarLoja.mockRejectedValue(new Error("falha"));
    const r = await cadastrar(PAYLOAD);
    expect(r).toMatchObject({ ok: false });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
  });
});

/**
 * Issue 334, fatia B: CARACTERIZAÇÃO (verde desde já, sem mudança de produção).
 * Com "Confirm email" ON, `signUp` de e-mail já cadastrado e ainda não confirmado
 * devolve a conta EXISTENTE (id real, `identities` não vazio), sem erro. Estes
 * casos travam o que `cadastrar` faz hoje nesse cenário.
 */
describe("cadastrar — conta existente não confirmada (issue 334)", () => {
  const ID_EXISTENTE = "33400000-0000-4000-8000-0000000000b1";

  beforeEach(() => {
    signUp.mockResolvedValue({
      data: { user: { id: ID_EXISTENTE, email_confirmed_at: null, identities: [{ id: "x" }] } },
      error: null,
    });
  });

  it("conta só-cliente → recusa 'já cadastrado', sem criarLoja nem deleteUser; rpc com o id do signUp", async () => {
    rpc.mockResolvedValue({ data: ["cliente"], error: null });
    const r = await cadastrar(PAYLOAD);
    expect(r).toEqual({ ok: false, erro: "Este email já está cadastrado." });
    expect(criarLoja).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toEqual({ p_usuario_id: ID_EXISTENTE, p_papel: "lojista" });
  });

  it("conta lojista que já tem loja → recusa 'já cadastrado', sem criarLoja nem deleteUser", async () => {
    rpc.mockResolvedValue({ data: ["lojista"], error: null });
    contarLojasDoDono.mockResolvedValue(1);
    const r = await cadastrar(PAYLOAD);
    expect(r).toEqual({ ok: false, erro: "Este email já está cadastrado." });
    expect(criarLoja).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("conta sem papel → ok e cria a loja — risco aceito na issue 334: papel decidido antes da posse do e-mail (ADR §5 item 1)", async () => {
    rpc.mockResolvedValue({ data: ["lojista"], error: null }); // gravado agora
    contarLojasDoDono.mockResolvedValue(0);
    const r = await cadastrar(PAYLOAD);
    expect(r).toEqual({ ok: true });
    expect(criarLoja).toHaveBeenCalledTimes(1);
    expect(criarLoja.mock.calls[0][1]).toMatchObject({ dono_id: ID_EXISTENTE });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
