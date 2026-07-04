/**
 * Testes do TabelaPedidos (issue 123 — parametrização de `basePedidos`).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (ThumbProduto.test.tsx, StatusAssinatura.test.tsx).
 *
 * Foco: o único risco real desta issue é regressão nos `href` (desktop e
 * mobile). Cobrimos os dois breakpoints, com e sem o prop `basePedidos`.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TabelaPedidos, type PedidoLinha } from "@/components/painel/TabelaPedidos";

const PEDIDO: PedidoLinha = {
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  nome_cliente: "Fulano de Teste",
  total: 4200,
  status: "pendente",
  criado_em: "2026-07-03T12:00:00.000Z",
};

function render(props: Partial<Parameters<typeof TabelaPedidos>[0]> = {}): string {
  return renderToStaticMarkup(<TabelaPedidos pedidos={[PEDIDO]} {...props} />);
}

describe("TabelaPedidos href", () => {
  it("sem basePedidos, aponta para /painel/pedidos/[id] (default)", () => {
    const html = render();
    // Ambos os breakpoints (desktop + mobile) emitem o mesmo href.
    const ocorrencias = html.match(
      new RegExp(`href="/painel/pedidos/${PEDIDO.id}"`, "g"),
    );
    expect(ocorrencias).toHaveLength(2);
  });

  it("sem basePedidos, NÃO gera prefixo admin (zero regressão no painel)", () => {
    const html = render();
    expect(html).not.toContain("/admin/");
  });

  it("com basePedidos admin, aponta para o contexto admin (desktop + mobile)", () => {
    const html = render({ basePedidos: "/admin/assinantes/L1/pedidos" });
    const ocorrencias = html.match(
      new RegExp(`href="/admin/assinantes/L1/pedidos/${PEDIDO.id}"`, "g"),
    );
    expect(ocorrencias).toHaveLength(2);
  });

  it("com basePedidos admin, não sobra link antigo /painel/pedidos", () => {
    const html = render({ basePedidos: "/admin/assinantes/L1/pedidos" });
    expect(html).not.toContain(`href="/painel/pedidos/${PEDIDO.id}"`);
  });

  it("lista vazia: mostra estado vazio e não renderiza nenhum link (early-return, branch nunca antes exercitada)", () => {
    const html = render({ pedidos: [], basePedidos: "/admin/assinantes/L1/pedidos" });
    expect(html).toContain("Nenhum pedido ainda");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/admin/assinantes/L1/pedidos/");
  });
});
