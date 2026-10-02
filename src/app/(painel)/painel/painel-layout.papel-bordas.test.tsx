import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Bordas do gate de papel no layout do painel (issue 332), além do RED.
 * Mesmo padrão do painel-layout.guard.test.tsx (node, redirect lança).
 */
const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_d: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({ redirect: (d: string) => redirect(d) }));

const USER_ID = "00000000-0000-4000-8000-0000000003b1";
const getUser = vi.fn();
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ __service: true }) }));

const buscarLojaDoDono = vi.fn();
const garantirLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
  garantirLojaDoDono: (...a: unknown[]) => garantirLojaDoDono(...a),
}));
const buscarPapeisDoUsuario = vi.fn();
vi.mock("@/lib/supabase/queries/papeis", () => ({
  buscarPapeisDoUsuario: (c: unknown, id: string) => buscarPapeisDoUsuario(c, id),
}));
vi.mock("@/components/painel/NavPainel", () => ({
  SidebarPainel: () => null,
  TopbarPainel: () => null,
}));

const confirmado = { id: USER_ID, email: "d@teste.local", email_confirmed_at: "2026-01-02T00:00:00Z" };
const naoConfirmado = { ...confirmado, email_confirmed_at: null };
const loja = {
  nome: "L", logo_url: null, slug: "l", horarios: {}, timezone: "America/Sao_Paulo",
  assinatura_status: "ativa", assinatura_fim_periodo: null,
} as unknown as LojaCompleta;
const CHILDREN = { __tag: "c" } as unknown as ReactNode;

async function layout() {
  const m = (await import("./layout")) as {
    default: (p: { children: ReactNode }) => Promise<unknown>;
  };
  return m.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "00000000-0000-4000-8000-0000000003ff");
  getUser.mockResolvedValue({ data: { user: confirmado } });
  buscarLojaDoDono.mockResolvedValue(null);
  buscarPapeisDoUsuario.mockResolvedValue([]);
  garantirLojaDoDono.mockResolvedValue("id");
});
afterEach(() => vi.unstubAllEnvs());

describe("painel/layout — papel, bordas (issue 332)", () => {
  it("sem sessão → '/login' e NÃO consulta papéis nem loja", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(buscarPapeisDoUsuario).not.toHaveBeenCalled();
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("['lojista'] com e-mail não confirmado → '/confirmar-email', sem auto-cura", async () => {
    getUser.mockResolvedValue({ data: { user: naoConfirmado } });
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/confirmar-email");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[] com e-mail não confirmado → '/' (papel antes do e-mail)", async () => {
    getUser.mockResolvedValue({ data: { user: naoConfirmado } });
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("admin (env) com ['cliente'] e loja → '/admin', sem render", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", USER_ID);
    buscarLojaDoDono.mockResolvedValue(loja);
    buscarPapeisDoUsuario.mockResolvedValue(["cliente"]);
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/admin");
  });

  it("['lojista','cliente'] com loja → renderiza o chrome, sem redirect", async () => {
    buscarLojaDoDono.mockResolvedValue(loja);
    buscarPapeisDoUsuario.mockResolvedValue(["lojista", "cliente"]);
    const L = await layout();
    const el = await L({ children: CHILDREN });
    expect(el).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("falha na leitura da LOJA (papel ok) → '/login?erro=sessao'", async () => {
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    buscarLojaDoDono.mockRejectedValue(new Error("db"));
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("getUser lança → '/login?erro=sessao'", async () => {
    getUser.mockRejectedValue(new Error("auth"));
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
  });

  it("['lojista'] sem loja e auto-cura falha → '/login?erro=sessao' (nunca '/painel')", async () => {
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    garantirLojaDoDono.mockRejectedValue(new Error("rpc"));
    const L = await layout();
    await expect(L({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
    expect(redirect).not.toHaveBeenCalledWith("/painel");
  });
});
