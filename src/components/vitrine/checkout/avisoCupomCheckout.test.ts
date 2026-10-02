import { describe, expect, it } from "vitest";
import {
  MSG_CUPOM_ENTRAR_NA_CONTA,
  MSG_CUPOM_LIMITE_ATINGIDO,
} from "@/lib/utils/cupomPorCliente";
import { codigoAvisoCupom, textoAvisoCupom } from "./avisoCupom";
import { hrefCompletarCheckout } from "./linkEntrar";

describe("aviso de cupom na confirmação (código fixo na URL)", () => {
  it("mensagem do servidor → código curto", () => {
    expect(codigoAvisoCupom(MSG_CUPOM_ENTRAR_NA_CONTA)).toBe("entrar");
    expect(codigoAvisoCupom(MSG_CUPOM_LIMITE_ATINGIDO)).toBe("limite");
    expect(codigoAvisoCupom(undefined)).toBeNull();
    expect(codigoAvisoCupom("outra coisa")).toBeNull();
  });
  it("código → texto por tabela fixa; nunca reflete texto livre", () => {
    expect(textoAvisoCupom("entrar")).toBe(MSG_CUPOM_ENTRAR_NA_CONTA);
    expect(textoAvisoCupom("limite")).toBe(MSG_CUPOM_LIMITE_ATINGIDO);
    expect(textoAvisoCupom("<script>alert(1)</script>")).toBeNull();
    expect(textoAvisoCupom("toString")).toBeNull();
    expect(textoAvisoCupom("__proto__")).toBeNull();
    expect(textoAvisoCupom(["entrar"])).toBeNull();
    expect(textoAvisoCupom(undefined)).toBeNull();
  });
});

describe("hrefCompletarCheckout", () => {
  it("leva a /conta/completar com next do checkout", () => {
    expect(hrefCompletarCheckout("pizzaria-x")).toBe(
      "/conta/completar?next=%2Floja%2Fpizzaria-x%2Fpedido",
    );
  });
  it("slug fora do padrão → sem next", () => {
    expect(hrefCompletarCheckout("//evil.com")).toBe("/conta/completar");
    expect(hrefCompletarCheckout("a/../b")).toBe("/conta/completar");
  });
});
