/**
 * Testes do ComandaCozinha (issue 133 — via de preparo, variante cozinha).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (DetalhePedido.test.tsx, ListaOpcionaisItem.test.tsx, HeaderLoja.test.tsx).
 *
 * Foco (RN-P1, tasks/133): a garantia central é ZERO financeiro no DOM — nem
 * mesmo quando o pedido tem desconto/cupom/troco preenchidos e um opcional com
 * `preco_snapshot > 0` (prova que `ocultarPreco` está de fato ligado em
 * ListaOpcionaisItem, e não só "por coincidência" porque os dados eram zero).
 * Cobre também presença de nº/cliente/itens/opcionais/observações e as bordas
 * de tipo_entrega, bairro e observações ausentes/vazias.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ComandaCozinha } from "@/components/painel/ComandaCozinha";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

const TELEFONE = "(11) 90000-0000";
const TOKEN = "11111111-2222-3333-4444-555555555555";
const CRIADO_EM = "2026-07-07T17:32:00Z"; // 14:32 em São Paulo

/**
 * Pedido "recheado": tem tudo que a comanda da cozinha NÃO pode vazar
 * (desconto, cupom, taxa, total, troco, forma de pagamento, telefone, token)
 * e um opcional com preço > 0 — se `ocultarPreco` não estivesse ligado, ou se
 * algum campo financeiro vazasse por engano, os testes de ausência abaixo
 * pegariam.
 */
function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    loja_id: "loja-1",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: TELEFONE,
    status: "pendente",
    tipo_entrega: "entrega",
    subtotal: 3350,
    desconto: 500,
    cupom_codigo: "PROMO10",
    taxa_entrega: 500,
    total: 3350,
    troco_para: 5000,
    forma_pagamento: "dinheiro",
    observacoes: "Sem cebola, por favor",
    criado_em: CRIADO_EM,
    token_acesso: TOKEN,
    endereco_entrega: { bairro: "Centro" },
    itens_pedido: [
      {
        id: "item-1",
        nome: "X-Salada",
        preco: 1500,
        quantidade: 2,
        itens_pedido_opcionais: [
          {
            id: "op-1",
            nome_snapshot: "Bacon extra",
            preco_snapshot: 350,
            quantidade: 1,
          },
        ],
      },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

function render(p: PedidoComItens = pedido()): string {
  return renderToStaticMarkup(<ComandaCozinha pedido={p} />);
}

// ---------------------------------------------------------------------------
// Presença — nº do pedido, data/hora, cliente
// ---------------------------------------------------------------------------

describe("ComandaCozinha — nº do pedido, data e cliente", () => {
  it("mostra os 8 primeiros chars do id em maiúsculas, com #", () => {
    expect(render()).toContain("#ABCDEF12");
  });

  it("formata criado_em via formatarDataHora (fuso America/Sao_Paulo)", () => {
    expect(render()).toContain(formatarDataHora(CRIADO_EM));
  });

  it("mostra o nome do cliente", () => {
    expect(render()).toContain("Fulano de Teste");
  });
});

// ---------------------------------------------------------------------------
// Presença — itens e opcionais
// ---------------------------------------------------------------------------

describe("ComandaCozinha — itens e opcionais", () => {
  it("mostra quantidade e nome de cada item", () => {
    const html = render();
    expect(html).toContain("2×");
    expect(html).toContain("X-Salada");
  });

  it("mostra opcionais via ListaOpcionaisItem (quantidade + nome)", () => {
    const html = render();
    expect(html).toContain("1×");
    expect(html).toContain("Bacon extra");
  });

  it("item sem opcionais não quebra e não deixa lixo de opcional", () => {
    const html = render(
      pedido({
        itens_pedido: [
          {
            id: "item-2",
            nome: "Suco",
            preco: 800,
            quantidade: 1,
            itens_pedido_opcionais: [],
          },
        ],
      } as unknown as Partial<PedidoComItens>),
    );
    expect(html).toContain("Suco");
    expect(html).not.toContain("Bacon extra");
  });
});

// ---------------------------------------------------------------------------
// Ausência de financeiro — a garantia central (RN-P1)
// ---------------------------------------------------------------------------

describe("ComandaCozinha — ausência de financeiro (RN-P1)", () => {
  it("NÃO contém 'R$' mesmo com um opcional de preco_snapshot > 0 (ocultarPreco ligado)", () => {
    // O pedido fake tem opcional com preco_snapshot=350 (R$ 3,50). Se
    // `ocultarPreco` não estivesse de fato passado a ListaOpcionaisItem, ou se
    // alguém reintroduzisse formatarMoeda no componente, este teste falha.
    expect(render()).not.toContain("R$");
  });

  it("NÃO contém subtotal, desconto, taxa, total, forma de pagamento nem troco", () => {
    const html = render().toLowerCase();
    for (const termo of ["subtotal", "desconto", "taxa", "total", "pagamento", "troco"]) {
      expect(html).not.toContain(termo);
    }
  });

  it("NÃO contém o código do cupom (estratégia comercial não vaza para a cozinha)", () => {
    expect(render()).not.toContain("PROMO10");
  });

  it("NÃO contém o telefone do cliente", () => {
    expect(render()).not.toContain(TELEFONE);
  });

  it("NÃO contém o token_acesso do pedido", () => {
    expect(render()).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// tipo_entrega e bairro
// ---------------------------------------------------------------------------

describe("ComandaCozinha — tipo_entrega e bairro", () => {
  it("entrega com bairro: mostra 'Entrega' e 'Bairro: <bairro>'", () => {
    const html = render();
    expect(html).toContain("Entrega");
    expect(html).toContain("Bairro: Centro");
  });

  it("retirada: NÃO mostra linha de bairro, mesmo com endereco_entrega preenchido", () => {
    const html = render(
      pedido({ tipo_entrega: "retirada" } as unknown as Partial<PedidoComItens>),
    );
    expect(html).toContain("Retirada");
    expect(html).not.toContain("Bairro:");
  });

  it("entrega sem bairro no endereco_entrega: NÃO mostra linha de bairro", () => {
    const html = render(
      pedido({ endereco_entrega: {} } as unknown as Partial<PedidoComItens>),
    );
    expect(html).not.toContain("Bairro:");
  });

  it("tipo_entrega fora do mapa: cai no valor cru (borda)", () => {
    const html = render(
      pedido({ tipo_entrega: "agendado" } as unknown as Partial<PedidoComItens>),
    );
    expect(html).toContain("agendado");
  });
});

// ---------------------------------------------------------------------------
// Observações — bloco em destaque só quando existem
// ---------------------------------------------------------------------------

describe("ComandaCozinha — observações", () => {
  it("observações presentes: mostra bloco 'Obs:' com o texto", () => {
    const html = render();
    expect(html).toContain("Obs:");
    expect(html).toContain("Sem cebola, por favor");
  });

  it("observações null: bloco 'Obs:' NÃO renderiza", () => {
    const html = render(
      pedido({ observacoes: null } as unknown as Partial<PedidoComItens>),
    );
    expect(html).not.toContain("Obs:");
  });

  it("observações string vazia: bloco 'Obs:' NÃO renderiza (borda)", () => {
    const html = render(
      pedido({ observacoes: "" } as unknown as Partial<PedidoComItens>),
    );
    expect(html).not.toContain("Obs:");
  });
});

// ---------------------------------------------------------------------------
// Bordas — pedido sem itens
// ---------------------------------------------------------------------------

describe("ComandaCozinha — bordas", () => {
  it("pedido sem itens: não quebra e não renderiza nenhum <li>", () => {
    const html = render(
      pedido({ itens_pedido: [] } as unknown as Partial<PedidoComItens>),
    );
    expect(html).not.toContain("X-Salada");
    expect(html).not.toMatch(/<li/);
  });
});
