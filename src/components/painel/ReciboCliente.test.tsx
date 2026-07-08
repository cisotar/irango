/**
 * Testes do ReciboCliente (issue 134 — via de cortesia do cliente, variante 3,
 * não-fiscal).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (ComandaCozinha.test.tsx, DetalhePedido.test.tsx).
 *
 * Foco (RN-P1/RN-P6, tasks/134): ao contrário do ComandaCozinha, este recibo É
 * financeiro completo — os testes de presença garantem que subtotal/desconto/
 * taxa/total/pagamento aparecem. A garantia central aqui é (1) o aviso não-
 * fiscal literal, (2) que os valores exibidos são o SNAPSHOT do pedido — nunca
 * recalculados no cliente a partir dos itens — e (3) que `token_acesso` nunca
 * vaza para o DOM.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReciboCliente } from "@/components/painel/ReciboCliente";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

const NOME_LOJA = "Cantina da Maria";
const TOKEN = "11111111-2222-3333-4444-555555555555";
const CRIADO_EM = "2026-07-07T17:32:00Z"; // 14:32 em São Paulo

function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    loja_id: "loja-1",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: "(11) 90000-0000",
    status: "pendente",
    tipo_entrega: "entrega",
    subtotal: 30,
    desconto: 0,
    cupom_codigo: null,
    taxa_entrega: 5,
    total: 35,
    troco_para: null,
    forma_pagamento: "pix",
    observacoes: null,
    criado_em: CRIADO_EM,
    token_acesso: TOKEN,
    endereco_entrega: { bairro: "Centro" },
    itens_pedido: [
      {
        id: "item-1",
        nome: "X-Salada",
        preco: 15,
        quantidade: 2,
        itens_pedido_opcionais: [],
      },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

function render(p: PedidoComItens = pedido()): string {
  return renderToStaticMarkup(<ReciboCliente pedido={p} nomeLoja={NOME_LOJA} />);
}

// ---------------------------------------------------------------------------
// Presença — loja, nº do pedido, data/hora, itens, total
// ---------------------------------------------------------------------------

describe("ReciboCliente — cabeçalho e identificação", () => {
  it("mostra o nome da loja", () => {
    expect(render()).toContain(NOME_LOJA);
  });

  it("mostra os 8 primeiros chars do id em maiúsculas, com #", () => {
    expect(render()).toContain("#ABCDEF12");
  });

  it("formata criado_em via formatarDataHora (fuso America/Sao_Paulo)", () => {
    expect(render()).toContain(formatarDataHora(CRIADO_EM));
  });
});

describe("ReciboCliente — itens com preço", () => {
  it("mostra quantidade, nome e preço*quantidade formatado (com 'R$')", () => {
    const html = render();
    expect(html).toContain("2×");
    expect(html).toContain("X-Salada");
    // preço 15 * quantidade 2 = 30 — snapshot, mesma aritmética de DetalhePedido.
    expect(html).toContain(formatarMoeda(30));
    expect(html).toContain("R$");
  });

  it("acréscimo dos opcionais entra no total da linha (snapshot, RN-O6)", () => {
    const html = render(
      pedido({
        itens_pedido: [
          {
            id: "item-1",
            nome: "X-Burguer",
            preco: 20,
            quantidade: 1,
            itens_pedido_opcionais: [
              { id: "op-1", nome_snapshot: "Bacon extra", preco_snapshot: 3.5, quantidade: 1 },
            ],
          },
        ],
      } as unknown as Partial<PedidoComItens>),
    );
    // (20 + 3.5) * 1 = 23.5 — se o componente ignorasse o acréscimo, mostraria
    // formatarMoeda(20) e este teste falharia.
    expect(html).toContain(formatarMoeda(23.5));
    expect(html).toContain("Bacon extra");
  });
});

describe("ReciboCliente — TOTAL do snapshot", () => {
  it("mostra o total do pedido formatado em 'R$'", () => {
    expect(render()).toContain(formatarMoeda(35));
  });
});

// ---------------------------------------------------------------------------
// Recálculo — o valor exibido é o snapshot, NUNCA recomputado no cliente
// ---------------------------------------------------------------------------

describe("ReciboCliente — sem recálculo no cliente", () => {
  it("total 'errado' (incompatível com subtotal+taxa-desconto) ainda é exibido tal como no snapshot", () => {
    // subtotal 30 + taxa 5 = 35 seria o total "coerente"; aqui forçamos um
    // total propositalmente destoante para provar que o componente não refaz
    // a conta — ele apenas exibe pedido.total, ponto.
    const html = render(pedido({ subtotal: 30, taxa_entrega: 5, desconto: 0, total: 999.99 }));
    expect(html).toContain(formatarMoeda(999.99));
    expect(html).not.toContain(formatarMoeda(35));
  });

  it("subtotal exibido é pedido.subtotal, não soma dos itens_pedido", () => {
    // itens somam 30 (15×2, exibido corretamente na linha do item), mas o
    // subtotal do snapshot é outro valor — se o componente recalculasse o
    // subtotal a partir dos itens em vez de usar pedido.subtotal, a linha
    // "Subtotal" mostraria 30 em vez de 12,34 e este teste pegaria.
    const html = render(pedido({ subtotal: 12.34 }));
    const linhaSubtotal = html.match(/<span>Subtotal<\/span><span[^>]*>([^<]+)<\/span>/);
    expect(linhaSubtotal?.[1]).toBe(formatarMoeda(12.34));
  });
});

// ---------------------------------------------------------------------------
// Desconto — só aparece quando desconto > 0
// ---------------------------------------------------------------------------

describe("ReciboCliente — desconto e cupom", () => {
  it("desconto = 0: linha de desconto NÃO aparece", () => {
    const html = render(pedido({ desconto: 0, cupom_codigo: null }));
    expect(html).not.toContain("Desconto");
  });

  it("desconto > 0: linha de desconto aparece com o valor e o código do cupom", () => {
    const html = render(pedido({ desconto: 5, cupom_codigo: "PROMO10" }));
    expect(html).toContain("Desconto (PROMO10)");
    expect(html).toContain(formatarMoeda(5));
  });

  it("desconto > 0 sem cupom_codigo: linha de desconto aparece sem parênteses de código", () => {
    const html = render(pedido({ desconto: 5, cupom_codigo: null }));
    expect(html).toContain("Desconto");
    expect(html).not.toContain("Desconto (");
  });
});

// ---------------------------------------------------------------------------
// Troco — só em dinheiro com troco_para > 0
// ---------------------------------------------------------------------------

describe("ReciboCliente — troco", () => {
  it("dinheiro com troco_para > 0: mostra linha de troco", () => {
    const html = render(
      pedido({ forma_pagamento: "dinheiro", troco_para: 50 }),
    );
    expect(html).toContain("Troco para");
    expect(html).toContain(formatarMoeda(50));
  });

  it("dinheiro sem troco_para (null): NÃO mostra linha de troco", () => {
    const html = render(pedido({ forma_pagamento: "dinheiro", troco_para: null }));
    expect(html).not.toContain("Troco para");
  });

  it("dinheiro com troco_para = 0: NÃO mostra linha de troco (borda)", () => {
    const html = render(pedido({ forma_pagamento: "dinheiro", troco_para: 0 }));
    expect(html).not.toContain("Troco para");
  });

  it("outra forma de pagamento (pix) com troco_para preenchido: NÃO mostra troco", () => {
    // Campo pode vir preenchido de um pedido anterior/erro de dado — só é
    // relevante quando a forma de pagamento é dinheiro.
    const html = render(pedido({ forma_pagamento: "pix", troco_para: 50 }));
    expect(html).not.toContain("Troco para");
  });
});

// ---------------------------------------------------------------------------
// RN-P6 — aviso não-fiscal literal, sem termos fiscais proibidos
// ---------------------------------------------------------------------------

describe("ReciboCliente — RN-P6 aviso não-fiscal", () => {
  it("contém o texto EXATO 'Documento sem valor fiscal — comprovante de pedido.'", () => {
    expect(render()).toContain("Documento sem valor fiscal — comprovante de pedido.");
  });

  it("NÃO contém 'cupom fiscal' nem 'nota fiscal' (case-insensitive)", () => {
    const html = render().toLowerCase();
    expect(html).not.toContain("cupom fiscal");
    expect(html).not.toContain("nota fiscal");
  });
});

// ---------------------------------------------------------------------------
// Segurança — token_acesso nunca vaza para o DOM
// ---------------------------------------------------------------------------

describe("ReciboCliente — sem token_acesso no DOM", () => {
  it("NÃO contém o token_acesso do pedido", () => {
    expect(render()).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// tipo_entrega e bairro
// ---------------------------------------------------------------------------

describe("ReciboCliente — tipo_entrega e bairro", () => {
  it("entrega com bairro: mostra 'Entrega' e o bairro", () => {
    const html = render();
    expect(html).toContain("Entrega");
    expect(html).toContain("Centro");
  });

  it("retirada: NÃO mostra bairro, mesmo com endereco_entrega preenchido", () => {
    const html = render(pedido({ tipo_entrega: "retirada" } as unknown as Partial<PedidoComItens>));
    expect(html).toContain("Retirada");
    expect(html).not.toContain("Centro");
  });
});

// ---------------------------------------------------------------------------
// Bordas
// ---------------------------------------------------------------------------

describe("ReciboCliente — bordas", () => {
  it("pedido sem itens: não quebra e não renderiza nenhum <li>", () => {
    const html = render(pedido({ itens_pedido: [] } as unknown as Partial<PedidoComItens>));
    expect(html).not.toContain("X-Salada");
    expect(html).not.toMatch(/<li/);
    // totais continuam vindo do snapshot mesmo sem itens.
    expect(html).toContain(formatarMoeda(35));
  });

  it("forma_pagamento null: mostra '—' em vez de quebrar", () => {
    const html = render(pedido({ forma_pagamento: null } as unknown as Partial<PedidoComItens>));
    expect(html).toContain("Pagamento: —");
  });

  it("forma_pagamento fora do mapa: cai no valor cru (borda)", () => {
    const html = render(
      pedido({ forma_pagamento: "boleto" } as unknown as Partial<PedidoComItens>),
    );
    expect(html).toContain("boleto");
  });
});
