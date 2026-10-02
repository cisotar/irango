// RED (C1). Preâmbulo copiado de route.cliente.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("C1 — link de recuperação inválido/expirado com contexto=cliente", () => {
  const NEXT_REC = "&next=%2Fconta%2Frecuperar%3Fetapa%3Dnova-senha";
  it("sem code → /conta/recuperar?erro=link", async () => {
    const res = await GET(req("?contexto=cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/conta/recuperar?erro=link`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("troca do código falha → /conta/recuperar?erro=link, sem papel", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "invalid grant" } });
    const res = await GET(req(`?code=abc&contexto=cliente${NEXT_REC}`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/conta/recuperar?erro=link`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("erro OAuth otp_expired → /conta/recuperar?erro=link", async () => {
    const res = await GET(req("?error=access_denied&error_code=otp_expired&contexto=cliente"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/conta/recuperar?erro=link`);
  });
  it("erro OAuth access_denied vindo da recuperação (next=/conta/recuperar…) → /conta/recuperar?erro=link", async () => {
    const res = await GET(req(`?error=access_denied&contexto=cliente${NEXT_REC}`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/conta/recuperar?erro=link`);
  });
  it("erro OAuth do login Google (sem next de recuperação) → /conta/entrar?erro=google", async () => {
    const res = await GET(req("?error=access_denied&contexto=cliente&next=%2Floja%2Fx"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/conta/entrar?erro=google`);
  });
  it("porta lojista inalterada: sem code → /login?erro=auth", async () => {
    const res = await GET(req(""));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?erro=auth`);
  });
});
