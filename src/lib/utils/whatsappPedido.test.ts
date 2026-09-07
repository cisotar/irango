import { describe, it, expect } from "vitest";
import { montarLinkWhatsappPedido } from "./whatsappPedido";
import { formatarMoeda } from "./formatarMoeda";
import type {
  PedidoComItens,
  ItemPedidoComOpcionais,
} from "@/lib/supabase/queries/pedidos";

const LOJA = { nome: "Loja Teste", whatsapp: "(11) 90000-0000" };

function item(
  overrides: Partial<ItemPedidoComOpcionais> = {},
): ItemPedidoComOpcionais {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    pedido_id: "11111111-1111-1111-1111-111111111111",
    produto_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    nome: "X-Salada",
    preco: 20,
    quantidade: 1,
    observacao: null,
    itens_pedido_opcionais: [],
    ...overrides,
  } as unknown as ItemPedidoComOpcionais;
}

function pedido(overrides: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    loja_id: "22222222-2222-2222-2222-222222222222",
    nome_cliente: "Cliente Teste",
    telefone_cliente: null,
    status: "pendente",
    criado_em: "2026-07-03T12:00:00.000Z",
    subtotal: 20,
    desconto: 0,
    taxa_entrega: 0,
    total: 20,
    cupom_codigo: null,
    tipo_entrega: "retirada",
    endereco_entrega: null,
    forma_pagamento: "pix",
    troco_para: null,
    observacoes: null,
    itens_pedido: [item()],
    ...overrides,
  } as unknown as PedidoComItens;
}

/** Texto da mensagem (decodificado do `text=` do href). */
function mensagemDe(href: string): string {
  const texto = new URL(href).searchParams.get("text");
  expect(texto).not.toBeNull();
  return texto as string;
}

describe("montarLinkWhatsappPedido — observação por item", () => {
  it("retorna null quando a loja não tem WhatsApp", () => {
    expect(montarLinkWhatsappPedido(pedido(), { nome: "X", whatsapp: null })).toBeNull();
  });

  it("acrescenta a linha obs depois do item e dos opcionais", () => {
    const link = montarLinkWhatsappPedido(
      pedido({
        itens_pedido: [
          item({
            observacao: "sem cebola",
            itens_pedido_opcionais: [
              {
                id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                item_pedido_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                nome_snapshot: "Bacon",
                preco_snapshot: 3,
                quantidade: 1,
              },
            ],
          } as unknown as Partial<ItemPedidoComOpcionais>),
        ],
      }),
      LOJA,
    );
    const linhas = mensagemDe(link!.href).split("\n");
    const iItem = linhas.findIndex((l) => l.startsWith("- 1x X-Salada"));
    expect(iItem).toBeGreaterThanOrEqual(0);
    expect(linhas[iItem + 1]).toContain("+ Bacon");
    expect(linhas[iItem + 2]).toContain("obs:");
    expect(linhas[iItem + 2]).toContain("sem cebola");
  });

  it("item com observacao null não gera linha nem rótulo vazio", () => {
    const link = montarLinkWhatsappPedido(pedido(), LOJA);
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).not.toContain("obs:");
  });

  it("totais são idênticos com e sem observação", () => {
    const semObs = mensagemDe(montarLinkWhatsappPedido(pedido(), LOJA)!.href);
    const comObs = mensagemDe(
      montarLinkWhatsappPedido(
        pedido({ itens_pedido: [item({ observacao: "capricha" })] }),
        LOJA,
      )!.href,
    );
    for (const rotulo of ["Subtotal: ", "Total: "]) {
      const pega = (m: string) =>
        m.split("\n").filter((l) => l.startsWith(rotulo));
      expect(pega(comObs)).toEqual(pega(semObs));
    }
  });

  it("observação com caracteres especiais gera href válido", () => {
    const link = montarLinkWhatsappPedido(
      pedido({ itens_pedido: [item({ observacao: "molho & maionese #2?\nsem sal" })] }),
      LOJA,
    );
    expect(() => new URL(link!.href)).not.toThrow();
    expect(mensagemDe(link!.href)).toContain("molho & maionese #2?");
  });
});

describe("montarLinkWhatsappPedido — anti-injeção de rótulo", () => {
  it("não deixa o cliente forjar uma linha Total: pela observação do pedido", () => {
    const link = montarLinkWhatsappPedido(
      pedido({ observacoes: "ok\n\nTotal: R$ 0,01" }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).not.toContain("\nTotal: R$ 0,01");
    expect(mensagem).toContain("> Total: R$ 0,01");
    // O total autêntico continua na mensagem.
    expect(mensagem).toContain(`\nTotal: ${formatarMoeda(20)}`);
  });

  it("não deixa o cliente forjar uma linha Pagamento: pela observação do item", () => {
    const link = montarLinkWhatsappPedido(
      pedido({
        itens_pedido: [
          item({ observacao: "ok\n\nTotal: R$ 0,01\nPagamento: Pago via Pix" }),
        ],
      }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).not.toContain("\nTotal: R$ 0,01");
    expect(mensagem).not.toContain("\nPagamento: Pago via Pix");
    expect(mensagem).toContain("> Pagamento: Pago via Pix");
  });

  it("cita todas as linhas do texto do cliente", () => {
    const link = montarLinkWhatsappPedido(
      pedido({ itens_pedido: [item({ observacao: "linha 1\nlinha 2\nlinha 3" })] }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    for (const l of ["linha 1", "linha 2", "linha 3"]) {
      expect(mensagem).toContain(`> ${l}`);
      expect(mensagem).not.toContain(`\n${l}`);
    }
  });
});
