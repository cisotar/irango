import { describe, expect, it } from "vitest";
import { hrefEntrarCheckout } from "./linkEntrar";

describe("hrefEntrarCheckout (343, RN-C17)", () => {
  it("monta /conta/entrar com next=/loja/<slug>/pedido", () => {
    expect(hrefEntrarCheckout("pizzaria-boa")).toBe(
      "/conta/entrar?next=%2Floja%2Fpizzaria-boa%2Fpedido",
    );
  });

  it("o next decodificado passa no sanitizarNext", async () => {
    const { sanitizarNext } = await import("@/lib/utils/sanitizarNext");
    const href = hrefEntrarCheckout("loja-x");
    const next = new URL(href, "http://x.invalid").searchParams.get("next");
    expect(sanitizarNext(next)).toBe("/loja/loja-x/pedido");
  });

  it("slug fora do padrão → /conta/entrar sem next", () => {
    expect(hrefEntrarCheckout("//evil.com")).toBe("/conta/entrar");
    expect(hrefEntrarCheckout("a/b")).toBe("/conta/entrar");
    expect(hrefEntrarCheckout("")).toBe("/conta/entrar");
  });
});
