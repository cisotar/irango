import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import {
  decidirAcessoPainel,
  ROTAS_EXCECAO_ASSINATURA,
} from "./acessoPainel";

// ===========================================================================
// CONTRATO (issue 016 — Plano Técnico, "Assinaturas")
//
// decidirAcessoPainel(
//   user: User | null,
//   loja: LojaCompleta | null,
//   rota: string,           // pathname atual
//   agora: Date,            // injetado (PURA — sem Date.now())
// ): 'ok' | 'login' | 'confirmar-email' | 'onboarding' | 'assinatura-bloqueada'
//
// Precedência FIXA (sessão → email → loja → assinatura(+exceção)):
//   1. user null/sem sessão                         → 'login'  (vence tudo, inclusive rota de exceção)
//   2. email_confirmed_at undefined OU null         → 'confirmar-email' (defesa em profundidade §17)
//   3. user confirmado mas loja null                → 'onboarding'
//   4. assinaturaPermiteAcesso(...) === false       → 'assinatura-bloqueada' (fail-closed, D4)
//          EXCETO se rota ∈ ROTAS_EXCECAO_ASSINATURA → 'ok' (anti-loop) — só p/ bloqueio de assinatura
//   5. tudo ok                                      → 'ok'
//
// Reusa assinaturaPermiteAcesso (assinatura.ts): 'ativa' sempre; 'suspensa' nunca;
// trial/inadimplente/cancelada → agora <= fim (carência inclusiva).
// Fail-closed (D4): status fora do union conhecido, ou fim=null com status que
// exige carência → bloqueia.
// ===========================================================================

// --- Builders de input não-confiável (espelham a forma real, não a lógica) ---

function fazerUser(emailConfirmedAt: string | null | undefined): User {
  // Só os campos que o guard consome importam; o resto é forma mínima do User.
  return {
    id: "user-uuid",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    email_confirmed_at: emailConfirmedAt ?? undefined,
  } as unknown as User;
}

function fazerLoja(
  status: string,
  fim: string | null,
): LojaCompleta {
  return {
    assinatura_status: status,
    assinatura_fim_periodo: fim,
  } as unknown as LojaCompleta;
}

const AGORA = new Date("2026-06-14T12:00:00Z");
const FUTURO = "2026-06-20T12:00:00Z"; // dentro da carência (agora < fim)
const PASSADO = "2026-06-01T12:00:00Z"; // fora da carência (agora > fim)
const ROTA_OK = "/painel";

const userConfirmado = fazerUser("2026-01-02T00:00:00Z");

// ===========================================================================
// 1. SESSÃO — vence tudo
// ===========================================================================
describe("precedência 1 — sessão (sem sessão vence tudo)", () => {
  it("user null → 'login'", () => {
    expect(decidirAcessoPainel(null, null, ROTA_OK, AGORA)).toBe("login");
  });

  it("user null mesmo com loja ativa → 'login' (sessão é pré-requisito)", () => {
    expect(
      decidirAcessoPainel(null, fazerLoja("ativa", null), ROTA_OK, AGORA),
    ).toBe("login");
  });

  it("user null em rota de exceção → 'login' (anônimo NÃO vê tela de bloqueio)", () => {
    expect(
      decidirAcessoPainel(null, null, "/painel/assinatura-bloqueada", AGORA),
    ).toBe("login");
  });
});

// ===========================================================================
// 2. EMAIL — defesa em profundidade §17
// ===========================================================================
describe("precedência 2 — email não confirmado", () => {
  it("email_confirmed_at undefined → 'confirmar-email'", () => {
    expect(
      decidirAcessoPainel(
        fazerUser(undefined),
        fazerLoja("ativa", null),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("confirmar-email");
  });

  it("email_confirmed_at null → 'confirmar-email'", () => {
    expect(
      decidirAcessoPainel(
        fazerUser(null),
        fazerLoja("ativa", null),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("confirmar-email");
  });

  it("email não confirmado vence loja null (email antes de loja)", () => {
    expect(
      decidirAcessoPainel(fazerUser(undefined), null, ROTA_OK, AGORA),
    ).toBe("confirmar-email");
  });

  it("email não confirmado em rota de exceção → 'confirmar-email' (exceção só cobre assinatura)", () => {
    expect(
      decidirAcessoPainel(
        fazerUser(null),
        fazerLoja("suspensa", null),
        "/painel/assinatura-bloqueada",
        AGORA,
      ),
    ).toBe("confirmar-email");
  });
});

// ===========================================================================
// 3. LOJA — user órfão
// ===========================================================================
describe("precedência 3 — sessão+email OK mas sem loja", () => {
  it("loja null → 'onboarding'", () => {
    expect(
      decidirAcessoPainel(userConfirmado, null, ROTA_OK, AGORA),
    ).toBe("onboarding");
  });

  it("loja null em rota de exceção → 'onboarding' (exceção não cobre falta de loja)", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        null,
        "/painel/configuracoes/assinatura",
        AGORA,
      ),
    ).toBe("onboarding");
  });
});

// ===========================================================================
// 4. ASSINATURA — fail-closed, reusa assinaturaPermiteAcesso
// ===========================================================================
describe("precedência 4 — assinatura (loja presente)", () => {
  it("'ativa' → 'ok' (mesmo com fim=null)", () => {
    expect(
      decidirAcessoPainel(userConfirmado, fazerLoja("ativa", null), ROTA_OK, AGORA),
    ).toBe("ok");
  });

  it("'trial' válido (agora < fim) → 'ok'", () => {
    expect(
      decidirAcessoPainel(userConfirmado, fazerLoja("trial", FUTURO), ROTA_OK, AGORA),
    ).toBe("ok");
  });

  it("'trial' expirado (agora > fim) → 'assinatura-bloqueada'", () => {
    expect(
      decidirAcessoPainel(userConfirmado, fazerLoja("trial", PASSADO), ROTA_OK, AGORA),
    ).toBe("assinatura-bloqueada");
  });

  it("'inadimplente' dentro da carência → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("inadimplente", FUTURO),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("ok");
  });

  it("'inadimplente' fora da carência → 'assinatura-bloqueada'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("inadimplente", PASSADO),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("assinatura-bloqueada");
  });

  it("'cancelada' dentro do período pago → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("cancelada", FUTURO),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("ok");
  });

  it("'cancelada' fora do período → 'assinatura-bloqueada'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("cancelada", PASSADO),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("assinatura-bloqueada");
  });

  it("'suspensa' → 'assinatura-bloqueada' SEMPRE (corte imediato, sem carência)", () => {
    expect(
      decidirAcessoPainel(userConfirmado, fazerLoja("suspensa", FUTURO), ROTA_OK, AGORA),
    ).toBe("assinatura-bloqueada");
  });

  it("borda de carência inclusiva (agora == fim) → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("trial", AGORA.toISOString()),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("ok");
  });
});

// ===========================================================================
// 4b. FAIL-CLOSED (D4) — input não-confiável vindo do próprio banco
// ===========================================================================
describe("precedência 4 — fail-closed (D4)", () => {
  it("status fora do union conhecido → 'assinatura-bloqueada'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("pendente_de_pagamento", FUTURO),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("assinatura-bloqueada");
  });

  it("status que exige carência com fim=null → 'assinatura-bloqueada' (não dá p/ avaliar)", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("inadimplente", null),
        ROTA_OK,
        AGORA,
      ),
    ).toBe("assinatura-bloqueada");
  });

  it("'trial' com fim=null → 'assinatura-bloqueada' (fail-closed)", () => {
    expect(
      decidirAcessoPainel(userConfirmado, fazerLoja("trial", null), ROTA_OK, AGORA),
    ).toBe("assinatura-bloqueada");
  });
});

// ===========================================================================
// 5. ANTI-LOOP — exceção de rota cobre SÓ o bloqueio de assinatura
// ===========================================================================
describe("anti-loop — rotas de exceção com assinatura inválida", () => {
  it("'/painel/assinatura-bloqueada' com 'suspensa' (sessão+email+loja OK) → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("suspensa", FUTURO),
        "/painel/assinatura-bloqueada",
        AGORA,
      ),
    ).toBe("ok");
  });

  it("'/painel/configuracoes/assinatura' com 'trial' expirado → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("trial", PASSADO),
        "/painel/configuracoes/assinatura",
        AGORA,
      ),
    ).toBe("ok");
  });

  it("rota de exceção por prefixo (subpath de configuracoes/assinatura) → 'ok'", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("cancelada", PASSADO),
        "/painel/configuracoes/assinatura/historico",
        AGORA,
      ),
    ).toBe("ok");
  });

  it("rota de exceção com assinatura VÁLIDA → 'ok' (continua liberando normalmente)", () => {
    expect(
      decidirAcessoPainel(
        userConfirmado,
        fazerLoja("ativa", null),
        "/painel/assinatura-bloqueada",
        AGORA,
      ),
    ).toBe("ok");
  });
});

// ===========================================================================
// Sanidade do contrato exportado
// ===========================================================================
describe("contrato — constante de rotas de exceção", () => {
  it("ROTAS_EXCECAO_ASSINATURA contém as duas rotas do plano", () => {
    expect(ROTAS_EXCECAO_ASSINATURA).toContain("/painel/assinatura-bloqueada");
    expect(ROTAS_EXCECAO_ASSINATURA).toContain(
      "/painel/configuracoes/assinatura",
    );
  });
});
