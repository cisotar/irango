/** Histórico compartilhado pela seção de /minha-conta e por /minha-conta/pedidos. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/queries/pedidos", () => ({ listarPedidosDoCliente: vi.fn() }));

import { HistoricoPedidos, type Historico } from "./HistoricoPedidos";

const linha = (i: number, href: string | null = `/loja/a/confirmacao?pedido=p${i}&token=t`) => ({
  id: `p${i}`,
  lojaNome: "Loja A",
  status: "entregue",
  total: 48.9,
  criadoEm: "2026-10-05T22:42:00Z",
  href,
});

const render = (historico: Historico, hrefMais = "/minha-conta?pagina=1#pedidos") =>
  renderToStaticMarkup(<HistoricoPedidos historico={historico} hrefMais={hrefMais} />);

describe("HistoricoPedidos", () => {
  it("sem pedidos → estado vazio, sem Carregar mais", () => {
    const html = render({ linhas: [], temMais: false });
    expect(html).toContain("Você ainda não fez pedidos com sua conta.");
    expect(html).not.toContain("Carregar mais");
  });

  it("linha: loja, total, Ver pedido; empilhada e em linha única a partir de 34rem de container", () => {
    const html = render({ linhas: [linha(1)], temMais: false });
    expect(html).toContain("Loja A");
    expect(html).toContain("48,90");
    expect(html).toContain("Ver pedido");
    expect(html).toContain('href="/loja/a/confirmacao?pedido=p1&amp;token=t"');
    expect(html).toContain("@min-[34rem]:flex-row");
  });

  it("sem href (loja ilegível) → sem Ver pedido", () => {
    expect(render({ linhas: [linha(1, null)], temMais: false })).not.toContain("Ver pedido");
  });

  it("temMais → Carregar mais aponta para o href recebido (com a âncora)", () => {
    const html = render({ linhas: [linha(1)], temMais: true });
    expect(html).toContain("Carregar mais");
    expect(html).toContain('href="/minha-conta?pagina=1#pedidos"');
  });
});
