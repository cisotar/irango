import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * P18 — ramos do callback com `contexto=cliente` que o RED
 * (route.cliente.test.ts) não cobre: falhas de infraestrutura, admin/lojista
 * entrando pela porta cliente, `next` com perfil, prefixo de recuperação,
 * ultimo_acesso_em best-effort e ausência de reconciliação. Dados fictícios.
 */
const fakeUser = { id: "uid-cliente", email: "pessoa@exemplo.test", email_confirmed_at: "2026-09-01T10:00:00.000Z" } as User;

type Resposta = { data?: unknown; error?: unknown };
type Chamada = { tabela: string; metodo: string; args: unknown[] };
function criarFakeDb() {
  const chamadas: Chamada[] = [];
  const respostas: Record<string, Partial<Record<"select" | "update", Resposta>>> = {};
  function from(tabela: string) {
    const ops: string[] = [];
    const resolver = () => {
      const op = ops.includes("update") ? "update" : "select";
      const r = respostas[tabela]?.[op] ?? { data: null, error: null };
      let data = r.data ?? null;
      if ((ops.includes("single") || ops.includes("maybeSingle")) && Array.isArray(data)) data = data[0] ?? null;
      return { data, error: r.error ?? null };
    };
    const b: unknown = new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko);
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
const temPerfil = (sim: boolean) => {
  dbSessao.respostas.clientes = { ...dbSessao.respostas.clientes, select: { data: sim ? [{ id: fakeUser.id }] : [] } };
};

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a) },
      from: (t: string) => dbSessao.from(t),
    }),
}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => dbServico.from(t) }),
}));
const reconciliar = vi.fn();
vi.mock("@/lib/auth/reconciliarPosConfirmacao", () => ({
  reconciliarPosConfirmacao: (...a: unknown[]) => reconciliar(...a),
}));

import { GET } from "./route";
const ORIGIN = "https://app.local";
const req = (s: string) => new NextRequest(`${ORIGIN}/auth/callback${s}`);
const destino = (res: Response) => new URL(res.headers.get("location") ?? "", ORIGIN);
const atualizouAcesso = () => dbServico.chamadas.some((c) => c.tabela === "clientes" && c.metodo === "update");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "outro-id");
  dbSessao = criarFakeDb();
  dbServico = criarFakeDb();
  reconciliar.mockResolvedValue(undefined);
  exchangeCodeForSession.mockResolvedValue({ data: { user: fakeUser }, error: null });
  rpc.mockResolvedValue({ data: ["cliente"], error: null });
  temPerfil(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("callback contexto=cliente — com perfil", () => {
  it("next interno é o destino (não /minha-conta) e o acesso é registrado", async () => {
    temPerfil(true);
    const res = await GET(req("?code=abc&contexto=cliente&next=%2Floja%2Fpizzaria%3Fmesa%3D3"));
    const u = destino(res);
    expect(u.pathname + u.search).toBe("/loja/pizzaria?mesa=3");
    expect(atualizouAcesso()).toBe(true);
  });
  it("next externo / protocol-relative com perfil → /minha-conta, sem sair do app", async () => {
    temPerfil(true);
    for (const n of ["//evil.com", "https://evil.com"]) {
      const res = await GET(req(`?code=abc&contexto=cliente&next=${encodeURIComponent(n)}`));
      expect(res.headers.get("location"), n).toBe(`${ORIGIN}/minha-conta`);
    }
  });
  it("falha ao gravar ultimo_acesso_em NÃO derruba o login (segue ao destino)", async () => {
    temPerfil(true);
    dbServico.respostas.clientes = { update: { error: { code: "XX000" } } };
    const res = await GET(req("?code=abc&contexto=cliente"));
    // `registrarUltimoAcessoCliente` lança com error → o callback precisa engolir
    expect(destino(res).pathname).toBe("/minha-conta");
  });
  it("ultimo_acesso_em é gravado SÓ pelo service_role e com o id do exchange (nunca da query)", async () => {
    temPerfil(true);
    await GET(req("?code=abc&contexto=cliente&id=outro&user_id=outro"));
    const upd = dbServico.chamadas.find((c) => c.tabela === "clientes" && c.metodo === "update");
    const eq = dbServico.chamadas.find((c) => c.metodo === "eq");
    expect(upd).toBeDefined();
    expect(eq!.args).toEqual(["id", fakeUser.id]);
    expect(dbSessao.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });
});

describe("callback contexto=cliente — sem perfil / falhas", () => {
  it("sem perfil NÃO registra ultimo_acesso_em", async () => {
    await GET(req("?code=abc&contexto=cliente"));
    expect(atualizouAcesso()).toBe(false);
  });
  it("leitura do perfil falha → fail-safe para /conta/completar (o guard decide), sem 500", async () => {
    dbSessao.respostas.clientes = { select: { error: { code: "XX000" } } };
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(destino(res).pathname).toBe("/conta/completar");
    expect(atualizouAcesso()).toBe(false);
  });
  it("next com '&' e '?' é preservado intacto em /conta/completar?next=", async () => {
    const res = await GET(req(`?code=abc&contexto=cliente&next=${encodeURIComponent("/loja/x?a=1&b=2")}`));
    const u = destino(res);
    expect(u.pathname).toBe("/conta/completar");
    expect(u.searchParams.get("next")).toBe("/loja/x?a=1&b=2");
    expect(u.searchParams.has("b")).toBe(false);
  });
  it("RPC de papel lança → /login?erro=auth, sem consultar perfil", async () => {
    rpc.mockRejectedValue(new Error("rede"));
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(dbSessao.chamadas).toHaveLength(0);
  });
  it("RPC de papel devolve erro → /login?erro=auth", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
  });
  it("sem code → /login?erro=auth e nada é trocado nem gravado", async () => {
    const res = await GET(req("?contexto=cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("exchangeCodeForSession com erro → nenhuma RPC de papel (conta não ganha papel sem sessão)", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "invalid grant" } });
    await GET(req("?code=abc&contexto=cliente"));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("erro de OAuth sem contexto=cliente continua indo para /login?erro=google", async () => {
    const res = await GET(req("?error=access_denied"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=google`);
  });
  it("erro de OAuth com contexto='Cliente' (caixa errada) NÃO é porta cliente", async () => {
    const res = await GET(req("?error=access_denied&contexto=Cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=google`);
  });
});

describe("callback contexto=cliente — recuperação de senha", () => {
  it("next=/conta/recuperar?etapa=nova-senha SEM perfil também é respeitado (não desvia para /conta/completar)", async () => {
    temPerfil(false);
    const res = await GET(req(`?code=abc&contexto=cliente&next=${encodeURIComponent("/conta/recuperar?etapa=nova-senha")}`));
    const u = destino(res);
    expect(u.pathname).toBe("/conta/recuperar");
    expect(u.searchParams.get("etapa")).toBe("nova-senha");
  });
  it("recuperação preserva o next de origem aninhado", async () => {
    const interno = "/conta/recuperar?etapa=nova-senha&next=" + encodeURIComponent("/loja/x");
    const res = await GET(req(`?code=abc&contexto=cliente&next=${encodeURIComponent(interno)}`));
    const u = destino(res);
    expect(u.searchParams.get("etapa")).toBe("nova-senha");
    expect(u.searchParams.get("next")).toBe("/loja/x");
  });
  it("recuperação não registra ultimo_acesso_em (não é login)", async () => {
    temPerfil(true);
    await GET(req(`?code=abc&contexto=cliente&next=${encodeURIComponent("/conta/recuperar?etapa=nova-senha")}`));
    expect(atualizouAcesso()).toBe(false);
  });
});

describe("callback contexto=cliente — contas com outros papéis", () => {
  it("conta lojista existente entrando pela porta cliente: reconcilia (papel lojista) mas o destino é o da porta cliente, nunca /painel", async () => {
    rpc.mockResolvedValue({ data: ["lojista"], error: null });
    temPerfil(false);
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(reconciliar).toHaveBeenCalledTimes(1);
    expect(destino(res).pathname).toBe("/conta/completar");
  });
  it("admin do SaaS entrando pela porta cliente com perfil → /minha-conta (não /admin)", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", fakeUser.id);
    temPerfil(true);
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(destino(res).pathname).toBe("/minha-conta");
  });
  it("conta só-cliente: reconciliarPosConfirmacao nunca é chamado (nem com perfil)", async () => {
    temPerfil(true);
    await GET(req("?code=abc&contexto=cliente"));
    expect(reconciliar).not.toHaveBeenCalled();
  });
});
