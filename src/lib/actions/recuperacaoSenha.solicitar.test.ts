import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) — issue 366, fatia F2a: `solicitarRedefinicaoSenha` (porta lojista).
 * Spec: specs/recuperacao-senha-self-service.md (RN-01, RN-02, RN-03, RN-11, D3, D4).
 *
 * Contrato travado aqui:
 *  - rate limit por IP com a chave `recuperacaoLojista`, ANTES do GoTrue;
 *  - payload `.strict()` só com `email` (sem `next`: o destino é fixo);
 *  - `resetPasswordForEmail(email, { redirectTo: "<origem>/auth/callback?next=%2Fnova-senha" })`;
 *  - resposta idêntica (`{ ok: true, mensagem }`) com GoTrue ok, erro ou exceção;
 *  - piso de latência de 1500 ms;
 *  - e-mail nunca em `console.error`.
 * Mocks só de fronteira: Supabase, next/headers, rate limit. Dados fictícios.
 */

const EMAIL = "lojista.ficticio@exemplo.test";
const ORIGEM = "https://app.local";
const REDIRECT_TO = `${ORIGEM}/auth/callback?next=%2Fnova-senha`;
const MSG_NEUTRA =
  "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha. Abra o link neste mesmo navegador.";

const resetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a) },
    }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ origin: ORIGEM })),
}));
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

import { solicitarRedefinicaoSenha } from "@/lib/actions/recuperacaoSenha";

/** Executa a action atravessando o piso de latência com fake timers. */
async function executar(payload: unknown) {
  const p = solicitarRedefinicaoSenha(payload);
  await vi.advanceTimersByTimeAsync(2000);
  return p;
}

const logs = () => JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  verificarRateLimit.mockResolvedValue({ permitido: true });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("solicitarRedefinicaoSenha — anti-enumeração (RN-01/RN-02)", () => {
  it("GoTrue ok → { ok: true, mensagem } com a mensagem neutra do spec", async () => {
    expect(await executar({ email: EMAIL })).toStrictEqual({ ok: true, mensagem: MSG_NEUTRA });
  });

  it("resposta é idêntica com GoTrue ok, GoTrue com erro e GoTrue lançando exceção", async () => {
    const comOk = await executar({ email: EMAIL });

    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { status: 429, code: "over_email_send_rate_limit", name: "AuthApiError", message: "x" },
    });
    const comErro = await executar({ email: EMAIL });

    resetPasswordForEmail.mockRejectedValueOnce(new Error("rede caiu"));
    const comExcecao = await executar({ email: EMAIL });

    expect(comErro).toStrictEqual(comOk);
    expect(comExcecao).toStrictEqual(comOk);
    expect(comOk).toStrictEqual({ ok: true, mensagem: MSG_NEUTRA });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(3);
  });

  it("chama resetPasswordForEmail com o e-mail e redirectTo exato para o callback com next=/nova-senha", async () => {
    await executar({ email: EMAIL });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, { redirectTo: REDIRECT_TO });
  });
});

describe("solicitarRedefinicaoSenha — piso de latência de 1500 ms (D3)", () => {
  it("não resolve em 1499 ms e resolve em 1500 ms, mesmo com GoTrue instantâneo", async () => {
    let pronto = false;
    const p = solicitarRedefinicaoSenha({ email: EMAIL }).then((r: unknown) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(pronto).toBe(true);
    expect(await p).toStrictEqual({ ok: true, mensagem: MSG_NEUTRA });
  });

  it("GoTrue com erro também respeita o piso (tempo não ramifica pelo desfecho)", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 500, code: "unexpected_failure" } });
    let pronto = false;
    void solicitarRedefinicaoSenha({ email: EMAIL }).then(() => {
      pronto = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(pronto).toBe(true);
  });
});

describe("solicitarRedefinicaoSenha — PII fora do log (RN-11)", () => {
  it("e-mail não aparece em nenhum console.error, nem com erro do GoTrue que o contém", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { status: 400, code: "validation_failed", name: "AuthApiError", message: `falhou para ${EMAIL}` },
    });
    await executar({ email: EMAIL });
    resetPasswordForEmail.mockRejectedValueOnce(new Error(`exceção com ${EMAIL}`));
    await executar({ email: EMAIL });

    expect(console.error).toHaveBeenCalled();
    expect(logs()).not.toContain(EMAIL);
    expect(logs()).not.toContain("exemplo.test");
  });
});

describe("solicitarRedefinicaoSenha — rate limit e payload (RN-03)", () => {
  it("usa a chave recuperacaoLojista com o IP da requisição, antes do GoTrue", async () => {
    await executar({ email: EMAIL });
    expect(verificarRateLimit).toHaveBeenCalledWith("recuperacaoLojista", "203.0.113.7");
    expect(verificarRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      resetPasswordForEmail.mock.invocationCallOrder[0],
    );
  });

  it("limite estourado → ok:false e resetPasswordForEmail NÃO chamado", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await executar({ email: EMAIL });
    expect(r.ok).toBe(false);
    expect(verificarRateLimit).toHaveBeenCalledWith("recuperacaoLojista", "203.0.113.7");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("payload com next é recusado pelo .strict() → ok:false, sem GoTrue", async () => {
    const r = await executar({ email: EMAIL, next: "/painel" });
    expect(r.ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("e-mail inválido → ok:false, sem GoTrue", async () => {
    const r = await executar({ email: "nao-e-email" });
    expect(r.ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
