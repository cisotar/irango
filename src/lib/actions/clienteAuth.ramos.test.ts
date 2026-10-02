import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P18 — ramos de `src/lib/actions/clienteAuth.ts` que o RED não cobre: origem
 * dos links (headers controláveis por caso), `next` sanitizado/encodado dentro
 * dos links do GoTrue e no destino, falhas de infraestrutura (throw), RN-05,
 * best-effort do ultimo_acesso_em. Dados fictícios.
 */
const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "pessoa@exemplo.test";
const MSG_CREDENCIAL = "E-mail ou senha incorretos.";
const MSG_CADASTRO_FALHOU = "Não foi possível concluir o cadastro. Tente novamente.";
const MSG_LINK = "Link inválido ou expirado. Peça um novo link.";
const MSG_NOVA_SENHA_FALHOU = "Não foi possível redefinir a senha. Tente novamente.";

let headersAtuais = new Headers();
vi.mock("next/headers", () => ({ headers: () => headersAtuais }));

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
        getClaims: async () => ({ data: { claims: { amr: [{ method: "recovery", timestamp: 1 }] } }, error: null }),
      },
    }),
}));
const rpc = vi.fn();
const deleteUser = vi.fn();
const updateClientes = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
    from: (t: string) => ({
      update: (v: unknown) => ({ eq: (c: string, id: string) => updateClientes(t, v, c, id) }),
    }),
  }),
}));
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: (h: Headers) => h.get("x-forwarded-for") ?? "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

import * as acoes from "./clienteAuth";

const usuarioConfirmado = { id: USER_ID, email: EMAIL, email_confirmed_at: "2026-09-01T10:00:00.000Z" };
const cad = (extra: Record<string, unknown> = {}) => ({ email: EMAIL, senha: "senha1234", ...extra });
const emailRedirectTo = () => new URL((signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo);
const redirectTo = () => new URL((resetPasswordForEmail.mock.calls[0][1] as { redirectTo: string }).redirectTo);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  headersAtuais = new Headers({ origin: "https://app.local" });
  verificarRateLimit.mockResolvedValue({ permitido: true });
  signUp.mockResolvedValue({ data: { user: { id: USER_ID, email_confirmed_at: null }, session: null }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: usuarioConfirmado, session: {} }, error: null });
  signOut.mockResolvedValue({ error: null });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  updateUser.mockResolvedValue({ data: {}, error: null });
  getUser.mockResolvedValue({ data: { user: usuarioConfirmado }, error: null });
  rpc.mockResolvedValue({ data: ["cliente"], error: null });
  deleteUser.mockResolvedValue({ error: null });
  updateClientes.mockResolvedValue({ error: null });
});

// ═════════════════════════ origem dos links ═════════════════════════════════
describe("origem do emailRedirectTo (vem dos headers, nunca do payload)", () => {
  it("usa o header origin normalizado (path/query do origin são descartados)", async () => {
    headersAtuais = new Headers({ origin: "https://app.local/algum/caminho?x=1" });
    await acoes.cadastrarCliente(cad());
    expect(emailRedirectTo().origin).toBe("https://app.local");
    expect(emailRedirectTo().pathname).toBe("/auth/callback");
  });
  it("sem origin → x-forwarded-host + x-forwarded-proto", async () => {
    headersAtuais = new Headers({ "x-forwarded-host": "irango.example", "x-forwarded-proto": "https", host: "interno:3000" });
    await acoes.cadastrarCliente(cad());
    expect(emailRedirectTo().origin).toBe("https://irango.example");
  });
  it("origin inválido ('null', lixo) cai para o host", async () => {
    headersAtuais = new Headers({ origin: "null", host: "irango.example" });
    await acoes.cadastrarCliente(cad());
    expect(emailRedirectTo().host).toBe("irango.example");
  });
  it("sem nenhum header → fallback localhost:3000 (dev), nunca vazio", async () => {
    headersAtuais = new Headers();
    await acoes.cadastrarCliente(cad());
    expect(emailRedirectTo().host).toBe("localhost:3000");
  });
  it("campo 'origem'/'redirectTo' no payload → .strict() recusa; signUp não ocorre", async () => {
    for (const k of ["origem", "redirectTo", "emailRedirectTo"]) {
      const r = await acoes.cadastrarCliente(cad({ [k]: "https://evil.com" }));
      expect(r.ok).toBe(false);
    }
    expect(signUp).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ cadastrarCliente ═════════════════════════════════
describe("cadastrarCliente — ramos", () => {
  it("next interno vai codificado no emailRedirectTo; contexto=cliente permanece único", async () => {
    await acoes.cadastrarCliente(cad({ next: "/loja/x?a=1&contexto=lojista" }));
    const u = emailRedirectTo();
    expect(u.searchParams.getAll("contexto")).toEqual(["cliente"]);
    expect(u.searchParams.get("next")).toBe("/loja/x?a=1&contexto=lojista");
  });
  it("next externo / protocol-relative é descartado do link", async () => {
    for (const next of ["https://evil.com", "//evil.com", "evil"]) {
      signUp.mockClear();
      await acoes.cadastrarCliente(cad({ next }));
      expect(emailRedirectTo().searchParams.has("next"), next).toBe(false);
      expect(emailRedirectTo().toString()).not.toContain("evil");
    }
  });
  it("signUp sem user e sem erro → 'já cadastrado' e NENHUMA RPC de papel", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    expect(await acoes.cadastrarCliente(cad())).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("signUp lança → mensagem genérica, sem papel, sem deleteUser, sem detalhe", async () => {
    signUp.mockRejectedValue(new Error("detalhe interno de rede"));
    const r = await acoes.cadastrarCliente(cad());
    expect(r).toEqual({ ok: false, erro: MSG_CADASTRO_FALHOU });
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("RPC de papel devolve lista vazia → 'já cadastrado' (nunca ok falso-positivo)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await acoes.cadastrarCliente(cad())).toEqual({ ok: true });
  });
  it("RPC devolve ['lojista','cliente'] → ok (conta já tem cliente)", async () => {
    rpc.mockResolvedValue({ data: ["lojista", "cliente"], error: null });
    expect(await acoes.cadastrarCliente(cad())).toEqual({ ok: true });
  });
  it("RPC de papel com erro → genérico e SEM deleteUser (RN-05); id usado é o do signUp", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "interno" } });
    const r = await acoes.cadastrarCliente(cad());
    expect(r).toEqual({ ok: false, erro: MSG_CADASTRO_FALHOU });
    expect(JSON.stringify(r)).not.toContain("interno");
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: USER_ID, p_papel: "cliente" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("rate limit usa o IP do request na chave 'cadastroCliente'", async () => {
    headersAtuais = new Headers({ origin: "https://app.local", "x-forwarded-for": "198.51.100.9" });
    await acoes.cadastrarCliente(cad());
    expect(verificarRateLimit).toHaveBeenCalledWith("cadastroCliente", "198.51.100.9");
  });
  for (const [rotulo, v] of [["null", null], ["undefined", undefined], ["[]", []], ["{}", {}], ["senha curta", cad({ senha: "1234567" })]] as const) {
    it(`payload ${rotulo} → ok:false sem signUp`, async () => {
      expect((await acoes.cadastrarCliente(v)).ok).toBe(false);
      expect(signUp).not.toHaveBeenCalled();
    });
  }
});

// ═════════════════════════ entrarCliente ════════════════════════════════════
describe("entrarCliente — destino e best-effort", () => {
  it("sem next → /minha-conta", async () => {
    expect(await acoes.entrarCliente(cad())).toEqual({ ok: true, destino: "/minha-conta" });
  });
  it("next interno é respeitado (inclusive com query)", async () => {
    expect(await acoes.entrarCliente(cad({ next: "/loja/pizzaria?mesa=3" }))).toEqual({ ok: true, destino: "/loja/pizzaria?mesa=3" });
  });
  it("next externo ou protocol-relative → /minha-conta (open redirect barrado)", async () => {
    for (const next of ["https://evil.com", "//evil.com", "javascript:alert(1)"]) {
      expect(await acoes.entrarCliente(cad({ next })), next).toEqual({ ok: true, destino: "/minha-conta" });
    }
  });
  it("falha ao registrar ultimo_acesso_em NÃO derruba o login", async () => {
    updateClientes.mockResolvedValue({ error: { code: "XX000" } });
    expect(await acoes.entrarCliente(cad())).toEqual({ ok: true, destino: "/minha-conta" });
  });
  it("ultimo_acesso_em é gravado para o id do usuário autenticado (não do payload)", async () => {
    await acoes.entrarCliente(cad());
    expect(updateClientes).toHaveBeenCalledWith("clientes", expect.objectContaining({ ultimo_acesso_em: expect.any(String) }), "id", USER_ID);
  });
  it("login que falha NÃO registra ultimo_acesso_em", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
    await acoes.entrarCliente(cad());
    expect(updateClientes).not.toHaveBeenCalled();
  });
  it("e-mail não confirmado NÃO registra ultimo_acesso_em", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { ...usuarioConfirmado, email_confirmed_at: null } }, error: null });
    await acoes.entrarCliente(cad());
    expect(updateClientes).not.toHaveBeenCalled();
  });
  it("signIn sem erro mas sem user → credencial genérica", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: null });
    expect(await acoes.entrarCliente(cad())).toEqual({ ok: false, erro: MSG_CREDENCIAL });
  });
  it("signIn lança → credencial genérica (sem vazar a exceção)", async () => {
    signInWithPassword.mockRejectedValue(new Error("ECONNRESET interno"));
    const r = await acoes.entrarCliente(cad());
    expect(r).toEqual({ ok: false, erro: MSG_CREDENCIAL });
  });
  it("nunca grava papel nem cria loja ao entrar", async () => {
    await acoes.entrarCliente(cad());
    expect(rpc).not.toHaveBeenCalled();
  });
  it("senha vazia → credencial genérica sem signIn", async () => {
    expect(await acoes.entrarCliente(cad({ senha: "" }))).toEqual({ ok: false, erro: MSG_CREDENCIAL });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ solicitarRecuperacaoCliente ══════════════════════
describe("solicitarRecuperacaoCliente — ramos", () => {
  it("sem next → redirectTo carrega só a etapa nova-senha dentro de contexto=cliente", async () => {
    await acoes.solicitarRecuperacaoCliente({ email: EMAIL });
    const u = redirectTo();
    expect(u.pathname).toBe("/auth/callback");
    expect(u.searchParams.get("contexto")).toBe("cliente");
    const interno = new URL(u.searchParams.get("next")!, "https://x.invalid");
    expect(interno.pathname).toBe("/conta/recuperar");
    expect(interno.searchParams.get("etapa")).toBe("nova-senha");
    expect(interno.searchParams.has("next")).toBe(false);
  });
  it("next com query sobrevive ao duplo encode (callback → página de recuperação)", async () => {
    await acoes.solicitarRecuperacaoCliente({ email: EMAIL, next: "/loja/x?a=1&b=2" });
    const interno = new URL(redirectTo().searchParams.get("next")!, "https://x.invalid");
    expect(interno.searchParams.get("etapa")).toBe("nova-senha");
    expect(interno.searchParams.get("next")).toBe("/loja/x?a=1&b=2");
  });
  it("next externo é descartado antes de entrar no link", async () => {
    await acoes.solicitarRecuperacaoCliente({ email: EMAIL, next: "//evil.com" });
    expect(redirectTo().toString()).not.toContain("evil");
    expect(new URL(redirectTo().searchParams.get("next")!, "https://x.invalid").searchParams.has("next")).toBe(false);
  });
  it("e-mail inválido → ok:false e GoTrue NÃO chamado", async () => {
    expect((await acoes.solicitarRecuperacaoCliente({ email: "x" })).ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("rate limit excedido → ok:false, GoTrue NÃO chamado", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    expect((await acoes.solicitarRecuperacaoCliente({ email: EMAIL })).ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("GoTrue LANÇA exceção → mesma resposta de sucesso (anti-enumeração)", async () => {
    const normal = await acoes.solicitarRecuperacaoCliente({ email: EMAIL });
    resetPasswordForEmail.mockRejectedValue(new Error("rede"));
    expect(await acoes.solicitarRecuperacaoCliente({ email: EMAIL })).toEqual(normal);
  });
  it("log de erro do GoTrue não contém o e-mail (sem PII)", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 429, code: "over_email_send_rate_limit", message: `x ${EMAIL}` } });
    await acoes.solicitarRecuperacaoCliente({ email: EMAIL });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(EMAIL);
  });
});

// ═════════════════════════ redefinirSenhaCliente ════════════════════════════
describe("redefinirSenhaCliente — ramos", () => {
  const nova = (extra: Record<string, unknown> = {}) => ({ senha: "novaSenha123", confirmacao: "novaSenha123", ...extra });
  it("sem next → /minha-conta; updateUser recebe SÓ a senha", async () => {
    expect(await acoes.redefinirSenhaCliente(nova())).toEqual({ ok: true, destino: "/minha-conta" });
    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha123" });
  });
  it("next interno respeitado; externo descartado", async () => {
    expect(await acoes.redefinirSenhaCliente(nova({ next: "/loja/x" }))).toEqual({ ok: true, destino: "/loja/x" });
    expect(await acoes.redefinirSenhaCliente(nova({ next: "//evil.com" }))).toEqual({ ok: true, destino: "/minha-conta" });
  });
  it("getUser com erro (sessão de recuperação expirada) → mensagem de link, sem updateUser", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } });
    expect(await acoes.redefinirSenhaCliente(nova())).toEqual({ ok: false, erro: MSG_LINK });
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("getUser ok mas sem user → mensagem de link", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await acoes.redefinirSenhaCliente(nova())).toEqual({ ok: false, erro: MSG_LINK });
  });
  it("updateUser LANÇA → genérico, sem destino", async () => {
    updateUser.mockRejectedValue(new Error("detalhe interno"));
    const r = await acoes.redefinirSenhaCliente(nova());
    expect(r).toEqual({ ok: false, erro: MSG_NOVA_SENHA_FALHOU });
    expect(JSON.stringify(r)).not.toContain("interno");
  });
  it("nunca grava papel", async () => {
    await acoes.redefinirSenhaCliente(nova());
    expect(rpc).not.toHaveBeenCalled();
  });
  it("senha de 72 aceita; 73 recusada sem updateUser", async () => {
    expect((await acoes.redefinirSenhaCliente({ senha: "a".repeat(72), confirmacao: "a".repeat(72) })).ok).toBe(true);
    updateUser.mockClear();
    expect((await acoes.redefinirSenhaCliente({ senha: "a".repeat(73), confirmacao: "a".repeat(73) })).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
