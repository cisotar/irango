import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P18 (Marco B) — falha fechada em `cliente.ts`:
 * - salvarPerfilCliente: UPDATE que afeta 0 linhas → erro genérico (não ok).
 * - salvarEnderecoCliente (criar): `count` nulo → falha, não "zero endereços".
 * Dados fictícios.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MSG_GENERICA = "Não foi possível salvar. Tente novamente.";

type Resp = { data?: unknown; error?: unknown; count?: number | null };
let respostas: Record<string, Resp> = {};
const insert = vi.fn();
function from(tabela: string) {
  let op = "select";
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") {
          const r = respostas[`${tabela}:${op}`] ?? {};
          return (ok: (v: Resp) => unknown) =>
            Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(ok);
        }
        return (...args: unknown[]) => {
          if (p === "update" || p === "insert") op = String(p);
          if (p === "insert") insert(...args);
          return b;
        };
      },
    },
  );
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }) },
      from: (t: string) => from(t),
    }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: () => Promise.resolve({ permitido: true }),
}));

import * as acoes from "./cliente";

const perfil = { nome: "Pessoa Teste", telefone: "(11) 90000-0000", data_nascimento: "1990-05-10", aceita_marketing: true };
const endereco = { rotulo: "Casa", cep: "01001-000", rua: "Rua Exemplo", numero: "100", bairro: "Centro", cidade: "Cidade Teste", uf: "SP" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  respostas = {};
});

describe("salvarPerfilCliente — UPDATE sem linha afetada", () => {
  it("0 linhas (perfil inexistente / RLS) → erro genérico", async () => {
    respostas["clientes:update"] = { data: [] };
    expect(await acoes.salvarPerfilCliente(perfil)).toEqual({ ok: false, erro: MSG_GENERICA });
  });
  it("1 linha → ok", async () => {
    respostas["clientes:update"] = { data: [{ id: USER_ID }] };
    expect(await acoes.salvarPerfilCliente(perfil)).toEqual({ ok: true });
  });
});

describe("salvarEnderecoCliente — count nulo é falha (fail-closed)", () => {
  it("count null → erro genérico e sem INSERT", async () => {
    respostas["clientes_enderecos:select"] = { count: null };
    expect(await acoes.salvarEnderecoCliente(endereco)).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(insert).not.toHaveBeenCalled();
  });
  it("count 0 → insere e ok", async () => {
    respostas["clientes_enderecos:select"] = { count: 0 };
    expect(await acoes.salvarEnderecoCliente(endereco)).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
