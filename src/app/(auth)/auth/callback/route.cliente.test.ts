import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Fase RED (TDD) — issue 336, camada callback da porta cliente.
 * Arquivo NOVO (não altera `route.test.ts` nem `route.papel.test.ts`).
 *
 * Contrato (specs/cliente-identidade.md §"Como a porta cliente evita o lojista"):
 *  - só o literal `contexto=cliente` troca o papel inicial para `cliente`;
 *    ausente/vazio/outro → `lojista` (como hoje);
 *  - erro de OAuth com `contexto=cliente` → `/conta/entrar?erro=google`;
 *  - conta cliente SEM perfil → `/conta/completar` (preservando `next` sanitizado);
 *  - conta com perfil → `clientes.ultimo_acesso_em` via service_role; destino
 *    padrão cliente = `/minha-conta`;
 *  - recuperação: `next=/conta/recuperar?etapa=nova-senha` é respeitado.
 * Perfil lido de `clientes` por qualquer dos dois clients (o fake responde igual).
 */

const fakeUser = {
  id: "uid-cliente",
  email: "pessoa@exemplo.test",
  email_confirmed_at: "2026-09-01T10:00:00.000Z",
} as User;

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
      return { data, error: r.error ?? null, count: Array.isArray(r.data) ? r.data.length : null };
    };
    const b: Record<string, unknown> = new Proxy(
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
  const r = { select: { data: sim ? [{ id: fakeUser.id }] : [] } };
  dbSessao.respostas.clientes = r;
  dbServico.respostas.clientes = r;
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

describe("GET /auth/callback — porta cliente (issue 336)", () => {
  it("contexto=cliente → atribuir_papel_inicial(user, 'cliente'), uma única chamada", async () => {
    await GET(req("?code=abc&contexto=cliente"));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: fakeUser.id, p_papel: "cliente" });
  });

  for (const [rotulo, qs] of [
    ["ausente", ""],
    ["vazio", "&contexto="],
    ["'lojista'", "&contexto=lojista"],
    ["'Cliente' (caixa)", "&contexto=Cliente"],
    ["'cliente ' (espaço)", "&contexto=cliente%20"],
    ["'admin'", "&contexto=admin"],
  ] as const) {
    it(`contexto ${rotulo} → papel 'lojista' (porta (auth), como hoje)`, async () => {
      rpc.mockResolvedValue({ data: ["lojista"], error: null });
      await GET(req(`?code=abc${qs}`));
      expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: fakeUser.id, p_papel: "lojista" });
    });
  }

  it("erro de OAuth com contexto=cliente → /conta/entrar?erro=google, sem trocar code", async () => {
    const res = await GET(req("?error=access_denied&error_description=negado&contexto=cliente"));
    const u = destino(res);
    expect(u.pathname).toBe("/conta/entrar");
    expect(u.searchParams.get("erro")).toBe("google");
    expect(res.headers.get("location")).not.toContain("access_denied");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("conta Google nova (cliente, sem perfil), sem next → /conta/completar; reconciliar NÃO chamado", async () => {
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(destino(res).pathname).toBe("/conta/completar");
    expect(reconciliar).not.toHaveBeenCalled();
  });

  it("conta cliente sem perfil com next=/loja/pizzaria → /conta/completar preservando next", async () => {
    const res = await GET(req("?code=abc&contexto=cliente&next=%2Floja%2Fpizzaria"));
    const u = destino(res);
    expect(u.pathname).toBe("/conta/completar");
    expect(u.searchParams.get("next")).toBe("/loja/pizzaria");
  });

  it("contexto=cliente + next=//evil.com → sanitizado: fica no app, em /conta/completar, sem evil.com", async () => {
    const res = await GET(req("?code=abc&contexto=cliente&next=//evil.com"));
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(loc).not.toContain("evil.com");
    expect(destino(res).pathname).toBe("/conta/completar");
  });

  it("conta com perfil, sem next → /minha-conta e atualiza clientes.ultimo_acesso_em via service_role", async () => {
    temPerfil(true);
    const res = await GET(req("?code=abc&contexto=cliente"));
    expect(destino(res).pathname).toBe("/minha-conta");
    const upd = dbServico.chamadas.find((c) => c.tabela === "clientes" && c.metodo === "update");
    expect(upd).toBeDefined();
    expect(Object.keys(upd!.args[0] as object)).toEqual(["ultimo_acesso_em"]);
    expect(dbSessao.chamadas.some((c) => c.tabela === "clientes" && c.metodo === "update")).toBe(false);
  });

  it("recuperação por link: contexto=cliente&next=/conta/recuperar?etapa=nova-senha (conta com perfil) → destino respeitado; papel pedido é 'cliente' e só pela RPC idempotente", async () => {
    temPerfil(true);
    const next = encodeURIComponent("/conta/recuperar?etapa=nova-senha");
    const res = await GET(req(`?code=abc&contexto=cliente&next=${next}`));
    const u = destino(res);
    expect(u.pathname).toBe("/conta/recuperar");
    expect(u.searchParams.get("etapa")).toBe("nova-senha");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("atribuir_papel_inicial", { p_usuario_id: fakeUser.id, p_papel: "cliente" });
  });
});
