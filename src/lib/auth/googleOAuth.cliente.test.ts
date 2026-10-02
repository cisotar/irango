import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) — issue 336: `entrarComGoogle` ganha opções
 * `{ contexto?: "cliente"; next?: string }` → `redirectTo`
 * `/auth/callback?contexto=cliente&next=<next>`. Sem opções = comportamento atual
 * (coberto por `googleOAuth.test.ts`, que NÃO é alterado). Mesmos mocks dele.
 */

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import * as mod from "./googleOAuth";
type ComOpcoes = (o?: { contexto?: "cliente"; next?: string }) => Promise<void>;
const entrarComGoogle = mod.entrarComGoogle as unknown as ComOpcoes;

const FAKE_ORIGIN = "https://app.local";
const redirectTo = () => new URL((signInWithOAuth.mock.calls[0][0] as { options: { redirectTo: string } }).options.redirectTo);

beforeEach(() => {
  vi.clearAllMocks();
  signInWithOAuth.mockResolvedValue({ error: null });
  // @ts-expect-error — stub intencional para ambiente node
  globalThis.window = { location: { origin: FAKE_ORIGIN } };
});
afterEach(() => {
  // @ts-expect-error — limpeza do stub
  delete globalThis.window;
});

describe("entrarComGoogle — porta cliente", () => {
  it("{ contexto:'cliente', next:'/loja/pizzaria' } → /auth/callback?contexto=cliente&next=/loja/pizzaria", async () => {
    await entrarComGoogle({ contexto: "cliente", next: "/loja/pizzaria" });
    const u = redirectTo();
    expect(u.origin).toBe(FAKE_ORIGIN);
    expect(u.pathname).toBe("/auth/callback");
    expect(u.searchParams.get("contexto")).toBe("cliente");
    expect(u.searchParams.get("next")).toBe("/loja/pizzaria");
  });

  it("{ contexto:'cliente' } sem next → contexto=cliente e nenhum parâmetro next", async () => {
    await entrarComGoogle({ contexto: "cliente" });
    const u = redirectTo();
    expect(u.searchParams.get("contexto")).toBe("cliente");
    expect(u.searchParams.has("next")).toBe(false);
  });

  it("next com query é codificado (não vaza parâmetros para o callback)", async () => {
    await entrarComGoogle({ contexto: "cliente", next: "/loja/x?a=1&contexto=lojista" });
    const u = redirectTo();
    expect(u.searchParams.getAll("contexto")).toEqual(["cliente"]);
    expect(u.searchParams.get("next")).toBe("/loja/x?a=1&contexto=lojista");
  });
});
