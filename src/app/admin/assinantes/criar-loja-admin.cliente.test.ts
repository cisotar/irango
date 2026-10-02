import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 337 / L1 = (A): `criarLojaAdmin` para e-mail de conta
 * só-cliente → mensagem específica. Arquivo NOVO (não altera `criar-loja-admin.test.ts`).
 * A barreira real é o trigger `lojas_exige_dono_lojista`; a action só escolhe a
 * mensagem. Para não decidir COMO a action consulta os papéis, as duas pontas
 * dizem a mesma coisa: `papeis_usuario` (service_role) = ['cliente'] e o INSERT
 * falha com o erro do trigger (20261001120000_papel_cliente.sql).
 */

const DONO_ID = "22222222-2222-2222-2222-222222222222";
const MSG_L1 = "Este e-mail pertence a uma conta de cliente e não pode ser dono de loja.";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ verificarAdminSaaS: vi.fn(async () => undefined) }));

let papeisResposta: { data: unknown; error: unknown } = { data: [{ papel: "cliente" }], error: null };
function builder(): Record<string, unknown> {
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(papeisResposta).then(ok);
        return () => b;
      },
    },
  );
  return b;
}
const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => builder(), rpc }),
}));

const resolverDonoPorEmail = vi.fn();
const slugExiste = vi.fn();
const criarLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  resolverDonoPorEmail: (...a: unknown[]) => resolverDonoPorEmail(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
}));

import { criarLojaAdmin } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  papeisResposta = { data: [{ papel: "cliente" }], error: null };
  resolverDonoPorEmail.mockResolvedValue(DONO_ID);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockRejectedValue(
    Object.assign(new Error("loja: conta de cliente não pode ser dona de loja"), { code: "P0001" }),
  );
});

describe("criarLojaAdmin — conta só-cliente (L1 = A)", () => {
  it("e-mail de conta só-cliente → { ok:false, erro: mensagem L1 }", async () => {
    const r = await criarLojaAdmin({ email: "cliente@exemplo.test", nome: "Loja Teste", slug: "loja-teste" });
    expect(r).toEqual({ ok: false, erro: MSG_L1 });
  });

  it("mensagem L1 não vaza o e-mail nem o texto do trigger", async () => {
    const r = await criarLojaAdmin({ email: "cliente@exemplo.test", nome: "Loja Teste", slug: "loja-teste" });
    expect(JSON.stringify(r)).not.toContain("cliente@exemplo.test");
    expect(JSON.stringify(r)).not.toContain("dona de loja");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe(MSG_L1);
  });
});
