import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Testes de unidade do helper `entrarComGoogle`.
 *
 * Mock de @/lib/supabase/client (createClient síncrono — sem await).
 * Mock de sonner (toast.error).
 * Stub de window.location.origin (env node não tem window).
 */

// ── mock: @/lib/supabase/client ───────────────────────────────────────────────
const signInWithOAuth = vi.fn();
const clientInstance = {
  auth: {
    signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a),
  },
};
// createClient é SÍNCRONO no client-side (diferente do server)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => clientInstance,
}));

// ── mock: sonner ──────────────────────────────────────────────────────────────
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

// A importação vem DEPOIS dos vi.mock
import { entrarComGoogle } from "./googleOAuth";

const FAKE_ORIGIN = "https://app.local";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Stub window.location.origin: env node não tem window
  // @ts-expect-error — stub intencional para ambiente node
  globalThis.window = { location: { origin: FAKE_ORIGIN } };
});

afterEach(() => {
  // Limpa o stub para não vazar entre suites
  // @ts-expect-error — limpeza do stub
  delete globalThis.window;
});

describe("entrarComGoogle", () => {
  // ── CAMINHO FELIZ ─────────────────────────────────────────────────────────────
  it("sucesso → chama signInWithOAuth com provider google e redirectTo terminando em /auth/callback", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });

    await entrarComGoogle();

    expect(signInWithOAuth).toHaveBeenCalledOnce();
    const [call] = signInWithOAuth.mock.calls;
    expect(call[0]).toMatchObject({
      provider: "google",
      options: expect.objectContaining({
        redirectTo: expect.stringMatching(/\/auth\/callback$/),
      }),
    });
    // toast.error NÃO deve ser chamado em caso de sucesso
    expect(toastError).not.toHaveBeenCalled();
  });

  it("sucesso → redirectTo usa window.location.origin (não hard-coded)", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });

    await entrarComGoogle();

    const [call] = signInWithOAuth.mock.calls;
    const { redirectTo } = call[0].options as { redirectTo: string };
    expect(redirectTo).toContain(FAKE_ORIGIN);
  });

  // ── CAMINHO DE ERRO ───────────────────────────────────────────────────────────
  it("signInWithOAuth retorna error → toast.error chamado com mensagem amigável; console.error chamado", async () => {
    const fakeError = { message: "provider error" };
    signInWithOAuth.mockResolvedValue({ error: fakeError });

    await entrarComGoogle();

    expect(toastError).toHaveBeenCalledOnce();
    // mensagem amigável — não expõe detalhe técnico ao usuário
    const [msg] = toastError.mock.calls[0];
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);

    expect(console.error).toHaveBeenCalledWith(
      "[entrarComGoogle]",
      fakeError,
    );
  });
});
