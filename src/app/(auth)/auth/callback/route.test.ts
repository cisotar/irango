import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Testes de unidade do Route Handler GET /auth/callback.
 *
 * Cobre o bug corrigido (issue 003): `?error=access_denied` antes redirecionava
 * para JSON bruto; agora vai para `/login?erro=google`. O teste do caso `?error=`
 * falharia contra o código antigo que não tratava `erroOAuth`.
 *
 * Mocks:
 *  - `@/lib/supabase/server` (createClient async) — padrão de auth.test.ts L42-44
 *  - `@/lib/auth/reconciliarPosConfirmacao` — padrão de reconciliarPosConfirmacao.test.ts
 *
 * `sanitizarNext` é privada: exercitada indiretamente via `?next=` no request
 * (sem exportar só para teste — não altera a superfície de produção).
 */

// ── fake user mínimo ──────────────────────────────────────────────────────────
const fakeUser: User = {
  id: "uid-test",
  email: "teste@exemplo.com",
  email_confirmed_at: "2026-06-15T10:00:00.000Z",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-06-15T09:00:00.000Z",
} as User;

// ── mock: @/lib/supabase/server ───────────────────────────────────────────────
// createClient é async no callback → retorna Promise.resolve(...)
const exchangeCodeForSession = vi.fn();
const serverClient = {
  auth: {
    exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(serverClient),
}));

// ── mock: reconciliarPosConfirmacao ───────────────────────────────────────────
const reconciliarPosConfirmacao = vi.fn();
vi.mock("@/lib/auth/reconciliarPosConfirmacao", () => ({
  reconciliarPosConfirmacao: (...a: unknown[]) => reconciliarPosConfirmacao(...a),
}));

// A importação deve vir DEPOIS dos vi.mock (hoisting do vitest)
import { GET } from "./route";

const ORIGIN = "https://app.local";

function makeRequest(search: string): NextRequest {
  return new NextRequest(`${ORIGIN}/auth/callback${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reconciliarPosConfirmacao.mockResolvedValue(undefined);
});

// Casos de identidade (issue 148) manipulam SAAS_ADMIN_USER_ID por caso.
// Limpar depois de cada teste garante que os casos existentes (que NÃO stubam
// a env) continuem caindo em `/painel` — env ausente → ehAdminSaaS false.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /auth/callback", () => {
  // ── BUG COBERTO ──────────────────────────────────────────────────────────────
  it("?error=access_denied → redirect /login?erro=google; exchangeCodeForSession NÃO chamado", async () => {
    const res = await GET(
      makeRequest("?error=access_denied&error_description=User+denied+access"),
    );

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/login?erro=google`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    // detalhe não deve vazar para a URL (§14)
    expect(location).not.toContain("error_description");
    expect(location).not.toContain("access_denied");
  });

  // ── SEM CODE, SEM ERROR ───────────────────────────────────────────────────────
  it("sem code e sem error → redirect /login?erro=auth; exchangeCodeForSession NÃO chamado", async () => {
    const res = await GET(makeRequest(""));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/login?erro=auth`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  // ── CAMINHO FELIZ ─────────────────────────────────────────────────────────────
  it("code válido → chama exchangeCodeForSession, reconciliar e redireciona /painel", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc123"));

    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(reconciliarPosConfirmacao).toHaveBeenCalledOnce();
    expect(reconciliarPosConfirmacao).toHaveBeenCalledWith(fakeUser);

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel`);
  });

  // ── NEXT VÁLIDO ───────────────────────────────────────────────────────────────
  it("code válido + next=/vitrine → redireciona /vitrine", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc&next=/vitrine"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/vitrine`);
  });

  // ── ANTI OPEN-REDIRECT ────────────────────────────────────────────────────────
  it("code válido + next=//evil.com → sanitizarNext bloqueia; redireciona /painel", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc&next=//evil.com"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel`);
    expect(location).not.toContain("evil.com");
  });

  // ── FALHA NA TROCA DE CODE ────────────────────────────────────────────────────
  it("exchangeCodeForSession falha → redirect /login?erro=auth; reconciliar NÃO chamado", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid grant" },
    });

    const res = await GET(makeRequest("?code=abc"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/login?erro=auth`);
    expect(reconciliarPosConfirmacao).not.toHaveBeenCalled();
  });

  // ── USER AUSENTE NA RESPOSTA (null) ───────────────────────────────────────────
  it("exchangeCodeForSession ok mas data.user null → redireciona /painel; reconciliar NÃO chamado", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel`);
    expect(reconciliarPosConfirmacao).not.toHaveBeenCalled();
  });

  // ── NEXT INTERNO LONGO ────────────────────────────────────────────────────────
  it("code válido + next=/painel/pedidos → redireciona /painel/pedidos", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc&next=/painel/pedidos"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel/pedidos`);
  });
});

/**
 * Issue 148 — decisão de redirect pós-login por identidade.
 *
 * Invariante de roteamento/controle de acesso (server-side): o destino PADRÃO
 * (sem `next`) do dono do SaaS é `/admin`; do lojista comum é `/painel`. A
 * identidade sai de `data.user.id` (autoritativo do `exchangeCodeForSession`),
 * comparada com `SAAS_ADMIN_USER_ID` via `ehAdminSaaS` — NUNCA de query param.
 * `next` explícito e sanitizado tem prioridade absoluta sobre a identidade, e
 * `next` malicioso é descartado antes de qualquer decisão.
 *
 * RED: o handler atual manda todo destino padrão para `/painel`, então os casos
 * de dono→`/admin` e next-malicioso-do-dono→`/admin` FALHAM até a fase GREEN.
 *
 * Env real via `vi.stubEnv` (ehAdminSaaS é síncrono; `server-only` já aliasado
 * no vitest.config.ts) — sem mock de `@/lib/auth/admin`.
 */
describe("GET /auth/callback — destino padrão por identidade (issue 148)", () => {
  it("dono do SaaS sem next → redireciona /admin", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id); // env casa o user autoritativo
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/admin`);
  });

  it("lojista comum sem next → redireciona /painel (sem regressão)", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", "outro-uid-do-dono"); // env ≠ user do mock
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel`);
  });

  it("dono do SaaS com next=/vitrine → next vence sobre /admin", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id);
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc&next=/vitrine"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/vitrine`);
  });

  it("SAAS_ADMIN_USER_ID ausente → dono degrada para /painel, login não quebra", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", undefined); // fail-safe: env vazia
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser }, // seria o dono, mas sem env não há como saber
      error: null,
    });

    // Não deve lançar (login de ninguém quebra por config faltando).
    const res = await GET(makeRequest("?code=abc"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/painel`);
  });

  it("dono do SaaS com next=//evil.com → sanitiza e cai no destino padrão /admin, sem vazar evil.com", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id);
    exchangeCodeForSession.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });

    const res = await GET(makeRequest("?code=abc&next=//evil.com"));

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/admin`);
    expect(location).not.toContain("evil.com");
  });
});
