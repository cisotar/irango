import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";

/**
 * Fase RED (TDD) da issue 066 — helper `reconciliarPosConfirmacao(user)`.
 *
 * O gatilho da reconciliação de assinatura órfã migra do cadastro (auth.ts, gate
 * morto) para a confirmação de email. O ÚNICO ponto onde a posse do email vira
 * verdade é a troca do code por sessão no callback; logo a reconciliação só pode
 * disparar com `email_confirmed_at` setado e com o email AUTENTICADO da sessão
 * (RN-A1, não-forjável) — nunca de input do cliente. A loja é resolvida por
 * `user.id` (vínculo canônico dono↔loja), não por email.
 *
 * RED por MODULE NOT FOUND: `./reconciliarPosConfirmacao` ainda não existe — a
 * implementação é da fase GREEN (executar). As asserções abaixo descrevem o
 * COMPORTAMENTO esperado do helper já implementado:
 *  1. email confirmado + loja encontrada → reconciliarAssinatura(svc, email, lojaId)
 *  2. email NÃO confirmado → reconciliarAssinatura NÃO chamada (vetor ALTA fechado)
 *  3. buscarLojaPorDono lança → erro silencioso, reconciliarAssinatura NÃO chamada
 *  4. reconciliarAssinatura lança → não propaga (best-effort, não derruba callback)
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const LOJA_ID = "22222222-2222-2222-2222-222222222222";

// ── service_role client (BYPASSRLS) ───────────────────────────────────────────
const fakeService = { __role: "service" };
const createServiceClient = vi.fn(() => fakeService);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── query: loja do dono por id ─────────────────────────────────────────────────
const buscarLojaPorDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaPorDono: (...a: unknown[]) => buscarLojaPorDono(...a),
}));

// ── reconciliação de assinatura órfã (caixa-preta, inalterada — 059) ───────────
const reconciliarAssinatura = vi.fn();
vi.mock("@/lib/assinatura/reconciliar", () => ({
  reconciliarAssinatura: (...a: unknown[]) => reconciliarAssinatura(...a),
}));

import { reconciliarPosConfirmacao } from "./reconciliarPosConfirmacao";

/** User mínimo da sessão recém-trocada (campos usados pelo helper). */
function fakeUser(over: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: "comprador@exemplo.com",
    email_confirmed_at: "2026-06-15T10:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-15T09:00:00.000Z",
    ...over,
  } as User;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  reconciliarAssinatura.mockResolvedValue(undefined);
});

describe("reconciliarPosConfirmacao", () => {
  it("email confirmado + loja encontrada → reconcilia com email e lojaId corretos", async () => {
    buscarLojaPorDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID });

    await reconciliarPosConfirmacao(fakeUser());

    // resolve a loja pelo user.id (vínculo canônico), nunca pelo email
    expect(buscarLojaPorDono).toHaveBeenCalledWith(fakeService, USER_ID);
    // email AUTENTICADO da sessão + loja.id da query (nunca input do cliente)
    expect(reconciliarAssinatura).toHaveBeenCalledTimes(1);
    expect(reconciliarAssinatura).toHaveBeenCalledWith(
      fakeService,
      "comprador@exemplo.com",
      LOJA_ID,
    );
  });

  it("email NÃO confirmado (email_confirmed_at null) → NÃO reconcilia", async () => {
    buscarLojaPorDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID });

    await reconciliarPosConfirmacao(fakeUser({ email_confirmed_at: undefined }));

    expect(reconciliarAssinatura).not.toHaveBeenCalled();
  });

  it("buscarLojaPorDono lança → erro silencioso, NÃO reconcilia e NÃO propaga", async () => {
    buscarLojaPorDono.mockRejectedValue(new Error("falha de I/O no SELECT lojas"));

    await expect(reconciliarPosConfirmacao(fakeUser())).resolves.toBeUndefined();

    expect(reconciliarAssinatura).not.toHaveBeenCalled();
  });

  it("reconciliarAssinatura lança → não propaga (best-effort)", async () => {
    buscarLojaPorDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID });
    reconciliarAssinatura.mockRejectedValue(new Error("falha ao aplicar status"));

    await expect(reconciliarPosConfirmacao(fakeUser())).resolves.toBeUndefined();
  });
});
