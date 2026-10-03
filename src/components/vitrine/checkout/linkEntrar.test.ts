import { describe, expect, it } from "vitest";
import { hrefCadastroCheckout, hrefEntrarCheckout, nextDaLoja } from "./linkEntrar";

describe("hrefCadastroCheckout", () => {
  it("monta /conta/cadastro com next=/loja/<slug>/pedido", () => {
    expect(hrefCadastroCheckout("lanches-base")).toBe(
      "/conta/cadastro?next=%2Floja%2Flanches-base%2Fpedido",
    );
  });

  it("o next decodificado passa no sanitizarNext", async () => {
    const { sanitizarNext } = await import("@/lib/utils/sanitizarNext");
    const next = new URL(hrefCadastroCheckout("loja-x"), "http://x.invalid").searchParams.get("next");
    expect(sanitizarNext(next)).toBe("/loja/loja-x/pedido");
  });

  it("slug fora do padrão → /conta/cadastro sem next", () => {
    expect(hrefCadastroCheckout("//evil.com")).toBe("/conta/cadastro");
    expect(hrefCadastroCheckout("../x")).toBe("/conta/cadastro");
  });
});

describe("nextDaLoja", () => {
  it("monta o caminho da loja, com ou sem /pedido", () => {
    expect(nextDaLoja("lanches-base")).toBe("/loja/lanches-base");
    expect(nextDaLoja("lanches-base", "/pedido")).toBe("/loja/lanches-base/pedido");
  });

  it("slug fora do padrão → undefined", () => {
    expect(nextDaLoja("//evil.com")).toBeUndefined();
    expect(nextDaLoja("../x")).toBeUndefined();
    expect(nextDaLoja("")).toBeUndefined();
  });
});

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
