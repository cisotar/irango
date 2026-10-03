import { describe, expect, it } from "vitest";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { hrefsConta, itensMenuCliente } from "./menuCliente";

describe("itensMenuCliente", () => {
  it("Minha conta, Endereços e Pedidos com next=/loja/<slug>", () => {
    expect(itensMenuCliente("lanches-base")).toEqual([
      { href: "/minha-conta?next=%2Floja%2Flanches-base", rotulo: "Minha conta" },
      { href: "/minha-conta/enderecos?next=%2Floja%2Flanches-base", rotulo: "Endereços" },
      { href: "/minha-conta/pedidos?next=%2Floja%2Flanches-base", rotulo: "Pedidos" },
    ]);
  });

  it("slug fora do padrão → links sem next", () => {
    expect(itensMenuCliente("//evil.com").map((i) => i.href)).toEqual([
      "/minha-conta",
      "/minha-conta/enderecos",
      "/minha-conta/pedidos",
    ]);
  });
});

describe("hrefsConta", () => {
  it("entrar e cadastro carregam o mesmo next", () => {
    expect(hrefsConta("/loja/lanches-base")).toEqual({
      entrar: "/conta/entrar?next=%2Floja%2Flanches-base",
      cadastro: "/conta/cadastro?next=%2Floja%2Flanches-base",
    });
  });

  it("o next decodificado passa no sanitizarNext", () => {
    const { entrar } = hrefsConta("/loja/lanches-base");
    const next = new URL(entrar, "http://x.invalid").searchParams.get("next");
    expect(sanitizarNext(next)).toBe("/loja/lanches-base");
  });

  it("sem next → links sem query", () => {
    expect(hrefsConta(undefined)).toEqual({ entrar: "/conta/entrar", cadastro: "/conta/cadastro" });
  });
});
