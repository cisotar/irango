import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { decidirAcessoBase } from "./acessoPainel";

/** Bordas do gate de papel em decidirAcessoBase (issue 332). */
const confirmado = { id: "u1", email_confirmed_at: "2026-01-02T00:00:00Z" } as User;
const naoConfirmado = { id: "u1", email_confirmed_at: null } as unknown as User;
const loja = { assinatura_status: "ativa" } as unknown as LojaCompleta;

describe("decidirAcessoBase — papel, bordas (issue 332)", () => {
  it("['cliente','lojista'] (ordem invertida) com loja → 'ok'", () => {
    expect(decidirAcessoBase(confirmado, loja, ["cliente", "lojista"])).toBe("ok");
  });

  it("['lojista','cliente'] sem loja → 'onboarding' (auto-cura só com lojista)", () => {
    expect(decidirAcessoBase(confirmado, null, ["lojista", "cliente"])).toBe("onboarding");
  });

  it("['cliente'] com email não confirmado → 'sem-papel-lojista' (papel antes do email)", () => {
    expect(decidirAcessoBase(naoConfirmado, loja, ["cliente"])).toBe("sem-papel-lojista");
  });

  it("[] com loja e email OK → 'sem-papel-lojista' (loja por dado manual não abre painel)", () => {
    expect(decidirAcessoBase(confirmado, loja, [])).toBe("sem-papel-lojista");
  });

  it("valor fora do union ('admin') não equivale a lojista", () => {
    expect(decidirAcessoBase(confirmado, loja, ["admin" as never])).toBe("sem-papel-lojista");
  });

  it("user null + [] → 'login' (sessão vence papel)", () => {
    expect(decidirAcessoBase(null, null, [])).toBe("login");
  });
});
