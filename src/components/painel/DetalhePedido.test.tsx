/**
 * Testes do DetalhePedido (issue 125 — extração do detalhe inline do painel
 * para componente compartilhado painel/admin).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (DashboardLoja.test.tsx, TabelaPedidos.test.tsx).
 *
 * Foco: travar a regressão da extração — cabeçalho/badge, o link "Voltar"
 * dirigido por `basePedidos` (default e admin), itens/totais formatados via
 * snapshot autoritativo, e os fallbacks de endereço/forma de pagamento.
 * Limitação: o disparo de `acaoStatus` (client em `AcoesStatus`) não é
 * observável em `renderToStaticMarkup`; a fiação é garantida por tipo.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// DetalhePedido renderiza AcoesStatus (client), que chama useRouter() no topo;
// SSR estático não tem App Router montado. Mock idêntico ao de AcoesStatus.test
// — infra de render, sem relação com o que estes testes cobrem.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DetalhePedido } from "@/components/painel/DetalhePedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: "(11) 90000-0000",
    status: "pendente",
    subtotal: 3000,
    desconto: 0,
    cupom_codigo: null,
    taxa_entrega: 500,
    total: 3500,
    forma_pagamento: "pix",
    observacoes: null,
    endereco_entrega: null,
    itens_pedido: [
      {
        id: "item-1",
        nome: "X-Salada",
        preco: 1500,
        quantidade: 2,
      },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

function render(
  props: Partial<Parameters<typeof DetalhePedido>[0]> = {},
): string {
  return renderToStaticMarkup(
    <DetalhePedido
      pedido={props.pedido ?? pedido()}
      basePedidos={props.basePedidos}
    />,
  );
}

describe("DetalhePedido cabeçalho", () => {
  it("mostra 'Pedido #' com os 8 primeiros chars do id em maiúsculas", () => {
    const html = render();
    expect(html).toContain("Pedido #ABCDEF12");
  });

  it("renderiza o badge com o rótulo de APARENCIA_STATUS", () => {
    expect(render()).toContain("Pendente");
    expect(render({ pedido: pedido({ status: "entregue" }) })).toContain(
      "Entregue",
    );
  });
});

describe("DetalhePedido link Voltar", () => {
  it("sem basePedidos: aponta para /painel/pedidos (default)", () => {
    const html = render();
    expect(html).toContain('href="/painel/pedidos"');
    expect(html).not.toContain("/admin/");
  });

  it("com basePedidos admin: reaponta sem cópia de markup", () => {
    const html = render({ basePedidos: "/admin/assinantes/L1/pedidos" });
    expect(html).toContain('href="/admin/assinantes/L1/pedidos"');
    expect(html).not.toContain('href="/painel/pedidos"');
  });
});

describe("DetalhePedido itens e totais", () => {
  it("cada item exibe quantidade, nome e preço*quantidade formatado", () => {
    const html = render();
    expect(html).toContain("2×");
    expect(html).toContain("X-Salada");
    // preço 1500 * quantidade 2 = 3000 (snapshot, não recálculo do produto).
    expect(html).toContain(formatarMoeda(3000));
  });

  it("subtotal, taxa e total formatados", () => {
    const html = render();
    expect(html).toContain(formatarMoeda(3000)); // subtotal
    expect(html).toContain(formatarMoeda(500)); // taxa
    expect(html).toContain(formatarMoeda(3500)); // total
  });

  it("desconto some quando 0", () => {
    expect(render()).not.toContain("Desconto");
  });

  it("desconto aparece com cupom_codigo quando > 0", () => {
    const html = render({
      pedido: pedido({ desconto: 500, cupom_codigo: "PROMO10" }),
    });
    expect(html).toContain("Desconto (PROMO10)");
    expect(html).toContain(formatarMoeda(500));
  });
});

describe("DetalhePedido fallbacks", () => {
  it("endereço nulo → 'Sem endereço de entrega.'", () => {
    expect(render()).toContain("Sem endereço de entrega.");
  });

  it("forma_pagamento fora do mapa cai no valor cru", () => {
    const html = render({
      pedido: pedido({ forma_pagamento: "boleto" as never }),
    });
    expect(html).toContain("boleto");
  });
});

describe("DetalhePedido bordas", () => {
  it("pedido sem itens: lista fica vazia mas totais continuam exibidos", () => {
    const html = render({ pedido: pedido({ itens_pedido: [] }) });
    expect(html).not.toContain("X-Salada");
    // sem <li> de item — só a estrutura de totais permanece.
    expect(html).not.toMatch(/<li/);
    expect(html).toContain(formatarMoeda(3000)); // subtotal do snapshot
    expect(html).toContain(formatarMoeda(3500)); // total do snapshot
  });

  it("status fora de APARENCIA_STATUS: badge omitido e AcoesStatus não quebra (transicaoPermitida com fallback)", () => {
    // Ambos os guards seguram um status desconhecido no banco (ou digitado
    // errado): DetalhePedido omite o badge (`aparencia &&`) e
    // `transicaoPermitida` retorna `false` via `TRANSICOES[de] ?? []` em vez
    // de lançar `Cannot read properties of undefined`.
    const html = render({
      pedido: pedido({
        status: "em_transito" as unknown as PedidoComItens["status"],
      }),
    });
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Iniciar preparo");
  });

  it("endereço como array: lerEndereco descarta e cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: ["rua", "numero"] as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).toContain("Sem endereço de entrega.");
  });

  it("endereço como string: lerEndereco descarta e cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: "Rua Teste, 123" as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).toContain("Sem endereço de entrega.");
  });

  it("endereço objeto válido: renderiza campos e não cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: {
          rua: "Rua das Flores",
          numero: "42",
          bairro: "Centro",
          cidade: "São Paulo",
          cep: "01000-000",
        } as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).not.toContain("Sem endereço de entrega.");
    expect(html).toContain("Rua das Flores");
    expect(html).toContain("42");
    expect(html).toContain("CEP 01000-000");
  });
});
