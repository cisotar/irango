import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 366, fatia F2b: `confirmarNovaSenha` (porta lojista).
 * Spec: specs/recuperacao-senha-self-service.md (D1, D2, RN-03, RN-04, RN-05,
 * RN-07, RN-08, RN-11).
 *
 * Contrato travado aqui:
 *  - rate limit por IP com a chave `novaSenhaLojista`;
 *  - payload `.strict()` `{ senha, confirmacao }` (8–72, iguais); `next`,
 *    `user_id` e `email` recusados;
 *  - `getUser()` + `getClaims()` com `amr` contendo `recovery`; qualquer outra
 *    sessão (ou nenhuma) → recusa SEM `updateUser` e SEM `signOut`;
 *  - `updateUser({ password })` e SÓ DEPOIS dele ok `signOut({ scope: "global" })`;
 *  - falha do `signOut` → ainda `ok: true`, log com a tag `[confirmarNovaSenha] signOut`;
 *  - sucesso → `{ ok: true, destino: "/login?redefinida=1" }`;
 *  - `weak_password` / `same_password` → mensagens literais de RN-11;
 *  - senha nunca em `console.error`.
 * Mocks só de fronteira: Supabase, next/headers, rate limit. Dados fictícios.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SENHA = "SenhaFicticia#366";
const DESTINO = "/login?redefinida=1";
const TAG_SIGNOUT = "[confirmarNovaSenha] signOut";

const getUser = vi.fn();
const getClaims = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: (...a: unknown[]) => getUser(...a),
        getClaims: (...a: unknown[]) => getClaims(...a),
        updateUser: (...a: unknown[]) => updateUser(...a),
        signOut: (...a: unknown[]) => signOut(...a),
      },
    }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

import { confirmarNovaSenha } from "@/lib/actions/recuperacaoSenha";

const payload = (extra: Record<string, unknown> = {}) => ({ senha: SENHA, confirmacao: SENHA, ...extra });
const claims = (amr: unknown) => ({ data: { claims: { sub: USER_ID, amr } }, error: null });
const RECOVERY = [{ method: "recovery", timestamp: 1 }];
const logs = () => JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
const nadaTrocado = () => {
  expect(updateUser).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  verificarRateLimit.mockResolvedValue({ permitido: true });
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  getClaims.mockResolvedValue(claims(RECOVERY));
  updateUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("confirmarNovaSenha — só sessão de recuperação troca a senha (D1/RN-05)", () => {
  it("sem sessão (getUser sem user) → ok:false, sem updateUser e sem signOut", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } });
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    nadaTrocado();
  });

  it("sessão de login por senha (amr password) → ok:false, sem updateUser e sem signOut", async () => {
    getClaims.mockResolvedValue(claims([{ method: "password", timestamp: 1 }]));
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    nadaTrocado();
  });

  it("sessão de login Google (amr oauth) → ok:false, sem updateUser e sem signOut", async () => {
    getClaims.mockResolvedValue(claims([{ method: "oauth", timestamp: 1 }]));
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    nadaTrocado();
  });

  it("getClaims com erro → ok:false, sem updateUser e sem signOut", async () => {
    getClaims.mockResolvedValue({ data: null, error: { name: "AuthInvalidJwtError", status: 401 } });
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    nadaTrocado();
  });

  it("claims sem amr → ok:false, sem updateUser e sem signOut", async () => {
    getClaims.mockResolvedValue(claims(undefined));
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    nadaTrocado();
  });
});

describe("confirmarNovaSenha — troca e encerramento global (D2/RN-08)", () => {
  it("recovery → updateUser({ password }) e signOut({ scope: 'global' }) e destino /login?redefinida=1", async () => {
    expect(await confirmarNovaSenha(payload())).toStrictEqual({ ok: true, destino: DESTINO });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: SENHA });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("updateUser acontece ANTES de signOut (invocationCallOrder)", async () => {
    await confirmarNovaSenha(payload());
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("updateUser falha → ok:false e signOut NÃO chamado", async () => {
    updateUser.mockResolvedValue({ data: null, error: { status: 500, code: "unexpected_failure", name: "AuthApiError" } });
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("updateUser lança → ok:false e signOut NÃO chamado", async () => {
    updateUser.mockRejectedValue(new Error("rede"));
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signOut devolve erro → ainda { ok: true, destino } e log com a tag própria", async () => {
    signOut.mockResolvedValue({ error: { status: 500, code: "unexpected_failure", name: "AuthApiError" } });
    expect(await confirmarNovaSenha(payload())).toStrictEqual({ ok: true, destino: DESTINO });
    const tags = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]);
    expect(tags).toContain(TAG_SIGNOUT);
  });

  it("signOut lança → ainda { ok: true, destino } e log com a tag própria", async () => {
    signOut.mockRejectedValue(new Error("rede"));
    expect(await confirmarNovaSenha(payload())).toStrictEqual({ ok: true, destino: DESTINO });
    const tags = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]);
    expect(tags).toContain(TAG_SIGNOUT);
  });
});

describe("confirmarNovaSenha — erros do GoTrue com instrução (RN-11)", () => {
  it("weak_password → 'Escolha uma senha mais forte.' e sem signOut", async () => {
    updateUser.mockResolvedValue({ data: null, error: { status: 422, code: "weak_password", name: "AuthWeakPasswordError" } });
    expect(await confirmarNovaSenha(payload())).toStrictEqual({ ok: false, erro: "Escolha uma senha mais forte." });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("same_password → 'Escolha uma senha diferente da anterior.' e sem signOut", async () => {
    updateUser.mockResolvedValue({ data: null, error: { status: 422, code: "same_password", name: "AuthApiError" } });
    expect(await confirmarNovaSenha(payload())).toStrictEqual({
      ok: false,
      erro: "Escolha uma senha diferente da anterior.",
    });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("confirmarNovaSenha — payload .strict() e senha 8–72 (RN-04/RN-07)", () => {
  it.each([
    ["next", { next: "/painel" }],
    ["user_id", { user_id: "22222222-2222-4222-8222-222222222222" }],
    ["email", { email: "outra.pessoa@exemplo.test" }],
  ])("campo extra %s → ok:false, sem updateUser e sem signOut", async (_nome, extra) => {
    expect((await confirmarNovaSenha(payload(extra))).ok).toBe(false);
    nadaTrocado();
  });

  it("confirmação diferente → ok:false, sem updateUser", async () => {
    expect((await confirmarNovaSenha({ senha: SENHA, confirmacao: `${SENHA}x` })).ok).toBe(false);
    nadaTrocado();
  });

  it("senha com 7 caracteres → ok:false; com 73 → ok:false", async () => {
    expect((await confirmarNovaSenha({ senha: "Abc1234", confirmacao: "Abc1234" })).ok).toBe(false);
    const longa = "a".repeat(73);
    expect((await confirmarNovaSenha({ senha: longa, confirmacao: longa })).ok).toBe(false);
    nadaTrocado();
  });

  it("senha com 8 caracteres é aceita (limite inferior inclusivo)", async () => {
    expect(await confirmarNovaSenha({ senha: "Abc12345", confirmacao: "Abc12345" })).toStrictEqual({
      ok: true,
      destino: DESTINO,
    });
  });
});

describe("confirmarNovaSenha — rate limit (RN-03)", () => {
  it("usa a chave novaSenhaLojista com o IP da requisição", async () => {
    await confirmarNovaSenha(payload());
    expect(verificarRateLimit).toHaveBeenCalledWith("novaSenhaLojista", "203.0.113.7");
  });

  it("limite estourado → ok:false, sem getUser, sem updateUser e sem signOut", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    expect((await confirmarNovaSenha(payload())).ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    nadaTrocado();
  });
});

describe("confirmarNovaSenha — senha fora do log (RN-11)", () => {
  it("senha não aparece em nenhum console.error, mesmo com erros que a contêm", async () => {
    updateUser.mockResolvedValueOnce({
      data: null,
      error: { status: 500, code: "unexpected_failure", name: "AuthApiError", message: `rejeitou ${SENHA}` },
    });
    await confirmarNovaSenha(payload());
    updateUser.mockRejectedValueOnce(new Error(`exceção com ${SENHA}`));
    await confirmarNovaSenha(payload());
    signOut.mockRejectedValueOnce(new Error(`signOut com ${SENHA}`));
    await confirmarNovaSenha(payload());

    expect(console.error).toHaveBeenCalled();
    expect(logs()).not.toContain(SENHA);
  });
});
