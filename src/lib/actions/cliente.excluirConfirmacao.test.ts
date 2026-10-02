// RED (D8): excluirConta exige { confirmacao: "EXCLUIR" }. Preâmbulo copiado de cliente.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) — issue 337, camada servidor (B1 servidor + B2 P15).
 * Alvo: `src/lib/actions/cliente.ts` (ainda não existe).
 *
 * Invariantes provadas:
 *  - id SEMPRE de `getUser()` da sessão; id/cliente_id/versão no payload → rejeitado.
 *  - excluirConta: só-cliente → anonimizar_cliente → deleteUser → signOut;
 *    lojista+cliente e admin(env SAAS_ADMIN_USER_ID)+cliente → só anonimizar_cliente.
 *  - completarPerfilCliente: aceite literal true, VERSAO_TERMOS do servidor,
 *    e-mail confirmado, 18+.
 *  - endereços: teto 3 e mínimo 1 com as mensagens do spec.
 *
 * Papéis são lidos pela query REAL `buscarPapeisDoUsuario` (tabela
 * `papeis_usuario`, nunca JWT) sobre o fake PostgREST abaixo — o mesmo dado é
 * servido pelo client da sessão e pelo service_role, então o teste não decide
 * qual dos dois a action usa. `ehAdminSaaS` é REAL (env por caso).
 * Import dinâmico por caso (padrão de `papeis.test.ts`). Dados fictícios.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OUTRO_ID = "99999999-9999-9999-9999-999999999999";

// ── fake PostgREST encadeável (mesmo helper de clienteAuth.test.ts) ────────────
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

/** Mesmo dado nas duas pontas (sessão e service_role). */
function responder(tabela: string, r: Partial<Record<"select" | "insert" | "update" | "delete", Resposta>>) {
  dbSessao.respostas[tabela] = r;
  dbServico.respostas[tabela] = r;
}

let dbSessao = criarFakeDb();
let dbServico = criarFakeDb();

// ── Supabase sessão ───────────────────────────────────────────────────────────
const getUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: (...a: unknown[]) => getUser(...a), signOut: (...a: unknown[]) => signOut(...a) },
      from: (t: string) => dbSessao.from(t),
      rpc: (...a: unknown[]) => rpcSessao(...a),
    }),
}));
const rpcSessao = vi.fn();

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

// ── request scope ─────────────────────────────────────────────────────────────
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

type Resultado = { ok: boolean; erro?: string; [k: string]: unknown };
type Acao = (p?: unknown) => Promise<Resultado>;
type Mod = {
  completarPerfilCliente: Acao;
  salvarPerfilCliente: Acao;
  salvarEnderecoCliente: Acao;
  removerEnderecoCliente: Acao;
  excluirConta: Acao;
};
async function carregar(): Promise<Mod> {
  return (await import("./cliente")) as unknown as Mod;
}
async function executar(acao: Acao, payload: unknown): Promise<Resultado> {
  try {
    return await acao(payload);
  } catch (e) {
    if (e instanceof Redirecionou) return { ok: true, destino: e.destino };
    throw e;
  }
}

const usuario = (extra: Record<string, unknown> = {}) => ({
  id: USER_ID,
  email: "pessoa@exemplo.test",
  email_confirmed_at: "2026-09-01T10:00:00.000Z",
  ...extra,
});
const papeis = (...p: string[]) => responder("papeis_usuario", { select: { data: p.map((papel) => ({ papel })) } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "77777777-7777-7777-7777-777777777777");
  dbSessao = criarFakeDb();
  dbServico = criarFakeDb();
  getUser.mockResolvedValue({ data: { user: usuario() }, error: null });
  signOut.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: null, error: null });
  rpcSessao.mockResolvedValue({ data: null, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  verificarRateLimit.mockResolvedValue({ permitido: true });
  papeis("cliente");
  responder("clientes", { select: { data: [{ id: USER_ID }] } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});


describe("D8 — excluirConta exige confirmação EXCLUIR", () => {
  for (const payload of [{}, undefined, null, { confirmacao: "excluir" }, { confirmacao: "EXCLUIR " }, { confirmacao: "" }, { confirmacao: "EXCLUIR", id: OUTRO_ID }]) {
    it(`payload ${JSON.stringify(payload)} → erro, nada apagado`, async () => {
      const { excluirConta } = await carregar();
      const r = await executar(excluirConta, payload);
      expect(r.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    });
  }
  it('{ confirmacao: "EXCLUIR" } → anonimiza e redireciona', async () => {
    const { excluirConta } = await carregar();
    const r = await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: true, destino: "/" });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
  });
});
