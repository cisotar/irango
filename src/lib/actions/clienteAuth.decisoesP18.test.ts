// RED (decisões P18: B2/D5, recuperação com tempo neutro, D4). Arquivo novo; preâmbulo de mocks copiado de clienteAuth.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) — issue 336, fatia B3 (ajustada pelas alterações 23–24 do plano:
 * recuperação por LINK, sem OTP; aceite de termos só em /conta/completar).
 * Alvo: `src/lib/actions/clienteAuth.ts` (ainda não existe) + chaves novas em
 * `LIMITES` (`src/lib/utils/rateLimit.ts`).
 *
 * Import dinâmico por caso (padrão de `src/lib/utils/papeis.test.ts`).
 * Mocks só de I/O: Supabase (sessão e service_role), next/headers, rate limit,
 * queries de loja (para provar que NUNCA são chamadas). `atribuirPapelInicial`
 * (queries/papeis) é REAL: a prova é sobre o `rpc` do service_role, como em
 * `auth.test.ts`. Dados 100% fictícios.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "pessoa@exemplo.test";

// ── fake PostgREST encadeável: registra (tabela, operação, args) e resolve por tabela ──
type Resposta = { data?: unknown; error?: unknown; count?: number | null };
type Chamada = { tabela: string; metodo: string; args: unknown[] };
function criarFakeDb() {
  const chamadas: Chamada[] = [];
  const respostas: Record<string, Partial<Record<"select" | "insert" | "update" | "delete" | "upsert", Resposta>>> = {};
  function from(tabela: string) {
    const ops: string[] = [];
    const resolver = (): Resposta => {
      const op = (["insert", "update", "delete", "upsert"] as const).find((o) => ops.includes(o)) ?? "select";
      const r = respostas[tabela]?.[op] ?? { data: null, error: null };
      let data = r.data ?? null;
      if ((ops.includes("single") || ops.includes("maybeSingle")) && Array.isArray(data)) data = data[0] ?? null;
      return { data, error: r.error ?? null, count: r.count ?? (Array.isArray(r.data) ? r.data.length : null) };
    };
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "then") return (ok: (v: Resposta) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko);
          return (...args: unknown[]) => {
            ops.push(String(p));
            chamadas.push({ tabela, metodo: String(p), args });
            return b;
          };
        },
      },
    );
    return b;
  }
  return { from, chamadas, respostas };
}

let dbSessao = criarFakeDb();
let dbServico = criarFakeDb();

// ── Supabase sessão (server) ──────────────────────────────────────────────────
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const getUser = vi.fn();
const resend = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        signUp: (...a: unknown[]) => signUp(...a),
        signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
        signOut: (...a: unknown[]) => signOut(...a),
        resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
        updateUser: (...a: unknown[]) => updateUser(...a),
        getUser: (...a: unknown[]) => getUser(...a),
        resend: (...a: unknown[]) => resend(...a),
        getClaims: async () => ({ data: { claims: { amr: [{ method: "recovery", timestamp: 1 }] } }, error: null }),
      },
      from: (t: string) => dbSessao.from(t),
    }),
}));

// ── service_role ──────────────────────────────────────────────────────────────
const rpc = vi.fn();
const deleteUser = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
    from: (t: string) => dbServico.from(t),
  }),
}));

// ── queries de loja: só para provar que a porta cliente NUNCA cria loja ─────────
const criarLoja = vi.fn();
const contarLojasDoDono = vi.fn();
const slugExiste = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  criarLoja: (...a: unknown[]) => criarLoja(...a),
  contarLojasDoDono: (...a: unknown[]) => contarLojasDoDono(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
}));

// ── request scope ─────────────────────────────────────────────────────────────
vi.mock("next/headers", () => ({ headers: () => new Headers({ origin: "https://app.local" }) }));
class Redirecionou extends Error {
  constructor(public destino: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (d: string) => {
    throw new Redirecionou(d);
  },
}));

// ── rate limit (mesmo padrão de auth.test.ts) ─────────────────────────────────
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

type Resultado = { ok: boolean; erro?: string; [k: string]: unknown };
type Acao = (p: unknown) => Promise<Resultado>;
type Mod = {
  cadastrarCliente: Acao;
  entrarCliente: Acao;
  solicitarRecuperacaoCliente: Acao;
  redefinirSenhaCliente: Acao;
  reenviarConfirmacaoCliente: Acao;
};
async function carregar(): Promise<Mod> {
  return (await import("./clienteAuth")) as unknown as Mod;
}

/** Executa a action e devolve o resultado, ou o destino se ela chamou redirect(). */
async function executar(acao: Acao, payload: unknown): Promise<Resultado> {
  try {
    return await acao(payload);
  } catch (e) {
    if (e instanceof Redirecionou) return { ok: true, destino: e.destino };
    throw e;
  }
}


const usuarioConfirmado = { id: USER_ID, email: EMAIL, email_confirmed_at: "2026-09-01T10:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  dbSessao = criarFakeDb();
  dbServico = criarFakeDb();
  verificarRateLimit.mockResolvedValue({ permitido: true });
  signUp.mockResolvedValue({ data: { user: { id: USER_ID, email: EMAIL, email_confirmed_at: null }, session: null }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: usuarioConfirmado, session: { access_token: "t" } }, error: null });
  signOut.mockResolvedValue({ error: null });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  updateUser.mockResolvedValue({ data: { user: usuarioConfirmado }, error: null });
  getUser.mockResolvedValue({ data: { user: usuarioConfirmado }, error: null });
  rpc.mockResolvedValue({ data: ["cliente"], error: null });
  deleteUser.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());

const cad = (extra: Record<string, unknown> = {}) => ({ email: EMAIL, senha: "SenhaForte123", ...extra });

describe("B2/D5 — cadastrarCliente responde sempre neutro", () => {
  it("signUp com erro (já registrado) → { ok: true }, sem deleteUser", async () => {
    const { cadastrarCliente } = await carregar();
    signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "User already registered" } });
    expect(await executar(cadastrarCliente, cad())).toEqual({ ok: true });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("usuário ofuscado do GoTrue (identities: []) → { ok: true } e NENHUMA RPC de papel", async () => {
    const { cadastrarCliente } = await carregar();
    signUp.mockResolvedValueOnce({ data: { user: { id: "ofuscado", email: EMAIL, identities: [] }, session: null }, error: null });
    expect(await executar(cadastrarCliente, cad())).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("conta lojista existente (RPC ['lojista']) → { ok: true }, sem alterar a conta", async () => {
    const { cadastrarCliente } = await carregar();
    rpc.mockResolvedValueOnce({ data: ["lojista"], error: null });
    expect(await executar(cadastrarCliente, cad())).toEqual({ ok: true });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });
  it("conta nova e conta existente devolvem resultado idêntico", async () => {
    const { cadastrarCliente } = await carregar();
    const nova = await executar(cadastrarCliente, cad());
    signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "User already registered" } });
    const existente = await executar(cadastrarCliente, cad());
    expect(existente).toEqual(nova);
    expect(JSON.stringify(existente)).not.toContain("cadastrado");
  });
});

describe("B2 — solicitarRecuperacaoCliente com tempo mínimo constante", () => {
  afterEach(() => vi.useRealTimers());
  it("não resolve antes de ~1,5 s mesmo com GoTrue instantâneo", async () => {
    vi.useFakeTimers();
    const { solicitarRecuperacaoCliente } = await carregar();
    let pronto = false;
    const p = solicitarRecuperacaoCliente({ email: EMAIL }).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1400);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(pronto).toBe(true);
    expect((await p).ok).toBe(true);
  });
});

describe("D4 — reenviarConfirmacaoCliente", () => {
  it("chama auth.resend(signup) com emailRedirectTo do callback cliente e next sanitizado", async () => {
    const { reenviarConfirmacaoCliente } = await carregar();
    const r = await executar(reenviarConfirmacaoCliente, { email: EMAIL, next: "/loja/x" });
    expect(r).toEqual({ ok: true });
    expect(verificarRateLimit).toHaveBeenCalledWith("reenvioCliente", "203.0.113.7");
    const arg = resend.mock.calls[0][0] as { type: string; email: string; options: { emailRedirectTo: string } };
    expect(arg.type).toBe("signup");
    expect(arg.email).toBe(EMAIL);
    const u = new URL(arg.options.emailRedirectTo);
    expect(u.pathname).toBe("/auth/callback");
    expect(u.searchParams.get("contexto")).toBe("cliente");
    expect(u.searchParams.get("next")).toBe("/loja/x");
  });
  it("next externo é descartado", async () => {
    const { reenviarConfirmacaoCliente } = await carregar();
    await executar(reenviarConfirmacaoCliente, { email: EMAIL, next: "//evil.com" });
    const arg = resend.mock.calls[0][0] as { options: { emailRedirectTo: string } };
    expect(arg.options.emailRedirectTo).not.toContain("evil");
  });
  it("erro ou exceção do GoTrue → resposta neutra idêntica", async () => {
    const { reenviarConfirmacaoCliente } = await carregar();
    resend.mockResolvedValueOnce({ data: null, error: { status: 422, code: "x" } });
    expect(await executar(reenviarConfirmacaoCliente, { email: EMAIL })).toEqual({ ok: true });
    resend.mockRejectedValueOnce(new Error("rede"));
    expect(await executar(reenviarConfirmacaoCliente, { email: EMAIL })).toEqual({ ok: true });
  });
  it("rate limit estourado → erro, sem resend", async () => {
    const { reenviarConfirmacaoCliente } = await carregar();
    verificarRateLimit.mockResolvedValueOnce({ permitido: false });
    const r = await executar(reenviarConfirmacaoCliente, { email: EMAIL });
    expect(r.ok).toBe(false);
    expect(resend).not.toHaveBeenCalled();
  });
  it("payload inválido / campo extra → erro, sem resend", async () => {
    const { reenviarConfirmacaoCliente } = await carregar();
    expect((await executar(reenviarConfirmacaoCliente, { email: "x" })).ok).toBe(false);
    expect((await executar(reenviarConfirmacaoCliente, { email: EMAIL, papel: "admin" })).ok).toBe(false);
    expect(resend).not.toHaveBeenCalled();
  });
  it("LIMITES.reenvioCliente = 1 por minuto", async () => {
    const { LIMITES } = (await vi.importActual("@/lib/utils/rateLimit")) as {
      LIMITES: Record<string, { limite: number; janela: string } | undefined>;
    };
    expect(LIMITES.reenvioCliente).toEqual({ limite: 1, janela: "1 m" });
  });
});
