import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/** Bordas do callback quanto ao papel (issue 332), além do RED. */
const fakeUser = { id: "uid-papel", email: "t@exemplo.com", email_confirmed_at: "2026-06-15T10:00:00.000Z" } as User;

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a) } }),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "outro-id");
  reconciliar.mockResolvedValue(undefined);
  exchangeCodeForSession.mockResolvedValue({ data: { user: fakeUser }, error: null });
  rpc.mockResolvedValue({ data: ["lojista"], error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /auth/callback — papel, bordas (issue 332)", () => {
  it("lojista: reconcilia com o user da sessão e vai a /painel", async () => {
    const res = await GET(req("?code=abc"));
    expect(reconciliar).toHaveBeenCalledTimes(1);
    expect(reconciliar).toHaveBeenCalledWith(fakeUser);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/painel`);
  });

  it("['lojista','cliente'] → /painel e reconcilia (decisão 15)", async () => {
    rpc.mockResolvedValue({ data: ["lojista", "cliente"], error: null });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/painel`);
    expect(reconciliar).toHaveBeenCalledTimes(1);
  });

  it("RPC devolve [] → '/' sem reconciliar (fail-closed)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("RPC devolve null sem error → '/' sem reconciliar", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("RPC rejeita (rede) → /login?erro=auth, sem reconciliar", async () => {
    rpc.mockRejectedValue(new Error("rede"));
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("RPC com error não vaza com next presente: destino é /login?erro=auth, não o next", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    const res = await GET(req("?code=abc&next=/painel/pedidos"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
  });

  it("só-cliente com next open-redirect (//evil.com) → '/' (next descartado)", async () => {
    rpc.mockResolvedValue({ data: ["cliente"], error: null });
    const res = await GET(req("?code=abc&next=//evil.com"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/minha-conta`);
  });

  it("admin com ['lojista'] sem next → /admin e ainda reconcilia", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id);
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin`);
    expect(reconciliar).toHaveBeenCalledTimes(1);
  });

  it("sem code ou com ?error= NÃO atribui papel", async () => {
    await GET(req(""));
    await GET(req("?error=access_denied"));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("troca de código falha → NÃO atribui papel", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("papel é atribuído ANTES de reconciliar", async () => {
    await GET(req("?code=abc"));
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(reconciliar.mock.invocationCallOrder[0]);
  });
});
