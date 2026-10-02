import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Fase RED (issue 332, crítica: TDD red-first) — gate de PAPEL no layout pai
 * `src/app/(painel)/painel/layout.tsx`.
 *
 * Invariante: conta sem papel "lojista" nunca dispara a auto-cura
 * (`garantirLojaDoDono`) nem renderiza o chrome do painel. O destino vem de
 * `destinoPadraoPorPapel` (admin env → "/admin"; demais → "/").
 *
 * Padrão de `bloqueavel-layout.guard.test.tsx`: chama o default export async sem
 * renderizar (environment node), `redirect` mockado LANÇA NEXT_REDIRECT.
 * `decidirAcessoBase` e `destinoPadraoPorPapel` NÃO são mockadas (fiação real).
 * Admin pela env real (`vi.stubEnv`), sem mock de `@/lib/auth/admin`.
 *
 * RED: o layout atual não lê papéis — com loja null cai em "onboarding" e chama
 * `garantirLojaDoDono`; com loja presente renderiza o chrome.
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
}));

const USER_ID = "00000000-0000-4000-8000-0000000003a1";
const userConfirmado = {
  id: USER_ID,
  email: "dono@teste.local",
  email_confirmed_at: "2026-01-02T00:00:00Z",
};
const getUser = vi.fn(async () => ({ data: { user: userConfirmado } }));
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const serviceFake = { __service: true };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceFake,
}));

const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
const garantirLojaDoDono = vi.fn(async (..._a: unknown[]) => "loja-id");
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
  garantirLojaDoDono: (...a: unknown[]) => garantirLojaDoDono(...a),
}));

// Query nova (GREEN cria o módulo). Mock só do I/O.
const buscarPapeisDoUsuario = vi.fn(async (_c: unknown, _id: string) => [] as string[]);
vi.mock("@/lib/supabase/queries/papeis", () => ({
  buscarPapeisDoUsuario: (c: unknown, id: string) => buscarPapeisDoUsuario(c, id),
}));

// Chrome do painel: sem relevância para o gate; evita puxar componentes de UI.
vi.mock("@/components/painel/NavPainel", () => ({
  SidebarPainel: () => null,
  TopbarPainel: () => null,
}));

function fazerLoja(): LojaCompleta {
  return {
    nome: "Loja Teste",
    logo_url: null,
    slug: "loja-teste",
    horarios: {},
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: null,
  } as unknown as LojaCompleta;
}

const CHILDREN = { __tag: "children-sentinela" } as unknown as ReactNode;

async function importarLayout(): Promise<(props: { children: ReactNode }) => Promise<unknown>> {
  const mod = (await import("./layout")) as {
    default: (props: { children: ReactNode }) => Promise<unknown>;
  };
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "00000000-0000-4000-8000-0000000003ff"); // ≠ USER_ID
  getUser.mockResolvedValue({ data: { user: userConfirmado } });
  createClient.mockResolvedValue(supabaseFake as unknown);
  buscarLojaDoDono.mockResolvedValue(null);
  buscarPapeisDoUsuario.mockResolvedValue([]);
  garantirLojaDoDono.mockResolvedValue("loja-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("painel/layout — gate de papel (issue 332, RED)", () => {
  it("[332-20] confirmado, sem loja, papeis [] → sem auto-cura, redirect '/'", async () => {
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(garantirLojaDoDono).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("[332-21] ['cliente'] com loja → não renderiza o chrome, redirect '/', sem auto-cura", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja());
    buscarPapeisDoUsuario.mockResolvedValue(["cliente"]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-22] admin (env) sem 'lojista' → redirect '/admin', sem auto-cura", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", USER_ID);
    buscarPapeisDoUsuario.mockResolvedValue([]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/admin");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-23] ['lojista'] sem loja → garantirLojaDoDono 1x com user.id do getUser, redirect '/painel'", async () => {
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(garantirLojaDoDono).toHaveBeenCalledTimes(1);
    expect(garantirLojaDoDono.mock.calls[0][0]).toBe(serviceFake);
    expect(garantirLojaDoDono.mock.calls[0][1]).toBe(USER_ID);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });

  it("[332-24] leitura dos papéis lança → '/login?erro=sessao', sem auto-cura", async () => {
    buscarPapeisDoUsuario.mockRejectedValue(new Error("falha de leitura"));
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-24b] leitura dos papéis usa o user.id autoritativo do getUser", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja());
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    const Layout = await importarLayout();

    await Layout({ children: CHILDREN });

    expect(buscarPapeisDoUsuario).toHaveBeenCalledWith(supabaseFake, USER_ID);
    expect(redirect).not.toHaveBeenCalled();
  });
});
