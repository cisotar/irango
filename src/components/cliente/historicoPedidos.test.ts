import { describe, expect, it } from "vitest";
import { hrefCarregarMais, montarHistorico, paginaDoParam, POR_PAGINA } from "./historicoPedidos";
import type { PedidoDoCliente } from "@/lib/supabase/queries/pedidos";

function pedido(i: number, slug: string | null = "loja-a"): PedidoDoCliente {
  return {
    id: `p${i}`,
    loja_id: "l1",
    status: "pendente",
    total: 10 + i,
    criado_em: "2026-10-01T12:00:00Z",
    token_acesso: `t ${i}`,
    lojas: slug ? { nome: "Loja A", slug } : null,
  } as PedidoDoCliente;
}

describe("paginaDoParam", () => {
  it("ausente, inválido ou negativo → 0", () => {
    expect(paginaDoParam(undefined)).toBe(0);
    expect(paginaDoParam("abc")).toBe(0);
    expect(paginaDoParam("-2")).toBe(0);
    expect(paginaDoParam("1.5")).toBe(0);
  });
  it("número válido, com teto", () => {
    expect(paginaDoParam("3")).toBe(3);
    expect(paginaDoParam("99999")).toBe(49);
  });
});

describe("montarHistorico", () => {
  it("mapeia linha com link de confirmação por token", () => {
    const h = montarHistorico([[pedido(1)]]);
    expect(h.linhas).toEqual([
      {
        id: "p1",
        lojaNome: "Loja A",
        status: "pendente",
        total: 11,
        criadoEm: "2026-10-01T12:00:00Z",
        href: "/loja/loja-a/confirmacao?pedido=p1&token=t+1",
      },
    ]);
    expect(h.temMais).toBe(false);
  });

  it("sem loja legível → linha sem link", () => {
    const h = montarHistorico([[pedido(1, null)]]);
    expect(h.linhas[0].href).toBeNull();
    expect(h.linhas[0].lojaNome).toBe("Loja");
  });

  it("última página cheia → temMais", () => {
    const cheia = Array.from({ length: POR_PAGINA }, (_, i) => pedido(i));
    expect(POR_PAGINA).toBe(20);
    expect(montarHistorico([cheia]).temMais).toBe(true);
    expect(montarHistorico([cheia, [pedido(99)]]).linhas).toHaveLength(21);
    expect(montarHistorico([cheia, [pedido(99)]]).temMais).toBe(false);
  });

  it("vazio", () => {
    expect(montarHistorico([[]])).toEqual({ linhas: [], temMais: false });
  });
});

describe("hrefCarregarMais", () => {
  it("página dedicada: próxima página, sem âncora", () => {
    expect(hrefCarregarMais("/minha-conta/pedidos", 0, undefined)).toBe("/minha-conta/pedidos?pagina=1");
  });

  it("preserva o next sanitizado", () => {
    expect(hrefCarregarMais("/minha-conta/pedidos", 2, "/loja/padaria")).toBe(
      "/minha-conta/pedidos?pagina=3&next=%2Floja%2Fpadaria",
    );
  });

  it("página única: mantém a âncora #pedidos depois do Carregar mais", () => {
    expect(hrefCarregarMais("/minha-conta", 0, "/loja/padaria", "pedidos")).toBe(
      "/minha-conta?pagina=1&next=%2Floja%2Fpadaria#pedidos",
    );
  });
});
