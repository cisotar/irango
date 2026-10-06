import { describe, expect, it } from "vitest";
import { hrefSecao, SECOES_CONTA, secaoAtiva, secaoDaRota } from "./secoesConta";

describe("SECOES_CONTA", () => {
  it("três seções, nesta ordem, com os ids das âncoras da página única", () => {
    expect(SECOES_CONTA.map((s) => s.id)).toEqual(["dados-pessoais", "enderecos", "pedidos"]);
    expect(SECOES_CONTA.map((s) => s.rotulo)).toEqual(["Dados pessoais", "Endereços", "Pedidos"]);
  });
});

describe("hrefSecao", () => {
  it("sem next → /minha-conta#<id>", () => {
    expect(hrefSecao("pedidos", undefined)).toBe("/minha-conta#pedidos");
  });

  it("com next → preserva o parâmetro antes da âncora", () => {
    expect(hrefSecao("enderecos", "/loja/padaria")).toBe("/minha-conta?next=%2Floja%2Fpadaria#enderecos");
  });
});

describe("secaoDaRota", () => {
  it("página dedicada destaca a seção correspondente", () => {
    expect(secaoDaRota("/minha-conta/enderecos")).toBe("enderecos");
    expect(secaoDaRota("/minha-conta/pedidos")).toBe("pedidos");
  });

  it("página única ou rota desconhecida → null (o destaque vem do scroll)", () => {
    expect(secaoDaRota("/minha-conta")).toBeNull();
    expect(secaoDaRota("/outra")).toBeNull();
    expect(secaoDaRota(null)).toBeNull();
  });
});

describe("secaoAtiva", () => {
  const topos = (d: number, e: number, p: number) => [
    { id: "dados-pessoais" as const, topo: d },
    { id: "enderecos" as const, topo: e },
    { id: "pedidos" as const, topo: p },
  ];

  it("nenhum topo passou da linha (início da página) → primeira seção", () => {
    expect(secaoAtiva(topos(300, 900, 1500), 200, false)).toBe("dados-pessoais");
  });

  it("última seção cujo topo passou da linha de leitura", () => {
    expect(secaoAtiva(topos(-600, 100, 700), 200, false)).toBe("enderecos");
    expect(secaoAtiva(topos(-1200, -500, 150), 200, false)).toBe("pedidos");
  });

  it("no fim da página → última seção, mesmo curta demais para chegar à linha", () => {
    expect(secaoAtiva(topos(-900, -200, 500), 200, true)).toBe("pedidos");
  });

  it("seção ausente do DOM (topo infinito) é ignorada", () => {
    expect(secaoAtiva(topos(-600, Infinity, Infinity), 200, true)).toBe("dados-pessoais");
  });

  it("lista vazia → null", () => {
    expect(secaoAtiva([], 200, false)).toBeNull();
  });
});
