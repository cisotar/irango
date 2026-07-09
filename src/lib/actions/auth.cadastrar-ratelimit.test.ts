import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PENTEST — ÁREA 4 (auth). Regressão VERMELHA: `cadastrar` NÃO aplica rate limit.
 *
 * Achado: `entrar` chama `verificarRateLimit("login", ip)` no topo (issue 052),
 * mas `cadastrar` não chama rate limit algum. O comentário D5 em auth.ts afirma
 * que a enumeração de email no cadastro é "mitigado por rate limit da 052" — o
 * que é FALSO: a trava 052 só protege `entrar`. Sem limite, `cadastrar` permite:
 *   (a) enumeração de contas — a resposta "Este email já está cadastrado" (signUp
 *       duplicado / contarLojasDoDono>0) distingue email existente de novo, sem teto;
 *   (b) email bombing — cada tentativa dispara um email de confirmação Supabase para
 *       o endereço escolhido pelo atacante, em volume ilimitado;
 *   (c) flood de auth.users + churn de deleteUser na compensação.
 *
 * ESTE TESTE FALHA (RED) contra o código atual: com o rate limit estourado,
 * `cadastrar` ignora a trava, chama `signUp` e devolve resultado de negócio em vez
 * da mensagem genérica de throttle. Vira VERDE quando `cadastrar` passar a chamar
 * `verificarRateLimit` ANTES do `signUp` (mesma mensagem genérica do login).
 *
 * Fix delegado: `executar` — espelhar o guard do topo de `entrar` em `cadastrar`
 * (nova chave de LIMITES, ex. `cadastro`, ou reuso da política de auth). NÃO
 * aplicado aqui: pentester só acha, prova e trava.
 */

// Mock server-only rateLimit: por padrão LIBERA (permitido:true). Cada teste
// sobrescreve para simular a trava estourada.
const verificarRateLimit = vi.fn(async (..._a: unknown[]) => ({ permitido: true }));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));

// Supabase Auth + service + queries: mocks mínimos do caminho feliz.
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const deleteUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        signUp: (...a: unknown[]) => signUp(...a),
        signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      },
    }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } } }),
}));
const contarLojasDoDono = vi.fn();
const slugExiste = vi.fn();
const criarLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  contarLojasDoDono: (...a: unknown[]) => contarLojasDoDono(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
}));
vi.mock("@/lib/assinatura/reconciliar", () => ({ reconciliarAssinatura: vi.fn() }));

import { cadastrar } from "./auth";

const PAYLOAD_OK = { email: "alvo@vitima.com", senha: "senha1234", aceiteTermos: true as const };

beforeEach(() => {
  vi.clearAllMocks();
  signUp.mockResolvedValue({ data: { user: { id: "uid-1" } }, error: null });
  contarLojasDoDono.mockResolvedValue(0);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockResolvedValue({ id: "loja-1" });
  deleteUser.mockResolvedValue({ error: null });
  verificarRateLimit.mockResolvedValue({ permitido: true });
});

describe("PENTEST cadastrar — rate limit (enumeração / email bombing)", () => {
  it("rate limit ESTOURADO → recusa genérica e NÃO chama signUp (bloqueia enumeração/bombing)", async () => {
    verificarRateLimit.mockResolvedValueOnce({ permitido: false });

    const r = await cadastrar(PAYLOAD_OK);

    // Deve recusar sem tocar no Supabase Auth (sem email disparado, sem user criado).
    expect(r).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("cadastrar consulta a trava de rate limit ANTES de qualquer signUp", async () => {
    await cadastrar(PAYLOAD_OK);
    expect(verificarRateLimit).toHaveBeenCalled();
  });
});
