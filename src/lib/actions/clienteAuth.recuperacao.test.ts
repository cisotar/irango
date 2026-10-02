import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P18 (Marco B) — `redefinirSenhaCliente` só aceita sessão de RECUPERAÇÃO
 * (claim `amr` com `recovery`). Sessão de login por senha/OAuth não troca a
 * senha sem a atual. Rate limit próprio `novaSenhaCliente`. Dados fictícios.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MSG_LINK = "Link inválido ou expirado. Peça um novo link.";

const updateUser = vi.fn();
const getUser = vi.fn();
const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        updateUser: (...a: unknown[]) => updateUser(...a),
        getUser: (...a: unknown[]) => getUser(...a),
        getClaims: (...a: unknown[]) => getClaims(...a),
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

import { redefinirSenhaCliente } from "./clienteAuth";

const nova = { senha: "novaSenha123", confirmacao: "novaSenha123" };
const claims = (amr: unknown) => ({ data: { claims: { sub: USER_ID, amr } }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  verificarRateLimit.mockResolvedValue({ permitido: true });
  updateUser.mockResolvedValue({ data: {}, error: null });
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe("redefinirSenhaCliente — só sessão de recuperação", () => {
  it("amr com recovery → updateUser e ok", async () => {
    getClaims.mockResolvedValue(claims([{ method: "recovery", timestamp: 1 }]));
    expect(await redefinirSenhaCliente(nova)).toEqual({ ok: true, destino: "/minha-conta" });
    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha123" });
  });
  it("amr de login por senha → ok:false genérico, SEM updateUser", async () => {
    getClaims.mockResolvedValue(claims([{ method: "password", timestamp: 1 }]));
    expect(await redefinirSenhaCliente(nova)).toEqual({ ok: false, erro: MSG_LINK });
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("amr de OAuth → ok:false, SEM updateUser", async () => {
    getClaims.mockResolvedValue(claims([{ method: "oauth", timestamp: 1 }]));
    expect((await redefinirSenhaCliente(nova)).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("sem amr / erro nas claims → ok:false, SEM updateUser", async () => {
    getClaims.mockResolvedValue(claims(undefined));
    expect((await redefinirSenhaCliente(nova)).ok).toBe(false);
    getClaims.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await redefinirSenhaCliente(nova)).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("rate limit novaSenhaCliente estourado → ok:false, SEM updateUser", async () => {
    getClaims.mockResolvedValue(claims([{ method: "recovery", timestamp: 1 }]));
    verificarRateLimit.mockResolvedValue({ permitido: false });
    expect((await redefinirSenhaCliente(nova)).ok).toBe(false);
    expect(verificarRateLimit).toHaveBeenCalledWith("novaSenhaCliente", "203.0.113.7");
    expect(updateUser).not.toHaveBeenCalled();
  });
});
