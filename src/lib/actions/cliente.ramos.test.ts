import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * P18 — ramos de `src/lib/actions/cliente.ts` que o RED (cliente.test.ts) não
 * cobre: CRUD de endereço (editar, escopo por sessão, teto/mínimo e corridas),
 * `definirEnderecoPadrao`, promoção do padrão ao remover, `excluirConta`
 * (papéis vazios, falha de deleteUser, ordem), perfil, completar (idempotência
 * 23505, redirect sanitizado), `sairCliente`.
 *
 * O fake registra CADEIAS PostgREST (tabela + passos) e aceita respostas por
 * (tabela, operação), inclusive em fila, para provar ordem e escopo das
 * escritas. Papéis lidos pela query real. Dados fictícios.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OUTRO_ID = "99999999-9999-9999-9999-999999999999";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // mais antigo
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MSG_TETO = "Você pode ter até 3 endereços.";
const MSG_MINIMO = "Mantenha pelo menos um endereço.";
const MSG_NAO_ENC = "Endereço não encontrado.";
const MSG_GENERICA = "Não foi possível salvar. Tente novamente.";
const MSG_DADOS = "Verifique os dados informados.";
const MSG_SESSAO = "Sua sessão expirou. Entre novamente.";
const MSG_EXCLUSAO = "Não foi possível excluir a conta. Tente novamente.";

type Op = "select" | "insert" | "update" | "delete";
type Resp = { data?: unknown; error?: unknown; count?: number | null };
type Passo = { m: string; args: unknown[] };
type Cadeia = { tabela: string; op: Op; passos: Passo[] };

function criarFakeDb() {
  const cadeias: Cadeia[] = [];
  const respostas: Record<string, Partial<Record<Op, Resp[]>>> = {};
  function from(tabela: string) {
    const cad: Cadeia = { tabela, op: "select", passos: [] };
    cadeias.push(cad);
    const resolver = (): Resp & { data: unknown } => {
      const fila = respostas[tabela]?.[cad.op];
      // última resposta é "pegajosa"; as anteriores são consumidas em ordem
      const r = (fila && (fila.length > 1 ? fila.shift() : fila[0])) ?? { data: null, error: null };
      let data = r.data ?? null;
      const ms = cad.passos.map((p) => p.m);
      if ((ms.includes("single") || ms.includes("maybeSingle")) && Array.isArray(data)) data = data[0] ?? null;
      return { data, error: r.error ?? null, count: r.count ?? (Array.isArray(r.data) ? r.data.length : null) };
    };
    const b: unknown = new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "then")
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko);
          return (...args: unknown[]) => {
            const m = String(p);
            if (m === "insert" || m === "update" || m === "delete") cad.op = m;
            cad.passos.push({ m, args });
            return b;
          };
        },
      },
    );
    return b;
  }
  return { from, cadeias, respostas };
}
let db = criarFakeDb();
const responder = (tabela: string, op: Op, ...rs: Resp[]) => {
  (db.respostas[tabela] ??= {})[op] = rs;
};
const escritas = (tabela: string, op: Op) => db.cadeias.filter((c) => c.tabela === tabela && c.op === op);
const arg = (c: Cadeia, m: string, i = 0) => c.passos.find((p) => p.m === m)?.args[i];
const eqs = (c: Cadeia) => c.passos.filter((p) => p.m === "eq").map((p) => p.args);

const getUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: (...a: unknown[]) => getUser(...a), signOut: (...a: unknown[]) => signOut(...a) },
      from: (t: string) => db.from(t),
    }),
}));
const rpc = vi.fn();
const deleteUser = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
    from: (t: string) => db.from(t),
  }),
}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
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

import * as acoes from "./cliente";

type R = { ok: boolean; erro?: string; destino?: string };
async function executar(f: (p?: unknown) => Promise<unknown>, payload?: unknown): Promise<R> {
  try {
    return (await f(payload)) as R;
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
const perfil = () => ({ nome: "Pessoa Teste", telefone: "(11) 90000-0000", data_nascimento: "1990-05-10", aceita_marketing: true });
const completar = () => ({ ...perfil(), aceiteTermos: true, endereco: endereco() });
const papeis = (...p: string[]) => responder("papeis_usuario", "select", { data: p.map((papel) => ({ papel })) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "77777777-7777-7777-7777-777777777777");
  db = criarFakeDb();
  getUser.mockResolvedValue({ data: { user: usuario() }, error: null });
  signOut.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: null, error: null });
  deleteUser.mockResolvedValue({ error: null });
  verificarRateLimit.mockResolvedValue({ permitido: true });
  papeis("cliente");
});
afterEach(() => vi.unstubAllEnvs());

// ═════════════════════════ salvarEnderecoCliente ═════════════════════════════
describe("salvarEnderecoCliente — editar", () => {
  it("UPDATE escopado por id E cliente_id da sessão; valores não carregam cliente_id/padrao/id", async () => {
    responder("clientes_enderecos", "update", { data: [{ id: A }] });
    const r = await executar(acoes.salvarEnderecoCliente, { ...endereco(), id: A, complemento: "Ap 2" });
    expect(r).toEqual({ ok: true });
    const [u] = escritas("clientes_enderecos", "update");
    expect(eqs(u)).toEqual(expect.arrayContaining([["id", A], ["cliente_id", USER_ID]]));
    const valores = arg(u, "update") as Record<string, unknown>;
    expect(valores).not.toHaveProperty("cliente_id");
    expect(valores).not.toHaveProperty("padrao");
    expect(valores).not.toHaveProperty("id");
    expect(valores.complemento).toBe("Ap 2");
    expect(revalidatePath).toHaveBeenCalledWith("/minha-conta/enderecos");
  });

  it("endereço de OUTRO usuário (RLS/filtro devolve 0 linhas) → 'Endereço não encontrado.'", async () => {
    responder("clientes_enderecos", "update", { data: [] });
    expect(await executar(acoes.salvarEnderecoCliente, { ...endereco(), id: A })).toEqual({ ok: false, erro: MSG_NAO_ENC });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("complemento ausente → grava null explícito (limpa o valor antigo)", async () => {
    responder("clientes_enderecos", "update", { data: [{ id: A }] });
    await executar(acoes.salvarEnderecoCliente, { ...endereco(), id: A });
    const valores = arg(escritas("clientes_enderecos", "update")[0], "update") as Record<string, unknown>;
    expect(valores.complemento).toBeNull();
  });

  it("id que não é guid → dados inválidos, nenhuma escrita", async () => {
    expect(await executar(acoes.salvarEnderecoCliente, { ...endereco(), id: "x' or '1'='1" })).toEqual({ ok: false, erro: MSG_DADOS });
    expect(db.cadeias).toHaveLength(0);
  });

  it("erro do banco no UPDATE → genérico, sem código/mensagem internos", async () => {
    responder("clientes_enderecos", "update", { error: { code: "XX000", message: "relation secreta" } });
    const r = await executar(acoes.salvarEnderecoCliente, { ...endereco(), id: A });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(JSON.stringify(r)).not.toContain("secreta");
  });
});

describe("salvarEnderecoCliente — criar", () => {
  it("com 2 endereços → INSERT permitido com padrao=false e cliente_id da sessão", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: A }, { id: B }], count: 2 });
    const r = await executar(acoes.salvarEnderecoCliente, endereco());
    expect(r).toEqual({ ok: true });
    const [ins] = escritas("clientes_enderecos", "insert");
    expect(arg(ins, "insert")).toMatchObject({ cliente_id: USER_ID, padrao: false, rotulo: "Casa", complemento: null });
  });

  it("com 3 endereços → teto, e NENHUM INSERT é tentado", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: A }, { id: B }, { id: C }], count: 3 });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_TETO });
    expect(escritas("clientes_enderecos", "insert")).toHaveLength(0);
  });

  it("a contagem é feita só nos endereços DA SESSÃO", async () => {
    responder("clientes_enderecos", "select", { data: [], count: 0 });
    await executar(acoes.salvarEnderecoCliente, endereco());
    const contagem = db.cadeias.find((c) => c.op === "select")!;
    expect(eqs(contagem)).toContainEqual(["cliente_id", USER_ID]);
  });

  it("corrida: contagem 2 mas trigger do banco recusa (23514 'teto') → mensagem de teto", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: A }, { id: B }], count: 2 });
    responder("clientes_enderecos", "insert", { error: { code: "23514", message: "clientes_enderecos: teto de endereços" } });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_TETO });
  });

  it("23514 de OUTRA regra (sem 'teto') → genérico, não a mensagem de teto", async () => {
    responder("clientes_enderecos", "select", { data: [], count: 0 });
    responder("clientes_enderecos", "insert", { error: { code: "23514", message: "check constraint cep" } });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_GENERICA });
  });

  it("falha ao contar → genérico e nenhum INSERT", async () => {
    responder("clientes_enderecos", "select", { error: { code: "XX000" } });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(escritas("clientes_enderecos", "insert")).toHaveLength(0);
  });

  it("sem sessão → 'sessão expirou', nenhuma consulta de endereço", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_SESSAO });
    expect(db.cadeias).toHaveLength(0);
  });

  it("getUser com erro (token inválido) também é 'sem sessão'", async () => {
    getUser.mockResolvedValue({ data: { user: usuario() }, error: { message: "jwt expired" } });
    expect(await executar(acoes.salvarEnderecoCliente, endereco())).toEqual({ ok: false, erro: MSG_SESSAO });
  });

  for (const [rotulo, v] of [["null", null], ["undefined", undefined], ["[]", []], ["{}", {}]] as const) {
    it(`payload ${rotulo} → dados inválidos, nenhuma escrita`, async () => {
      expect(await executar(acoes.salvarEnderecoCliente, v)).toEqual({ ok: false, erro: MSG_DADOS });
      expect(db.cadeias).toHaveLength(0);
    });
  }
});

// ═════════════════════════ definirEnderecoPadrao ═════════════════════════════
describe("definirEnderecoPadrao", () => {
  it("troca em duas escritas ORDENADAS: desmarca o padrão atual, depois marca o alvo; ambas escopadas pela sessão", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: B, padrao: false }] });
    const r = await executar(acoes.definirEnderecoPadrao, { id: B });
    expect(r).toEqual({ ok: true });
    const upds = escritas("clientes_enderecos", "update");
    expect(upds).toHaveLength(2);
    expect(arg(upds[0], "update")).toEqual({ padrao: false });
    expect(eqs(upds[0])).toEqual(expect.arrayContaining([["cliente_id", USER_ID], ["padrao", true]]));
    expect(arg(upds[1], "update")).toEqual({ padrao: true });
    expect(eqs(upds[1])).toEqual(expect.arrayContaining([["id", B], ["cliente_id", USER_ID]]));
    expect(db.cadeias.indexOf(upds[0])).toBeLessThan(db.cadeias.indexOf(upds[1])); // índice único parcial
    expect(revalidatePath).toHaveBeenCalledWith("/minha-conta/enderecos");
  });

  it("a busca do alvo é escopada por id E cliente_id (endereço alheio não é marcável)", async () => {
    responder("clientes_enderecos", "select", { data: [] });
    const r = await executar(acoes.definirEnderecoPadrao, { id: B });
    expect(r).toEqual({ ok: false, erro: MSG_NAO_ENC });
    expect(eqs(db.cadeias[0])).toEqual(expect.arrayContaining([["id", B], ["cliente_id", USER_ID]]));
    expect(escritas("clientes_enderecos", "update")).toHaveLength(0);
  });

  it("alvo já é o padrão → ok sem nenhuma escrita (idempotente)", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: B, padrao: true }] });
    expect(await executar(acoes.definirEnderecoPadrao, { id: B })).toEqual({ ok: true });
    expect(escritas("clientes_enderecos", "update")).toHaveLength(0);
  });

  it("falha ao DESMARCAR → genérico e o alvo NÃO é marcado", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: B, padrao: false }] });
    responder("clientes_enderecos", "update", { error: { code: "XX000", message: "interno" } });
    const r = await executar(acoes.definirEnderecoPadrao, { id: B });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(escritas("clientes_enderecos", "update")).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("interno");
  });

  it("falha ao MARCAR (2ª escrita) → erro genérico", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: B, padrao: false }] });
    responder("clientes_enderecos", "update", { data: null }, { error: { code: "23505" } });
    expect(await executar(acoes.definirEnderecoPadrao, { id: B })).toEqual({ ok: false, erro: MSG_GENERICA });
  });

  it("id não-guid, cliente_id injetado ou vazio → dados inválidos sem I/O", async () => {
    for (const p of [{ id: "x" }, { id: B, cliente_id: OUTRO_ID }, {}, null, undefined]) {
      expect(await executar(acoes.definirEnderecoPadrao, p)).toEqual({ ok: false, erro: MSG_DADOS });
    }
    expect(db.cadeias).toHaveLength(0);
  });

  it("sem sessão → 'sessão expirou', sem consulta", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await executar(acoes.definirEnderecoPadrao, { id: B })).toEqual({ ok: false, erro: MSG_SESSAO });
    expect(db.cadeias).toHaveLength(0);
  });
});

// ═════════════════════════ removerEnderecoCliente ════════════════════════════
describe("removerEnderecoCliente — promoção do padrão", () => {
  const lista = (padrao: string) => [A, B, C].map((id) => ({ id, padrao: id === padrao }));

  it("remove o PADRÃO (B) de 3 → deleta B e promove o mais antigo restante (A), escopado pela sessão", async () => {
    responder("clientes_enderecos", "select", { data: lista(B) });
    expect(await executar(acoes.removerEnderecoCliente, { id: B })).toEqual({ ok: true });
    const [del] = escritas("clientes_enderecos", "delete");
    expect(eqs(del)).toEqual(expect.arrayContaining([["id", B], ["cliente_id", USER_ID]]));
    const [prom] = escritas("clientes_enderecos", "update");
    expect(arg(prom, "update")).toEqual({ padrao: true });
    expect(eqs(prom)).toEqual(expect.arrayContaining([["id", A], ["cliente_id", USER_ID]]));
    expect(db.cadeias.indexOf(del)).toBeLessThan(db.cadeias.indexOf(prom));
  });

  it("remove o padrão que é o MAIS ANTIGO (A) → promove o próximo (B), não o último", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    await executar(acoes.removerEnderecoCliente, { id: A });
    expect(eqs(escritas("clientes_enderecos", "update")[0])).toContainEqual(["id", B]);
  });

  it("remove endereço NÃO padrão → deleta e NÃO mexe em padrão de ninguém", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    expect(await executar(acoes.removerEnderecoCliente, { id: C })).toEqual({ ok: true });
    expect(escritas("clientes_enderecos", "delete")).toHaveLength(1);
    expect(escritas("clientes_enderecos", "update")).toHaveLength(0);
  });

  it("a lista é lida escopada pela sessão e ordenada por criado_em ascendente (base da 'promoção do mais antigo')", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    await executar(acoes.removerEnderecoCliente, { id: C });
    const leitura = db.cadeias[0];
    expect(eqs(leitura)).toContainEqual(["cliente_id", USER_ID]);
    expect(leitura.passos.find((p) => p.m === "order")!.args).toEqual(["criado_em", { ascending: true }]);
  });

  it("id fora da lista da sessão (endereço alheio) → 'não encontrado', NENHUM delete", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    expect(await executar(acoes.removerEnderecoCliente, { id: OUTRO_ID })).toEqual({ ok: false, erro: MSG_NAO_ENC });
    expect(escritas("clientes_enderecos", "delete")).toHaveLength(0);
  });

  it("único endereço → mínimo, e NENHUM delete é tentado (a barreira não depende só do trigger)", async () => {
    responder("clientes_enderecos", "select", { data: [{ id: A, padrao: true }] });
    expect(await executar(acoes.removerEnderecoCliente, { id: A })).toEqual({ ok: false, erro: MSG_MINIMO });
    expect(escritas("clientes_enderecos", "delete")).toHaveLength(0);
  });

  it("lista vazia / null → 'não encontrado' (não lança)", async () => {
    responder("clientes_enderecos", "select", { data: null });
    expect(await executar(acoes.removerEnderecoCliente, { id: A })).toEqual({ ok: false, erro: MSG_NAO_ENC });
  });

  it("corrida: trigger de mínimo (23514 'mínimo') no DELETE → mensagem de mínimo", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    responder("clientes_enderecos", "delete", { error: { code: "23514", message: "clientes_enderecos: mínimo de 1 endereço" } });
    expect(await executar(acoes.removerEnderecoCliente, { id: B })).toEqual({ ok: false, erro: MSG_MINIMO });
  });

  it("23514 sem 'mínimo' → genérico", async () => {
    responder("clientes_enderecos", "select", { data: lista(A) });
    responder("clientes_enderecos", "delete", { error: { code: "23514", message: "outra regra" } });
    expect(await executar(acoes.removerEnderecoCliente, { id: B })).toEqual({ ok: false, erro: MSG_GENERICA });
  });

  it("falha ao promover → erro genérico (sem vazar detalhe)", async () => {
    responder("clientes_enderecos", "select", { data: lista(B) });
    responder("clientes_enderecos", "update", { error: { code: "XX000", message: "detalhe interno" } });
    const r = await executar(acoes.removerEnderecoCliente, { id: B });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
  });

  it("sem sessão / id inválido → nenhuma consulta", async () => {
    expect(await executar(acoes.removerEnderecoCliente, { id: "x" })).toEqual({ ok: false, erro: MSG_DADOS });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await executar(acoes.removerEnderecoCliente, { id: A })).toEqual({ ok: false, erro: MSG_SESSAO });
    expect(db.cadeias).toHaveLength(0);
  });
});

// ═════════════════════════ excluirConta ══════════════════════════════════════
describe("excluirConta — ramos", () => {
  it("sucesso redireciona para '/' (conta encerrada) e faz signOut", async () => {
    expect(await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" })).toEqual({ ok: true, destino: "/" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("payload omitido ou null → erro, nada apagado (D8: confirmação obrigatória)", async () => {
    await executar(acoes.excluirConta);
    await executar(acoes.excluirConta, null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("conta SEM nenhum papel gravado (leitura vazia) → só anonimiza; deleteUser NÃO chamado (fail-closed)", async () => {
    papeis();
    await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(rpc).toHaveBeenCalledWith("anonimizar_cliente", { p_usuario: USER_ID });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("papel desconhecido é descartado: ['cliente','xyz'] ainda é só-cliente → deleteUser", async () => {
    papeis("cliente", "xyz");
    await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("lojista+cliente+admin → nunca apaga auth.users; papel lojista intocado", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", USER_ID);
    papeis("lojista", "cliente");
    await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
    expect(db.cadeias.some((c) => c.tabela === "papeis_usuario" && c.op !== "select")).toBe(false);
  });

  it("só-cliente mas SAAS_ADMIN_USER_ID ausente → ehAdminSaaS é false (fail-safe) e a conta é apagada", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", "");
    await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("deleteUser falha DEPOIS de anonimizar → não vaza erro: segue com signOut e redireciona (perfil já apagado)", async () => {
    deleteUser.mockResolvedValue({ error: { status: 500, message: "detalhe interno" } });
    const r = await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: true, destino: "/" });
    expect(signOut).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("detalhe interno");
  });

  it("rpc lança exceção → mensagem genérica de exclusão; nada apagado, sem signOut", async () => {
    rpc.mockRejectedValue(Object.assign(new Error("boom"), { code: "XX000" }));
    const r = await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: false, erro: MSG_EXCLUSAO });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("papéis ilegíveis → fail-closed: nada é chamado (nem anonimizar_cliente nem deleteUser)", async () => {
    responder("papeis_usuario", "select", { error: { code: "XX000", message: "x" } });
    const r = await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" });
    expect(r).toEqual({ ok: false, erro: MSG_EXCLUSAO });
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("sem sessão → 'sessão expirou', nada chamado", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await executar(acoes.excluirConta, { confirmacao: "EXCLUIR" })).toEqual({ ok: false, erro: MSG_SESSAO });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ perfil ════════════════════════════════════════════
describe("salvarPerfilCliente — ramos", () => {
  it("rate limit excedido → mensagem de tentativas, sem getUser nem UPDATE", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await executar(acoes.salvarPerfilCliente, perfil());
    expect(r.ok).toBe(false);
    expect(verificarRateLimit).toHaveBeenCalledWith("salvarPerfil", "203.0.113.7");
    expect(getUser).not.toHaveBeenCalled();
    expect(db.cadeias).toHaveLength(0);
  });

  it("UPDATE usa os valores validados (trim) e filtra por id da sessão", async () => {
    await executar(acoes.salvarPerfilCliente, { ...perfil(), nome: "  Ana  " });
    const [u] = escritas("clientes", "update");
    expect(arg(u, "update")).toEqual({ nome: "Ana", telefone: "(11) 90000-0000", data_nascimento: "1990-05-10", aceita_marketing: true });
    expect(eqs(u)).toContainEqual(["id", USER_ID]);
  });

  it("menor de idade → mensagem da decisão 17 e nenhum UPDATE", async () => {
    const r = await executar(acoes.salvarPerfilCliente, { ...perfil(), data_nascimento: new Date().toISOString().slice(0, 10) });
    expect(r).toEqual({ ok: false, erro: "Você precisa ter 18 anos ou mais para criar uma conta." });
    expect(db.cadeias).toHaveLength(0);
  });

  it("outro erro de validação (telefone) → mensagem genérica de dados, nunca o detalhe do zod", async () => {
    expect(await executar(acoes.salvarPerfilCliente, { ...perfil(), telefone: "abc" })).toEqual({ ok: false, erro: MSG_DADOS });
  });

  it("erro do banco → genérico, sem código", async () => {
    responder("clientes", "update", { error: { code: "23514", message: "trigger idade" } });
    const r = await executar(acoes.salvarPerfilCliente, perfil());
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
  });

  it("sem sessão → 'sessão expirou'", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await executar(acoes.salvarPerfilCliente, perfil())).toEqual({ ok: false, erro: MSG_SESSAO });
  });
});

describe("completarPerfilCliente — ramos", () => {
  it("sucesso redireciona a /minha-conta e envia o endereço com complemento null quando ausente", async () => {
    const r = await executar(acoes.completarPerfilCliente, completar());
    expect(r).toEqual({ ok: true, destino: "/minha-conta" });
    expect(rpc).toHaveBeenCalledWith(
      "criar_perfil_cliente",
      expect.objectContaining({
        p_nome: "Pessoa Teste",
        p_aceita_marketing: true,
        p_endereco: expect.objectContaining({ rotulo: "Casa", complemento: null }),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/minha-conta");
  });

  it("next interno é respeitado; next externo ou protocol-relative cai em /minha-conta", async () => {
    expect((await executar(acoes.completarPerfilCliente, { ...completar(), next: "/loja/pizzaria" })).destino).toBe("/loja/pizzaria");
    for (const next of ["//evil.com", "https://evil.com", "evil.com"]) {
      expect((await executar(acoes.completarPerfilCliente, { ...completar(), next })).destino, next).toBe("/minha-conta");
    }
  });

  it("duplo submit: RPC devolve 23505 (perfil já existe) → idempotente, segue ao destino", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "perfil já existe" } });
    expect(await executar(acoes.completarPerfilCliente, completar())).toEqual({ ok: true, destino: "/minha-conta" });
  });

  it("outro erro da RPC → genérico, sem redirect e sem vazar mensagem", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22004", message: "criar_perfil_cliente: endereço obrigatório" } });
    const r = await executar(acoes.completarPerfilCliente, completar());
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("RPC lança → genérico", async () => {
    rpc.mockRejectedValue(new Error("rede"));
    expect(await executar(acoes.completarPerfilCliente, completar())).toEqual({ ok: false, erro: MSG_GENERICA });
  });

  it("rate limit excedido → nenhuma RPC e nenhum getUser", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    expect((await executar(acoes.completarPerfilCliente, completar())).ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("e-mail não confirmado devolve a mensagem de confirmação (não a de sessão)", async () => {
    getUser.mockResolvedValue({ data: { user: usuario({ email_confirmed_at: null }) }, error: null });
    const r = await executar(acoes.completarPerfilCliente, completar());
    expect(r).toEqual({ ok: false, erro: "Confirme seu e-mail para entrar. Enviamos um link para você." });
  });

  it("endereço do payload nunca carrega padrao (índice único cuida do 1º)", async () => {
    await executar(acoes.completarPerfilCliente, { ...completar(), endereco: { ...endereco(), padrao: true } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ sairCliente ═══════════════════════════════════════
describe("sairCliente", () => {
  it("sem payload → signOut e redirect '/'", async () => {
    expect(await executar(acoes.sairCliente)).toEqual({ ok: true, destino: "/" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  it("next interno respeitado; externo ignorado (open redirect)", async () => {
    expect((await executar(acoes.sairCliente, { next: "/loja/x" })).destino).toBe("/loja/x");
    expect((await executar(acoes.sairCliente, { next: "//evil.com" })).destino).toBe("/");
    expect((await executar(acoes.sairCliente, { next: "https://evil.com" })).destino).toBe("/");
  });
  it("payload inválido (campo extra) não bloqueia o logout: sai e vai para '/'", async () => {
    expect(await executar(acoes.sairCliente, { next: "/x", papel: "lojista" })).toEqual({ ok: true, destino: "/" });
    expect(signOut).toHaveBeenCalled();
  });
  it("signOut falha → erro, sem redirect", async () => {
    signOut.mockRejectedValue(new Error("rede"));
    expect(await executar(acoes.sairCliente)).toEqual({ ok: false, erro: "Não foi possível sair. Tente novamente." });
  });
});
