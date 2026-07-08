import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { decidirAcessoBase, decidirAssinatura } from "./acessoPainel";

// ###########################################################################
// SPLIT (issue 140/142 — spec desacoplar-authz-assinatura-route-group.md §Contratos)
//
// decidirAcessoBase(user, loja): "ok" | "login" | "confirmar-email" | "onboarding"
//   — sessão/email/existência de loja. SEM rota, SEM assinatura.
//   Precedência FIXA:
//     1. user null                    → "login"
//     2. !email_confirmed_at           → "confirmar-email"
//     3. loja null                     → "onboarding"
//     4. senão                         → "ok"   (NÃO olha assinatura — isso é decidirAssinatura)
//
// decidirAssinatura(loja, agora): "ok" | "assinatura-bloqueada"
//   — SÓ assinatura, loja NON-NULL, fail-closed. SEM rota, SEM headers().
//     assinaturaLibera(loja, agora) ? "ok" : "assinatura-bloqueada"
//
// RN-06: puras — decidirAssinatura NÃO recebe input de transporte. A isenção do
// paywall passou a ser POSICIONAL (route group `(bloqueavel)/`), não mais pela
// antiga lista de exceção por rota (removida na 142 junto do gate por rota).
//
// Semântica de assinatura (reusa assinaturaLibera):
//   ativa/cortesia sempre liberam; suspensa sempre bloqueia;
//   trial/inadimplente/cancelada → carência inclusiva (agora <= fim);
//   fail-closed: status fora do union, ou fim=null com status que exige carência.
// ###########################################################################

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

function fazerLoja(status: string, fim: string | null): LojaCompleta {
  return {
    assinatura_status: status,
    assinatura_fim_periodo: fim,
  } as unknown as LojaCompleta;
}

const AGORA = new Date("2026-06-14T12:00:00Z");
const FUTURO = "2026-06-20T12:00:00Z"; // dentro da carência (agora < fim)
const PASSADO = "2026-06-01T12:00:00Z"; // fora da carência (agora > fim)

const userConfirmado = fazerUser("2026-01-02T00:00:00Z");

// ===========================================================================
// decidirAcessoBase — sessão → email → loja (sem assinatura)
// ===========================================================================
describe("decidirAcessoBase — precedência 1 (sessão)", () => {
  it("user null → 'login'", () => {
    expect(decidirAcessoBase(null, null)).toBe("login");
  });

  it("user null mesmo com loja ativa → 'login' (sessão é pré-requisito)", () => {
    expect(decidirAcessoBase(null, fazerLoja("ativa", null))).toBe("login");
  });
});

describe("decidirAcessoBase — precedência 2 (email não confirmado)", () => {
  it("email_confirmed_at undefined → 'confirmar-email'", () => {
    expect(
      decidirAcessoBase(fazerUser(undefined), fazerLoja("ativa", null)),
    ).toBe("confirmar-email");
  });

  it("email_confirmed_at null → 'confirmar-email'", () => {
    expect(
      decidirAcessoBase(fazerUser(null), fazerLoja("ativa", null)),
    ).toBe("confirmar-email");
  });

  it("email não confirmado vence loja null (email antes de loja)", () => {
    expect(decidirAcessoBase(fazerUser(undefined), null)).toBe(
      "confirmar-email",
    );
  });
});

describe("decidirAcessoBase — precedência 3 (loja / user órfão)", () => {
  it("loja null → 'onboarding'", () => {
    expect(decidirAcessoBase(userConfirmado, null)).toBe("onboarding");
  });
});

describe("decidirAcessoBase — precedência 4 (ok) — NÃO olha assinatura", () => {
  it("sessão+email+loja OK → 'ok'", () => {
    expect(
      decidirAcessoBase(userConfirmado, fazerLoja("ativa", null)),
    ).toBe("ok");
  });

  it("loja com assinatura VENCIDA ainda → 'ok' (base ignora assinatura; gate é separado)", () => {
    // Prova o desacoplamento: decidirAcessoBase NÃO decide assinatura.
    // Uma loja 'suspensa' passa no base — quem bloqueia é decidirAssinatura.
    expect(
      decidirAcessoBase(userConfirmado, fazerLoja("suspensa", PASSADO)),
    ).toBe("ok");
  });
});

// ===========================================================================
// decidirAssinatura — só assinatura, fail-closed, loja NON-NULL, (loja, agora)
// ===========================================================================
describe("decidirAssinatura — libera", () => {
  it("'ativa' (fim=null) → 'ok'", () => {
    expect(decidirAssinatura(fazerLoja("ativa", null), AGORA)).toBe("ok");
  });

  it("'cortesia' (fim=null) → 'ok'", () => {
    expect(decidirAssinatura(fazerLoja("cortesia", null), AGORA)).toBe("ok");
  });

  it("'trial' dentro da carência (agora < fim) → 'ok'", () => {
    expect(decidirAssinatura(fazerLoja("trial", FUTURO), AGORA)).toBe("ok");
  });

  it("'inadimplente' dentro da carência → 'ok'", () => {
    expect(decidirAssinatura(fazerLoja("inadimplente", FUTURO), AGORA)).toBe(
      "ok",
    );
  });

  it("'cancelada' dentro do período pago → 'ok'", () => {
    expect(decidirAssinatura(fazerLoja("cancelada", FUTURO), AGORA)).toBe("ok");
  });

  it("borda de carência inclusiva (agora == fim) → 'ok'", () => {
    expect(
      decidirAssinatura(fazerLoja("trial", AGORA.toISOString()), AGORA),
    ).toBe("ok");
  });
});

describe("decidirAssinatura — bloqueia", () => {
  it("'trial' expirado (agora > fim) → 'assinatura-bloqueada'", () => {
    expect(decidirAssinatura(fazerLoja("trial", PASSADO), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });

  it("'inadimplente' fora da carência → 'assinatura-bloqueada'", () => {
    expect(decidirAssinatura(fazerLoja("inadimplente", PASSADO), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });

  it("'cancelada' fora do período → 'assinatura-bloqueada'", () => {
    expect(decidirAssinatura(fazerLoja("cancelada", PASSADO), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });

  it("'suspensa' → 'assinatura-bloqueada' SEMPRE (corte imediato, mesmo com fim futuro)", () => {
    expect(decidirAssinatura(fazerLoja("suspensa", FUTURO), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });
});

describe("decidirAssinatura — fail-closed (D4 / RN-04)", () => {
  it("status fora do union conhecido → 'assinatura-bloqueada'", () => {
    expect(
      decidirAssinatura(fazerLoja("pendente_de_pagamento", FUTURO), AGORA),
    ).toBe("assinatura-bloqueada");
  });

  it("'inadimplente' com fim=null → 'assinatura-bloqueada' (não dá p/ avaliar carência)", () => {
    expect(decidirAssinatura(fazerLoja("inadimplente", null), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });

  it("'trial' com fim=null → 'assinatura-bloqueada' (fail-closed)", () => {
    expect(decidirAssinatura(fazerLoja("trial", null), AGORA)).toBe(
      "assinatura-bloqueada",
    );
  });
});
