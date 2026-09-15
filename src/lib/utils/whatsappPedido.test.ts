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

describe("[180-B] montarLinkWhatsappPedido — frete a combinar não é 'R$ 0,00' nem 'Grátis'", () => {
  it("frete_a_combinar=true + taxa_entrega=null (entrega) → linha 'Entrega: A combinar', nunca R$ 0,00", () => {
    const link = montarLinkWhatsappPedido(
      pedido({
        tipo_entrega: "entrega",
        taxa_entrega: null as unknown as number,
        total: 20,
        frete_a_combinar: true,
      }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).toContain("Entrega: A combinar");
    expect(mensagem).not.toContain("R$ 0,00");
    expect(mensagem).not.toContain("Entrega: Grátis");
  });

  it("retirada com frete_a_combinar=false + taxa_entrega=0 continua dizendo 'Grátis' (não regride para 'A combinar')", () => {
    const link = montarLinkWhatsappPedido(
      pedido({
        tipo_entrega: "retirada",
        taxa_entrega: 0,
        frete_a_combinar: false,
      }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).toContain("Taxa de entrega: Grátis");
    expect(mensagem).not.toContain("A combinar");
  });

  it("entrega com frete conhecido (frete_a_combinar=false, taxa 8) continua mostrando o valor formatado", () => {
    const link = montarLinkWhatsappPedido(
      pedido({
        tipo_entrega: "entrega",
        taxa_entrega: 8,
        total: 28,
        frete_a_combinar: false,
      }),
      LOJA,
    );
    const mensagem = mensagemDe(link!.href);
    expect(mensagem).toContain(`Entrega: ${formatarMoeda(8)}`);
    expect(mensagem).not.toContain("A combinar");
  });
});

// ===========================================================================
// [197] Fase RED — RN-R7: a mensagem muda em DOIS pontos e mais nada.
//
// Ordem obrigatória da spec (`specs/retirada-endereco-da-loja.md` v0.3.0,
// seção Testes): TRAVAR o formato atual byte a byte ANTES de editar
// `whatsappPedido.ts`. Os dois blocos abaixo são, nesta ordem:
//   1. regressão — o texto de hoje, inteiro, congelado (deve continuar verde
//      DEPOIS da fase GREEN: é o alarme do "resto byte a byte igual");
//   2. comportamento novo — vermelho hoje, verde depois do GREEN.
// ===========================================================================

/** Pedido "completo": todos os blocos opcionais da mensagem acesos de uma vez. */
function pedidoCompleto(overrides: Partial<PedidoComItens> = {}): PedidoComItens {
  return pedido({
    telefone_cliente: "(11) 98888-7777",
    subtotal: 23,
    desconto: 2,
    taxa_entrega: 0,
    total: 21,
    cupom_codigo: "BEMVINDO",
    forma_pagamento: "dinheiro",
    troco_para: 50,
    observacoes: "tocar a campainha",
    frete_a_combinar: false,
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
    ...overrides,
  } as Partial<PedidoComItens>);
}

const ENDERECO_CLIENTE = {
  rua: "Rua das Flores",
  numero: "100",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
  cep: "13010-000",
};

/**
 * Loja COM endereço cadastrado. Declarada como variável (não literal inline)
 * de propósito: hoje o parâmetro é `Pick<LojaCompleta, "nome" | "whatsapp">` e
 * um literal com colunas a mais dispararia excess property check no `tsc`. A
 * fase GREEN alarga o Pick com `Partial<Pick<LojaCompleta, ...endereco>>`.
 */
const LOJA_COM_ENDERECO = {
  nome: "Loja Teste",
  whatsapp: "(11) 90000-0000",
  endereco_rua: "Rua da Padaria",
  endereco_numero: "45",
  endereco_bairro: "Vila Nova",
  endereco_cidade: "Campinas",
  endereco_estado: "SP",
  endereco_cep: "13010-000",
};

/** Loja SEM nenhuma coluna de endereço preenchida (RN-R5 — achado 5). */
const LOJA_SEM_ENDERECO = {
  nome: "Loja Teste",
  whatsapp: "(11) 90000-0000",
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  endereco_cep: null,
};

/** Mensagem de retirada de hoje, byte a byte (capturada antes de qualquer edição). */
const MENSAGEM_RETIRADA_ATUAL = [
  "Novo pedido iRango",
  "Loja: Loja Teste",
  "Pedido nº 11111111",
  "",
  "Itens:",
  "- 1x X-Salada — R$\u00A023,00",
  "  + Bacon (1x) — R$\u00A03,00",
  "  obs: > sem cebola",
  "",
  "Subtotal: R$\u00A023,00",
  "Desconto (BEMVINDO): -R$\u00A02,00",
  "Taxa de entrega: Grátis",
  "Total: R$\u00A021,00",
  "",
  "Entrega: Retirada no local",
  "Cliente: Cliente Teste — (11) 98888-7777",
  "",
  "Pagamento: Dinheiro",
  "Troco para R$\u00A050,00",
  "Obs.: > tocar a campainha",
  "",
  "Localize este pedido no painel pelo nº 11111111.",
].join("\n");

/** Mensagem de entrega de hoje, byte a byte, SEM a linha `Endereço:` (a que muda). */
const MENSAGEM_ENTREGA_ATUAL_SEM_LINHA_ENDERECO = [
  "Novo pedido iRango",
  "Loja: Loja Teste",
  "Pedido nº 11111111",
  "",
  "Itens:",
  "- 1x X-Salada — R$\u00A023,00",
  "  + Bacon (1x) — R$\u00A03,00",
  "  obs: > sem cebola",
  "",
  "Subtotal: R$\u00A023,00",
  "Desconto (BEMVINDO): -R$\u00A02,00",
  "Entrega: R$\u00A08,00",
  "Total: R$\u00A029,00",
  "",
  "Entrega: Entrega",
  "Cliente: Cliente Teste — (11) 98888-7777",
  "",
  "Pagamento: Dinheiro",
  "Troco para R$\u00A050,00",
  "Obs.: > tocar a campainha",
  "",
  "Localize este pedido no painel pelo nº 11111111.",
].join("\n");

function semLinhaEndereco(mensagem: string): string {
  return mensagem
    .split("\n")
    .filter((l) => !l.startsWith("Endereço: "))
    .join("\n");
}

describe("[197] RN-R7 regressão — o resto da mensagem é byte a byte igual", () => {
  it("retirada, loja SEM endereço: mensagem inteira idêntica ao formato de hoje", () => {
    const link = montarLinkWhatsappPedido(pedidoCompleto(), LOJA_SEM_ENDERECO);
    expect(mensagemDe(link!.href)).toBe(MENSAGEM_RETIRADA_ATUAL);
  });

  it("entrega: tudo menos a linha `Endereço:` é idêntico ao formato de hoje", () => {
    const link = montarLinkWhatsappPedido(
      pedidoCompleto({
        tipo_entrega: "entrega",
        taxa_entrega: 8,
        total: 29,
        endereco_entrega: ENDERECO_CLIENTE,
      } as unknown as Partial<PedidoComItens>),
      LOJA_SEM_ENDERECO,
    );
    expect(semLinhaEndereco(mensagemDe(link!.href))).toBe(
      MENSAGEM_ENTREGA_ATUAL_SEM_LINHA_ENDERECO,
    );
  });

  it("acrescentar o endereço da loja não muda nenhuma outra linha da retirada", () => {
    const semEndereco = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), LOJA_SEM_ENDERECO)!.href,
    ).split("\n");
    const comEndereco = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), LOJA_COM_ENDERECO)!.href,
    ).split("\n");
    // Única diferença permitida: a linha nova `Retirar em: ...`.
    expect(comEndereco.filter((l) => !l.startsWith("Retirar em: "))).toEqual(
      semEndereco,
    );
  });
});

describe("[197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja", () => {
  it("loja COM endereço → linha `Retirar em: rua, numero · bairro`", () => {
    const link = montarLinkWhatsappPedido(pedidoCompleto(), LOJA_COM_ENDERECO);
    const linhas = mensagemDe(link!.href).split("\n");
    expect(linhas).toContain("Retirar em: Rua da Padaria, 45 · Vila Nova");
  });

  it("a linha vem logo DEPOIS de `Entrega: Retirada no local` (RN-R7)", () => {
    const linhas = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), LOJA_COM_ENDERECO)!.href,
    ).split("\n");
    const i = linhas.indexOf("Entrega: Retirada no local");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(linhas[i + 1]).toBe("Retirar em: Rua da Padaria, 45 · Vila Nova");
  });

  it("o endereço da loja sai no formato CURTO — sem cidade, estado nem CEP (RN-R1)", () => {
    const mensagem = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), LOJA_COM_ENDERECO)!.href,
    );
    const linha = mensagem
      .split("\n")
      .find((l) => l.startsWith("Retirar em: "));
    expect(linha).toBeDefined();
    expect(linha!).not.toContain("Campinas");
    expect(linha!).not.toContain("SP");
    expect(linha!).not.toContain("13010-000");
    expect(linha!).not.toContain("CEP");
  });

  it("loja SEM endereço → NENHUMA linha `Retirar em:` (RN-R5: nunca '—', nunca linha vazia)", () => {
    const mensagem = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), LOJA_SEM_ENDERECO)!.href,
    );
    expect(mensagem).not.toContain("Retirar em:");
    expect(mensagem).not.toContain("Retirar em");
    expect(mensagem.split("\n").filter((l) => l.trim() === "—")).toEqual([]);
  });

  it("loja com endereço só de espaços → NENHUMA linha `Retirar em:`", () => {
    const lojaEspacos = {
      ...LOJA_COM_ENDERECO,
      endereco_rua: "   ",
      endereco_numero: "",
      endereco_bairro: "  ",
    };
    const mensagem = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), lojaEspacos)!.href,
    );
    expect(mensagem).not.toContain("Retirar em:");
  });

  it("em ENTREGA nunca aparece `Retirar em:`, mesmo com a loja tendo endereço (RN-R3)", () => {
    const mensagem = mensagemDe(
      montarLinkWhatsappPedido(
        pedidoCompleto({
          tipo_entrega: "entrega",
          taxa_entrega: 8,
          total: 29,
          endereco_entrega: ENDERECO_CLIENTE,
        } as unknown as Partial<PedidoComItens>),
        LOJA_COM_ENDERECO,
      )!.href,
    );
    expect(mensagem).not.toContain("Retirar em:");
    expect(mensagem).not.toContain("Rua da Padaria");
  });

  it("[auditoria 197] quebra de linha no bairro não forja linha de sistema (anti-injeção)", () => {
    // Sem colapsar whitespace, um lojista poderia gravar
    // endereco_bairro = "Centro\nTotal: R$ 0,01\nPagamento: JA PAGO via Pix"
    // e ver essas linhas forjadas aparecerem no corpo da mensagem, como se
    // fossem geradas pelo sistema.
    const lojaMaliciosa = {
      ...LOJA_COM_ENDERECO,
      endereco_bairro: "Centro\nTotal: R$ 0,01\nPagamento: JA PAGO via Pix",
    };
    const linhas = mensagemDe(
      montarLinkWhatsappPedido(pedidoCompleto(), lojaMaliciosa)!.href,
    ).split("\n");

    const linhaRetirarEm = linhas.find((l) => l.startsWith("Retirar em: "));
    expect(linhaRetirarEm).toBe(
      "Retirar em: Rua da Padaria, 45 · Centro Total: R$ 0,01 Pagamento: JA PAGO via Pix",
    );

    // Nenhuma linha forjada: só a linha `Total:` e a linha `Pagamento:`
    // autênticas do pedido podem começar com esses rótulos.
    const linhasTotal = linhas.filter((l) => l.startsWith("Total:"));
    const linhasPagamento = linhas.filter((l) => l.startsWith("Pagamento:"));
    expect(linhasTotal).toHaveLength(1);
    expect(linhasPagamento).toHaveLength(1);
    expect(linhasTotal[0]).not.toContain("0,01");
    expect(linhasPagamento[0]).not.toContain("JA PAGO");
  });
});

describe("[197] RN-R7 entrega — endereço do cliente encurta (sem cidade/estado/CEP)", () => {
  function mensagemEntrega(endereco: unknown = ENDERECO_CLIENTE): string {
    return mensagemDe(
      montarLinkWhatsappPedido(
        pedidoCompleto({
          tipo_entrega: "entrega",
          taxa_entrega: 8,
          total: 29,
          endereco_entrega: endereco,
        } as unknown as Partial<PedidoComItens>),
        LOJA_SEM_ENDERECO,
      )!.href,
    );
  }

  it("linha `Endereço:` no formato curto `rua, numero · bairro`", () => {
    expect(mensagemEntrega().split("\n")).toContain(
      "Endereço: Rua das Flores, 100 · Centro",
    );
  });

  it("a linha `Endereço:` não traz cidade, estado nem CEP (pedido literal, item 2)", () => {
    const linha = mensagemEntrega()
      .split("\n")
      .find((l) => l.startsWith("Endereço: "))!;
    expect(linha).not.toContain("Campinas");
    expect(linha).not.toContain("SP");
    expect(linha).not.toContain("13010-000");
    expect(linha).not.toContain("CEP");
  });

  it("endereço parcial (sem bairro) → sem separador '·' órfão", () => {
    expect(mensagemEntrega({ rua: "Rua das Flores", numero: "100" })
      .split("\n")).toContain("Endereço: Rua das Flores, 100");
  });
});
