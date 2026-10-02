import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * P18 — ramos de `entrarComGoogle` que o RED (googleOAuth.cliente.test.ts) não
 * cobre: `next` sem `contexto` não vaza para o callback; `next` vazio; opções
 * vazias = porta (auth) sem query; falha do OAuth avisa o usuário sem vazar
 * detalhe na UI.
 */
const signInWithOAuth = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }),
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { entrarComGoogle } from "./googleOAuth";

const ORIGEM = "https://app.local";
const redirectTo = () =>
  new URL((signInWithOAuth.mock.calls[0][0] as { options: { redirectTo: string } }).options.redirectTo);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  signInWithOAuth.mockResolvedValue({ error: null });
  // @ts-expect-error — stub de window para ambiente node
  globalThis.window = { location: { origin: ORIGEM } };
});
afterEach(() => {
  // @ts-expect-error — limpeza do stub
  delete globalThis.window;
});

describe("entrarComGoogle — ramos da porta cliente", () => {
  it("só `next`, sem contexto → NÃO propaga next (porta lojista não ganha query)", async () => {
    await entrarComGoogle({ next: "/loja/pizzaria" });
    const u = redirectTo();
    expect(u.pathname).toBe("/auth/callback");
    expect(u.search).toBe("");
  });

  it("contexto cliente com next vazio → sem parâmetro next", async () => {
    await entrarComGoogle({ contexto: "cliente", next: "" });
    const u = redirectTo();
    expect(u.searchParams.get("contexto")).toBe("cliente");
    expect(u.searchParams.has("next")).toBe(false);
  });

  it("sem opções → /auth/callback puro e provider google", async () => {
    await entrarComGoogle();
    expect(signInWithOAuth.mock.calls[0][0]).toMatchObject({ provider: "google" });
    expect(redirectTo().search).toBe("");
  });

  it("falha do OAuth → toast genérico (sem detalhe do erro) e log", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "detalhe interno do provider" } });
    await entrarComGoogle({ contexto: "cliente" });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("detalhe interno");
    expect(console.error).toHaveBeenCalled();
  });
});
