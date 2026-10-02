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
const MSG_CONFIRME = "Confirme seu e-mail para entrar. Enviamos um link para você.";
const MSG_CREDENCIAL = "E-mail ou senha incorretos.";
const MSG_RECUPERACAO = "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha.";
const MSG_JA_CADASTRADO = "Este email já está cadastrado.";

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

const urlDe = (s: string) => new URL(s, "https://base.invalid");
const rpcNomes = () => rpc.mock.calls.map((c) => c[0]);

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
});
afterEach(() => vi.unstubAllEnvs());

// ═════════════════════════════ LIMITES ════════════════════════════════════════
describe("LIMITES — chaves novas da porta cliente (RN-16)", () => {
  for (const chave of ["cadastroCliente", "loginCliente", "recuperacaoCliente"]) {
    it(`LIMITES.${chave} existe e é ≤ 5 por minuto`, async () => {
      const { LIMITES } = (await vi.importActual("@/lib/utils/rateLimit")) as {
        LIMITES: Record<string, { limite: number; janela: string } | undefined>;
      };
      expect(LIMITES[chave]).toBeDefined();
      expect(LIMITES[chave]!.limite).toBeLessThanOrEqual(5);
      expect(LIMITES[chave]!.janela).toBe("1 m");
    });
  }

  it("não existe mais chave de OTP (alteração 23: recuperação por link)", async () => {
    const { LIMITES } = (await vi.importActual("@/lib/utils/rateLimit")) as { LIMITES: Record<string, unknown> };
    expect(LIMITES).toHaveProperty("recuperacaoCliente");
    expect(LIMITES).not.toHaveProperty("otpCliente");
  });
});

// ═════════════════════════════ cadastrarCliente ═══════════════════════════════
describe("cadastrarCliente", () => {
  const payload = () => ({ email: EMAIL, senha: "senha1234" });

  it("rate limit pela chave 'cadastroCliente' antes de tudo; excedido → ok:false sem signUp", async () => {
    const { cadastrarCliente } = await carregar();
    verificarRateLimit.mockResolvedValueOnce({ permitido: false });
    const r = await executar(cadastrarCliente, payload());
    expect(verificarRateLimit).toHaveBeenCalledWith("cadastroCliente", "203.0.113.7");
    expect(r.ok).toBe(false);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signUp SEM options.data e com emailRedirectTo /auth/callback?contexto=cliente", async () => {
    const { cadastrarCliente } = await carregar();
    const r = await executar(cadastrarCliente, payload());
    expect(r.ok).toBe(true);
    expect(signUp).toHaveBeenCalledTimes(1);
    const arg = signUp.mock.calls[0][0] as { email: string; password: string; options?: Record<string, unknown> };
    expect(arg.email).toBe(EMAIL);
    expect(arg.password).toBe("senha1234");
    expect(arg.options?.data).toBeUndefined();
    const redirect = urlDe(String(arg.options?.emailRedirectTo));
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("contexto")).toBe("cliente");
  });

  it("grava o papel 'cliente' (RPC atribuir_papel_inicial) com o id do signUp, logo após o signUp", async () => {
    const { cadastrarCliente } = await carregar();
    await executar(cadastrarCliente, payload());
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: USER_ID, p_papel: "cliente" });
    expect(signUp.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("NUNCA chama criarLoja, garantir_loja_do_dono nem deleteUser; nunca grava 'lojista'", async () => {
    const { cadastrarCliente } = await carregar();
    const r = await executar(cadastrarCliente, payload());
    expect(r.ok).toBe(true);
    expect(criarLoja).not.toHaveBeenCalled();
    expect(rpcNomes()).not.toContain("garantir_loja_do_dono");
    expect(deleteUser).not.toHaveBeenCalled();
    for (const c of rpc.mock.calls) expect(c[1]).not.toMatchObject({ p_papel: "lojista" });
  });

  it("nenhuma sessão é devolvida ao cliente (estado 'Confirme seu e-mail')", async () => {
    const { cadastrarCliente } = await carregar();
    const r = await executar(cadastrarCliente, payload());
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/access_token|session/i);
  });

  it("e-mail já cadastrado (signUp com erro) → mensagem, sem deleteUser", async () => {
    const { cadastrarCliente } = await carregar();
    signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "User already registered" } });
    const r = await executar(cadastrarCliente, payload());
    expect(r).toEqual({ ok: false, erro: MSG_JA_CADASTRADO });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("e-mail de conta lojista existente (RPC devolve ['lojista']) → mensagem, sem deleteUser, sem alterar a conta", async () => {
    const { cadastrarCliente } = await carregar();
    rpc.mockResolvedValueOnce({ data: ["lojista"], error: null });
    const r = await executar(cadastrarCliente, payload());
    expect(r).toEqual({ ok: false, erro: MSG_JA_CADASTRADO });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(rpcNomes()).not.toContain("adicionar_papel_cliente");
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("RN-05: RPC de papel falha → NÃO apaga a conta (sem deleteUser) e não lança", async () => {
    const { cadastrarCliente } = await carregar();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "detalhe interno", code: "XX000" } });
    const r = await executar(cadastrarCliente, payload());
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
  });

  for (const extra of ["aceiteTermos", "nome", "telefone", "papel", "loja_id", "id", "cliente_id"]) {
    it(`ATAQUE: '${extra}' no payload → ok:false sem signUp (.strict())`, async () => {
      const { cadastrarCliente } = await carregar();
      const r = await executar(cadastrarCliente, { ...payload(), [extra]: extra === "aceiteTermos" ? true : "lojista" });
      expect(r.ok).toBe(false);
      expect(signUp).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  }
});

// ═════════════════════════════ entrarCliente ══════════════════════════════════
describe("entrarCliente", () => {
  const payload = () => ({ email: EMAIL, senha: "senha1234" });

  it("rate limit pela chave 'loginCliente'; excedido → ok:false sem signIn", async () => {
    const { entrarCliente } = await carregar();
    verificarRateLimit.mockResolvedValueOnce({ permitido: false });
    const r = await executar(entrarCliente, payload());
    expect(verificarRateLimit).toHaveBeenCalledWith("loginCliente", "203.0.113.7");
    expect(r.ok).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("sucesso → ok, signInWithPassword com as credenciais; não grava papel", async () => {
    const { entrarCliente } = await carregar();
    const r = await executar(entrarCliente, payload());
    expect(r.ok).toBe(true);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: "senha1234" });
    expect(rpcNomes()).not.toContain("atribuir_papel_inicial");
    expect(rpcNomes()).not.toContain("adicionar_papel_cliente");
  });

  it("decisão 18: GoTrue recusa por e-mail não confirmado → mensagem exata, ok:false", async () => {
    const { entrarCliente } = await carregar();
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "email_not_confirmed", message: "Email not confirmed", status: 400 },
    });
    const r = await executar(entrarCliente, payload());
    expect(r).toEqual({ ok: false, erro: MSG_CONFIRME });
  });

  it("decisão 18: sessão aberta com email_confirmed_at nulo → signOut e mensagem exata", async () => {
    const { entrarCliente } = await carregar();
    signInWithPassword.mockResolvedValueOnce({
      data: { user: { ...usuarioConfirmado, email_confirmed_at: null }, session: { access_token: "t" } },
      error: null,
    });
    const r = await executar(entrarCliente, payload());
    expect(signOut).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, erro: MSG_CONFIRME });
  });

  it("anti-enumeração: senha errada e e-mail inexistente → MESMA mensagem genérica", async () => {
    const { entrarCliente } = await carregar();
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
    });
    const senhaErrada = await executar(entrarCliente, payload());
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
    });
    const inexistente = await executar(entrarCliente, { ...payload(), email: "ninguem@exemplo.test" });
    expect(senhaErrada).toEqual({ ok: false, erro: MSG_CREDENCIAL });
    expect(inexistente).toEqual(senhaErrada);
  });

  it("payload malformado → mesma mensagem genérica, sem signIn", async () => {
    const { entrarCliente } = await carregar();
    const r = await executar(entrarCliente, { email: "x" });
    expect(r).toEqual({ ok: false, erro: MSG_CREDENCIAL });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  for (const extra of ["papel", "loja_id"]) {
    it(`ATAQUE: '${extra}' injetado → ok:false sem signIn (.strict())`, async () => {
      const { entrarCliente } = await carregar();
      const r = await executar(entrarCliente, { ...payload(), [extra]: "lojista" });
      expect(r.ok).toBe(false);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });
  }

  it("login com perfil existente atualiza clientes.ultimo_acesso_em via service_role", async () => {
    const { entrarCliente } = await carregar();
    dbServico.respostas.clientes = { select: { data: [{ id: USER_ID }] }, update: { data: null } };
    dbSessao.respostas.clientes = { select: { data: [{ id: USER_ID }] } };
    const r = await executar(entrarCliente, payload());
    expect(r.ok).toBe(true);
    const update = dbServico.chamadas.find((c) => c.tabela === "clientes" && c.metodo === "update");
    expect(update).toBeDefined();
    expect(Object.keys(update!.args[0] as object)).toEqual(["ultimo_acesso_em"]);
    expect(dbSessao.chamadas.find((c) => c.tabela === "clientes" && c.metodo === "update")).toBeUndefined();
  });
});

// ═════════════════════════════ solicitarRecuperacaoCliente ════════════════════
describe("solicitarRecuperacaoCliente (link, decisão 10 alterada)", () => {
  it("rate limit pela chave 'recuperacaoCliente'", async () => {
    const { solicitarRecuperacaoCliente } = await carregar();
    await executar(solicitarRecuperacaoCliente, { email: EMAIL });
    expect(verificarRateLimit).toHaveBeenCalledWith("recuperacaoCliente", "203.0.113.7");
  });

  it("chama resetPasswordForEmail com redirectTo /auth/callback?contexto=cliente&next=/conta/recuperar?etapa=nova-senha", async () => {
    const { solicitarRecuperacaoCliente } = await carregar();
    await executar(solicitarRecuperacaoCliente, { email: EMAIL });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [email, opcoes] = resetPasswordForEmail.mock.calls[0] as [string, { redirectTo: string }];
    expect(email).toBe(EMAIL);
    const u = urlDe(opcoes.redirectTo);
    expect(u.pathname).toBe("/auth/callback");
    expect(u.searchParams.get("contexto")).toBe("cliente");
    const next = urlDe(u.searchParams.get("next") ?? "");
    expect(next.pathname).toBe("/conta/recuperar");
    expect(next.searchParams.get("etapa")).toBe("nova-senha");
  });

  it("anti-enumeração: existente, inexistente, conta só-Google e falha do GoTrue → resposta IDÊNTICA; reset chamado em todos", async () => {
    const { solicitarRecuperacaoCliente } = await carregar();
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null }); // existente
    const existente = await executar(solicitarRecuperacaoCliente, { email: EMAIL });
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { message: "User not found", status: 404 } });
    const inexistente = await executar(solicitarRecuperacaoCliente, { email: "ninguem@exemplo.test" });
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null }); // só-Google: GoTrue aceita
    const google = await executar(solicitarRecuperacaoCliente, { email: "google@exemplo.test" });
    resetPasswordForEmail.mockRejectedValueOnce(new Error("rede"));
    const falha = await executar(solicitarRecuperacaoCliente, { email: "outra@exemplo.test" });

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(4);
    expect(inexistente).toEqual(existente);
    expect(google).toEqual(existente);
    expect(falha).toEqual(existente);
    expect(JSON.stringify(existente)).toContain(MSG_RECUPERACAO);
  });

  it("ATAQUE: papel injetado → .strict() recusa, sem resetPasswordForEmail", async () => {
    const { solicitarRecuperacaoCliente } = await carregar();
    const r = await executar(solicitarRecuperacaoCliente, { email: EMAIL, papel: "lojista" });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(EMAIL);
  });
});

// ═════════════════════════════ redefinirSenhaCliente ══════════════════════════
describe("redefinirSenhaCliente", () => {
  const payload = () => ({ senha: "novaSenha1", confirmacao: "novaSenha1" });

  it("com sessão de recuperação → updateUser({ password }) e ok", async () => {
    const { redefinirSenhaCliente } = await carregar();
    const r = await executar(redefinirSenhaCliente, payload());
    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha1" });
    expect(r.ok).toBe(true);
  });

  it("SEM sessão de recuperação → erro genérico, updateUser NÃO chamado", async () => {
    const { redefinirSenhaCliente } = await carregar();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "Auth session missing!" } });
    const r = await executar(redefinirSenhaCliente, payload());
    expect(r.ok).toBe(false);
    expect(typeof r.erro).toBe("string");
    expect(r.erro).not.toContain("session");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updateUser falha → erro genérico sem detalhe interno", async () => {
    const { redefinirSenhaCliente } = await carregar();
    updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "detalhe interno GoTrue" } });
    const r = await executar(redefinirSenhaCliente, payload());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
  });

  it("confirmação divergente ou senha curta → ok:false sem updateUser", async () => {
    const { redefinirSenhaCliente } = await carregar();
    expect((await executar(redefinirSenhaCliente, { senha: "novaSenha1", confirmacao: "outra123" })).ok).toBe(false);
    expect((await executar(redefinirSenhaCliente, { senha: "curta", confirmacao: "curta" })).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("ATAQUE: papel/loja_id injetados → ok:false sem updateUser", async () => {
    const { redefinirSenhaCliente } = await carregar();
    expect((await executar(redefinirSenhaCliente, { ...payload(), papel: "lojista" })).ok).toBe(false);
    expect((await executar(redefinirSenhaCliente, { ...payload(), loja_id: "x" })).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
