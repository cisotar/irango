import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Contrato: ramo de recuperação da porta lojista
 * no callback. Spec: specs/recuperacao-senha-self-service.md §"Callback" (D5,
 * RN-07, RN-09).
 *
 * Contrato travado aqui:
 *  - porta lojista lê `amr` por `supabase.auth.getClaims(data.session.access_token)`
 *    — nunca da URL;
 *  - `amr` com `recovery` → `/nova-senha` fixo (ignora `next`), SEM
 *    `atribuirPapelInicial` (RPC `atribuir_papel_inicial` não chamada),
 *    `reconciliarPosConfirmacao` 1×;
 *  - S1: sessão ausente ou `getClaims` com erro → `/login?erro=auth`, sem papel
 *    (fail-closed);
 *  - S2: sessão comum com `next=/nova-senha` → fluxo atual (papel lojista +
 *    destino = next sanitizado);
 *  - erros (`?error=`, sem code, troca falha) com `next=/nova-senha` ou
 *    `error_code=otp_expired` → `/recuperar-senha?erro=link`;
 *  - S4: porta cliente não chama `getClaims` nem vai para `/nova-senha`.
 * `atribuirPapelInicial` é real; a prova é sobre o `rpc` do service_role.
 */

const fakeUser = {
  id: "uid-recuperacao",
  email: "lojista.ficticio@exemplo.test",
  email_confirmed_at: "2026-10-01T10:00:00.000Z",
} as User;
const ACCESS_TOKEN = "jwt-ficticio-recuperacao";
const sessao = { access_token: ACCESS_TOKEN };

const exchangeCodeForSession = vi.fn();
const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
        getClaims: (...a: unknown[]) => getClaims(...a),
      },
    }),
}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));
const reconciliar = vi.fn();
vi.mock("@/lib/auth/reconciliarPosConfirmacao", () => ({
  reconciliarPosConfirmacao: (...a: unknown[]) => reconciliar(...a),
}));

import { GET } from "./route";

const ORIGIN = "https://app.local";
const req = (s: string) => new NextRequest(`${ORIGIN}/auth/callback${s}`);
const amr = (lista: unknown) => ({ data: { claims: { sub: fakeUser.id, amr: lista } }, error: null });
const RECOVERY = amr([{ method: "recovery", timestamp: 1 }]);
const PASSWORD = amr([{ method: "password", timestamp: 1 }]);
const LINK_INVALIDO = `${ORIGIN}/recuperar-senha?erro=link`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "outro-id-ficticio");
  reconciliar.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: ["lojista"], error: null });
  exchangeCodeForSession.mockResolvedValue({ data: { user: fakeUser, session: sessao }, error: null });
  getClaims.mockResolvedValue(RECOVERY);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /auth/callback — ramo de recuperação da porta lojista (RN-09)", () => {
  it("amr recovery → /nova-senha, sem RPC de papel, reconcilia 1× com o user da sessão", async () => {
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/nova-senha`);
    expect(rpc).not.toHaveBeenCalled();
    expect(reconciliar).toHaveBeenCalledTimes(1);
    expect(reconciliar).toHaveBeenCalledWith(fakeUser);
  });

  it("amr recovery com next=/nova-senha → /nova-senha e sem RPC de papel", async () => {
    const res = await GET(req("?code=abc&next=/nova-senha"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/nova-senha`);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("getClaims é chamado com o access_token da sessão trocada", async () => {
    await GET(req("?code=abc"));
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getClaims).toHaveBeenCalledWith(ACCESS_TOKEN);
  });
});

describe("GET /auth/callback — destino fixo com next adulterado (RN-07)", () => {
  it.each(["//evil.com", "https://evil.com/x", "/painel"])(
    "amr recovery + next=%s → ainda /nova-senha, sem RPC de papel",
    async (next) => {
      const res = await GET(req(`?code=abc&next=${encodeURIComponent(next)}`));
      expect(res.headers.get("location")).toBe(`${ORIGIN}/nova-senha`);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});

describe("GET /auth/callback — ramo decidido pela sessão, não pela URL", () => {
  it("?amr=recovery na URL com sessão comum (password) → fluxo normal: papel lojista e /painel", async () => {
    getClaims.mockResolvedValue(PASSWORD);
    const res = await GET(req("?code=abc&amr=recovery"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/painel`);
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: fakeUser.id, p_papel: "lojista" });
    expect(getClaims).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("S2: sessão comum com next=/nova-senha → papel lojista atribuído e destino = next sanitizado", async () => {
    getClaims.mockResolvedValue(PASSWORD);
    const res = await GET(req("?code=abc&next=/nova-senha"));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: fakeUser.id, p_papel: "lojista" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/nova-senha`);
    expect(getClaims).toHaveBeenCalledWith(ACCESS_TOKEN);
  });
});

describe("GET /auth/callback — S1 fail-closed na porta lojista", () => {
  it("troca sem sessão → /login?erro=auth, sem RPC de papel e sem reconciliar", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: fakeUser, session: null }, error: null });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(rpc).not.toHaveBeenCalled();
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("getClaims com erro → /login?erro=auth, sem RPC de papel e sem reconciliar", async () => {
    getClaims.mockResolvedValue({ data: null, error: { name: "AuthInvalidJwtError", status: 401 } });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(rpc).not.toHaveBeenCalled();
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("getClaims lança → /login?erro=auth, sem RPC de papel", async () => {
    getClaims.mockRejectedValue(new Error("rede"));
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — link inválido/expirado da recuperação → /recuperar-senha?erro=link", () => {
  it("?error= com next=/nova-senha → /recuperar-senha?erro=link, sem troca", async () => {
    const res = await GET(req("?error=access_denied&next=%2Fnova-senha"));
    expect(res.headers.get("location")).toBe(LINK_INVALIDO);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("?error= com error_code=otp_expired → /recuperar-senha?erro=link", async () => {
    const res = await GET(req("?error=access_denied&error_code=otp_expired&error_description=Email+link+expired"));
    expect(res.headers.get("location")).toBe(LINK_INVALIDO);
  });

  it("sem code com next=/nova-senha → /recuperar-senha?erro=link", async () => {
    const res = await GET(req("?next=%2Fnova-senha"));
    expect(res.headers.get("location")).toBe(LINK_INVALIDO);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("troca falha com next=/nova-senha (outro navegador / link usado) → /recuperar-senha?erro=link, sem papel", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 400, code: "flow_state_not_found", name: "AuthApiError" },
    });
    const res = await GET(req("?code=abc&next=%2Fnova-senha"));
    expect(res.headers.get("location")).toBe(LINK_INVALIDO);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("demais erros sem marca de recuperação seguem para /login (sem regressão)", async () => {
    expect((await GET(req("?error=access_denied"))).headers.get("location")).toBe(`${ORIGIN}/login?erro=google`);
    expect((await GET(req(""))).headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
  });
});

describe("GET /auth/callback — porta cliente inalterada (S4)", () => {
  it("contexto=cliente com amr recovery → não vai para /nova-senha e não chama getClaims", async () => {
    const res = await GET(req("?code=abc&contexto=cliente&next=%2Fconta%2Frecuperar%3Fetapa%3Dnova-senha"));
    const location = res.headers.get("location");
    expect(location).toBe(`${ORIGIN}/conta/recuperar?etapa=nova-senha`);
    expect(location).not.toBe(`${ORIGIN}/nova-senha`);
    expect(getClaims).not.toHaveBeenCalled();
  });
});
