import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VERSAO_TERMOS } from "@/lib/constants/termos";

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
const END_ID = "44444444-4444-4444-4444-444444444444";
const MSG_18 = "Você precisa ter 18 anos ou mais para criar uma conta.";
const MSG_TETO = "Você pode ter até 3 endereços.";
const MSG_MINIMO = "Mantenha pelo menos um endereço.";

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
const todasChamadas = () => [...dbSessao.chamadas, ...dbServico.chamadas];

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
const endereco = () => ({
  rotulo: "Casa",
  cep: "01001-000",
  rua: "Rua Exemplo",
  numero: "100",
  bairro: "Centro",
  cidade: "Cidade Teste",
  uf: "SP",
});
const perfil = () => ({
  nome: "Pessoa Teste",
  telefone: "(11) 90000-0000",
  data_nascimento: "1990-05-10",
  aceita_marketing: false,
});
const completar = () => ({ ...perfil(), aceiteTermos: true, endereco: endereco() });
const papeis = (...p: string[]) => responder("papeis_usuario", { select: { data: p.map((papel) => ({ papel })) } });
const rpcNomes = () => [...rpc.mock.calls, ...rpcSessao.mock.calls].map((c) => c[0]);

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

// ═════════════════════════════ excluirConta ═══════════════════════════════════
describe("excluirConta — id só da sessão", () => {
  it("ATAQUE: payload com id de outra conta → rejeitado; nada é chamado com esse id", async () => {
    const { excluirConta } = await carregar();
    const r = await executar(excluirConta, { id: OUTRO_ID });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(OUTRO_ID);
    expect(JSON.stringify(deleteUser.mock.calls)).not.toContain(OUTRO_ID);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("sem sessão → nada é apagado", async () => {
    const { excluirConta } = await carregar();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const r = await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("excluirConta — RN-13", () => {
  it("só-cliente → anonimizar_cliente(uid) ANTES de deleteUser(uid), depois signOut", async () => {
    const { excluirConta } = await carregar();
    papeis("cliente");
    await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(signOut).toHaveBeenCalled();
    const iAnon = rpc.mock.invocationCallOrder[rpc.mock.calls.findIndex((c) => c[0] === "anonimizar_cliente")];
    expect(iAnon).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
    expect(deleteUser.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("lojista+cliente → só anonimizar_cliente; deleteUser NÃO chamado; papéis intactos", async () => {
    const { excluirConta } = await carregar();
    papeis("lojista", "cliente");
    await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(todasChamadas().some((c) => c.tabela === "papeis_usuario" && c.metodo === "delete")).toBe(false);
  });

  it("admin (env SAAS_ADMIN_USER_ID) + cliente → só anonimizar_cliente; deleteUser NÃO chamado", async () => {
    const { excluirConta } = await carregar();
    vi.stubEnv("SAAS_ADMIN_USER_ID", USER_ID);
    papeis("cliente");
    await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("falha ao ler papéis → fail-closed: NÃO chama deleteUser", async () => {
    const { excluirConta } = await carregar();
    responder("papeis_usuario", { select: { data: null, error: { message: "falha", code: "XX000" } } });
    const r = await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("XX000");
  });

  it("anonimizar_cliente falha → NÃO chama deleteUser; erro genérico", async () => {
    const { excluirConta } = await carregar();
    rpc.mockImplementation(async (nome: string) =>
      nome === "anonimizar_cliente" ? { data: null, error: { message: "detalhe interno", code: "XX000" } } : { data: null, error: null },
    );
    const r = await executar(excluirConta, { confirmacao: "EXCLUIR" });
    expect(r.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
  });
});

// ═════════════════════════════ completarPerfilCliente ═════════════════════════
describe("completarPerfilCliente — decisão 19, RN-09, id da sessão", () => {
  beforeEach(() => {
    responder("clientes", { select: { data: [] } }); // ainda sem perfil
  });

  it("válido → RPC criar_perfil_cliente com p_usuario da sessão e p_versao_termos = VERSAO_TERMOS; rate limit 'salvarPerfil'", async () => {
    const { completarPerfilCliente } = await carregar();
    await executar(completarPerfilCliente, completar());
    expect(verificarRateLimit).toHaveBeenCalledWith("salvarPerfil", "203.0.113.7");
    expect(rpc).toHaveBeenCalledWith(
      "criar_perfil_cliente",
      expect.objectContaining({ p_usuario: USER_ID, p_versao_termos: VERSAO_TERMOS }),
    );
  });

  it("sem aceiteTermos → rejeitado; RPC NÃO chamada", async () => {
    const { completarPerfilCliente } = await carregar();
    const { aceiteTermos: _a, ...semAceite } = completar();
    const r = await executar(completarPerfilCliente, semAceite);
    expect(r.ok).toBe(false);
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("ATAQUE: versão no payload → rejeitado (.strict()); RPC NÃO chamada com versão forjada", async () => {
    const { completarPerfilCliente } = await carregar();
    const r = await executar(completarPerfilCliente, { ...completar(), versao: "1999-01-01" });
    expect(r.ok).toBe(false);
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("ATAQUE: id de outra conta no payload → rejeitado; RPC NÃO chamada", async () => {
    const { completarPerfilCliente } = await carregar();
    const r = await executar(completarPerfilCliente, { ...completar(), id: OUTRO_ID });
    expect(r.ok).toBe(false);
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("e-mail não confirmado → recusado; RPC NÃO chamada", async () => {
    const { completarPerfilCliente } = await carregar();
    getUser.mockResolvedValue({ data: { user: usuario({ email_confirmed_at: null }) }, error: null });
    const r = await executar(completarPerfilCliente, completar());
    expect(r.ok).toBe(false);
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("sem sessão → recusado; RPC NÃO chamada", async () => {
    const { completarPerfilCliente } = await carregar();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const r = await executar(completarPerfilCliente, completar());
    expect(r.ok).toBe(false);
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("17 anos (hoje fixo 2026-10-02) → mensagem da decisão 17; RPC NÃO chamada", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    const { completarPerfilCliente } = await carregar();
    const r = await executar(completarPerfilCliente, { ...completar(), data_nascimento: "2008-10-03" });
    expect(r).toEqual({ ok: false, erro: MSG_18 });
    expect(rpcNomes()).not.toContain("criar_perfil_cliente");
  });

  it("nunca grava 'lojista' nem cria loja", async () => {
    const { completarPerfilCliente } = await carregar();
    await executar(completarPerfilCliente, completar());
    expect(rpcNomes()).not.toContain("garantir_loja_do_dono");
    for (const c of rpc.mock.calls) expect(c[1]).not.toMatchObject({ p_papel: "lojista" });
  });
});

// ═════════════════════════════ salvarPerfilCliente ════════════════════════════
describe("salvarPerfilCliente", () => {
  it("UPDATE em clientes só com colunas editáveis, escopado pelo id da sessão", async () => {
    const { salvarPerfilCliente } = await carregar();
    await executar(salvarPerfilCliente, perfil());
    const upd = dbSessao.chamadas.find((c) => c.tabela === "clientes" && c.metodo === "update");
    expect(upd).toBeDefined();
    const cols = Object.keys(upd!.args[0] as object).sort();
    expect(cols.every((k) => ["aceita_marketing", "data_nascimento", "nome", "telefone"].includes(k))).toBe(true);
    expect(JSON.stringify(dbSessao.chamadas)).toContain(USER_ID);
  });

  for (const extra of ["id", "criado_em", "ultimo_acesso_em", "consentimento_em", "consentimento_versao"]) {
    it(`ATAQUE: '${extra}' no payload → rejeitado, sem UPDATE`, async () => {
      const { salvarPerfilCliente } = await carregar();
      const r = await executar(salvarPerfilCliente, { ...perfil(), [extra]: extra === "id" ? OUTRO_ID : "x" });
      expect(r.ok).toBe(false);
      expect(todasChamadas().some((c) => c.tabela === "clientes" && c.metodo === "update")).toBe(false);
    });
  }
});

// ═════════════════════════════ endereços ══════════════════════════════════════
describe("salvarEnderecoCliente", () => {
  it("ATAQUE: cliente_id no payload → rejeitado, sem INSERT/UPDATE", async () => {
    const { salvarEnderecoCliente } = await carregar();
    const r = await executar(salvarEnderecoCliente, { ...endereco(), cliente_id: OUTRO_ID });
    expect(r.ok).toBe(false);
    expect(
      todasChamadas().some((c) => c.tabela === "clientes_enderecos" && (c.metodo === "insert" || c.metodo === "update")),
    ).toBe(false);
  });

  it("novo endereço → INSERT com cliente_id = id da sessão (nunca do payload)", async () => {
    const { salvarEnderecoCliente } = await carregar();
    responder("clientes_enderecos", { select: { data: [{ id: END_ID }], count: 1 }, insert: { data: [{ id: "novo" }] } });
    await executar(salvarEnderecoCliente, endereco());
    const ins = todasChamadas().find((c) => c.tabela === "clientes_enderecos" && c.metodo === "insert");
    expect(ins).toBeDefined();
    const linha = (Array.isArray(ins!.args[0]) ? (ins!.args[0] as unknown[])[0] : ins!.args[0]) as Record<string, unknown>;
    expect(linha.cliente_id).toBe(USER_ID);
  });

  it("4º endereço → { ok:false, erro: 'Você pode ter até 3 endereços.' }", async () => {
    const { salvarEnderecoCliente } = await carregar();
    responder("clientes_enderecos", {
      select: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], count: 3 },
      insert: { data: null, error: { code: "P0001", message: "clientes_enderecos: limite de 3 endereços" } },
    });
    const r = await executar(salvarEnderecoCliente, endereco());
    expect(r).toEqual({ ok: false, erro: MSG_TETO });
  });
});

describe("removerEnderecoCliente", () => {
  it("último endereço → { ok:false, erro: 'Mantenha pelo menos um endereço.' }", async () => {
    const { removerEnderecoCliente } = await carregar();
    responder("clientes_enderecos", {
      select: { data: [{ id: END_ID, padrao: true }], count: 1 },
      delete: { data: null, error: { code: "P0001", message: "clientes_enderecos: mínimo de 1 endereço" } },
    });
    const r = await executar(removerEnderecoCliente, { id: END_ID });
    expect(r).toEqual({ ok: false, erro: MSG_MINIMO });
  });

  it("ATAQUE: cliente_id no payload → rejeitado, sem DELETE", async () => {
    const { removerEnderecoCliente } = await carregar();
    const r = await executar(removerEnderecoCliente, { id: END_ID, cliente_id: OUTRO_ID });
    expect(r.ok).toBe(false);
    expect(todasChamadas().some((c) => c.tabela === "clientes_enderecos" && c.metodo === "delete")).toBe(false);
  });
});
