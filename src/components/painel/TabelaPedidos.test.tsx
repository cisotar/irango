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
  tipo_entrega: "entrega",
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

// ---------------------------------------------------------------------------
// Selo de status clicável (issue 329) — StatusDaLinha: terminal vs. aberto,
// e a invariante de markup "nenhum <button> dentro de <a>" nos dois breakpoints.
// ---------------------------------------------------------------------------

describe("TabelaPedidos — selo de status por linha (StatusDaLinha)", () => {
  it("status terminal (entregue/cancelado): selo estático, SEM <button> em nenhuma linha", () => {
    const html = render({
      pedidos: [
        { ...PEDIDO, id: "11111111-1111-1111-1111-111111111111", status: "entregue" },
        { ...PEDIDO, id: "22222222-2222-2222-2222-222222222222", status: "cancelado" },
      ],
    });
    expect(html).not.toContain("<button");
    expect(html).toContain("Entregue");
    expect(html).toContain("Cancelado");
  });

  it("status aberto (ex.: pendente): a célula de status vira <button> (gatilho do menu), desktop + mobile", () => {
    const html = render({ pedidos: [{ ...PEDIDO, status: "pendente" }] });
    const gatilhos = html.match(/<button[^>]*aria-haspopup="menu"/g);
    expect(gatilhos).toHaveLength(2); // desktop + mobile
  });

  it("nenhum <button> aparece DENTRO de um <a> — nem no card mobile, nem na linha desktop", () => {
    const html = render({ pedidos: [{ ...PEDIDO, status: "pendente" }] });
    // Cada <a>...</a> (o link do pedido) não deve conter nenhum <button dentro.
    const linksComBotaoDentro = html.match(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button/g);
    expect(linksComBotaoDentro).toBeNull();
  });

  it("aria-label do gatilho carrega o número do pedido e o rótulo do status atual", () => {
    const html = render({
      pedidos: [{ ...PEDIDO, id: "abcdef12-3456-7890-abcd-ef1234567890", status: "confirmado" }],
    });
    expect(html).toContain(
      'aria-label="Alterar status do pedido #ABCDEF12, atual: Confirmado"',
    );
  });

  it("pedido de retirada em saiu_entrega mostra 'Pronto para retirada' (aria-label + texto do selo, em cada breakpoint) e NUNCA 'Saiu pra entrega'", () => {
    const html = render({
      pedidos: [{ ...PEDIDO, status: "saiu_entrega", tipo_entrega: "retirada" }],
    });
    // 1 aria-label + 1 texto visível do selo, × 2 breakpoints (desktop+mobile).
    expect(html.match(/Pronto para retirada/g)).toHaveLength(4);
    expect(html).not.toContain("Saiu pra entrega");
  });

  it("pedido de entrega em saiu_entrega mostra 'Saiu pra entrega', nunca 'Pronto para retirada'", () => {
    const html = render({
      pedidos: [{ ...PEDIDO, status: "saiu_entrega", tipo_entrega: "entrega" }],
    });
    expect(html.match(/Saiu pra entrega/g)).toHaveLength(4);
    expect(html).not.toContain("Pronto para retirada");
  });
});

describe("TabelaPedidos modo detalhe do cliente (347 D1/D2)", () => {
  it("default preserva /painel/pedidos: coluna Cliente, Hora e menu de status", () => {
    const html = render();
    expect(html).toContain(">Cliente</th>");
    expect(html).toContain(">Hora</th>");
    expect(html).toContain("Fulano de Teste");
  });
  it("somenteLeitura + exibirCliente=false + exibirData: sem nome, coluna Data com dia", () => {
    const html = render({ somenteLeitura: true, exibirCliente: false, exibirData: true });
    expect(html).not.toContain(">Cliente</th>");
    expect(html).not.toContain("Fulano de Teste");
    expect(html).toContain(">Data</th>");
    expect(html).toContain("03/07/2026 09:00");
  });
  it("somenteLeitura troca o menu (botão) pelo selo estático", () => {
    expect(render()).toContain("<button");
    expect(render({ somenteLeitura: true })).not.toContain("<button");
  });
});
