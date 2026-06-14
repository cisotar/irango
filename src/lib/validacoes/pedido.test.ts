import { describe, it, expect } from "vitest";
// RED: a fase GREEN (executar) implementa o schema real em ./pedido.
// Aqui validamos o CONTRATO de entrada do payload de criação de pedido.
import { schemaPayloadPedido } from "./pedido";

// ---------------------------------------------------------------------------
// O schema é a FRONTEIRA que impede o cliente de enviar valores monetários
// autoritativos (seguranca.md §10). O cliente manda só produto_id + quantidade;
// preço/subtotal/desconto/taxa/total são recalculados no servidor a partir do
// banco. Esta issue (022) valida APENAS o formato de entrada — recálculo é 014.
// ---------------------------------------------------------------------------

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

// Builder do payload no caminho feliz — cada teste sobrescreve o que precisa.
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loja_id: UUID,
    itens: [{ produto_id: UUID2, quantidade: 2 }],
    endereco_entrega: {
      cep: "01001-000",
      rua: "Rua das Flores",
      numero: "123",
      bairro: "Centro",
    },
    forma_pagamento: "pix",
    nome_cliente: "Maria Silva",
    ...over,
  };
}

describe("schemaPayloadPedido — caminho feliz", () => {
  it("aceita payload mínimo válido (campos obrigatórios)", () => {
    const r = schemaPayloadPedido.safeParse(payload());
    expect(r.success).toBe(true);
  });

  it("aceita campos opcionais (telefone, cupom, observacoes)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        telefone_cliente: "5511999998888",
        codigo_cupom: "BEMVINDO10",
        observacoes: "Sem cebola, por favor",
      }),
    );
    expect(r.success).toBe(true);
  });
});

// ===========================================================================
// CRÍTICO — seguranca.md §10: o cliente NÃO define quanto paga.
// O schema NÃO aceita valores monetários autoritativos do cliente.
// ===========================================================================
describe("schemaPayloadPedido — recusa valores monetários do cliente (§10)", () => {
  it.each(["preco", "subtotal", "desconto", "taxa_entrega", "total"])(
    "rejeita o campo monetário '%s' enviado pelo cliente",
    (campo) => {
      const r = schemaPayloadPedido.safeParse(payload({ [campo]: 0.01 }));
      expect(r.success).toBe(false);
    },
  );

  it("rejeita total: 0.01 (o ataque clássico do DevTools)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ total: 0.01 }));
    expect(r.success).toBe(false);
  });

  it("rejeita preço por item (snapshot é do banco, não do cliente)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: 1, preco: 0.01 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita campo desconhecido qualquer (schema é strict)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ campo_injetado: "x" }));
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — itens", () => {
  it("rejeita itens vazio (pedido precisa de pelo menos 1 item)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ itens: [] }));
    expect(r.success).toBe(false);
  });

  it("rejeita itens ausente", () => {
    const p = payload();
    delete p.itens;
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(false);
  });

  it("rejeita produto_id que não é uuid", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: "abc", quantidade: 1 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita quantidade = 0", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: 0 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita quantidade negativa", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: -3 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita quantidade não-inteira", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: 1.5 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita quantidade absurda (anti-abuso: limite máximo razoável)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: 100000 }] }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita quantidade no limite alto razoável (ex: 99)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: [{ produto_id: UUID2, quantidade: 99 }] }),
    );
    expect(r.success).toBe(true);
  });
});

describe("schemaPayloadPedido — loja_id", () => {
  it("rejeita loja_id que não é uuid", () => {
    const r = schemaPayloadPedido.safeParse(payload({ loja_id: "loja-1" }));
    expect(r.success).toBe(false);
  });

  it("rejeita loja_id ausente", () => {
    const p = payload();
    delete p.loja_id;
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — nome_cliente", () => {
  it("rejeita nome vazio", () => {
    const r = schemaPayloadPedido.safeParse(payload({ nome_cliente: "" }));
    expect(r.success).toBe(false);
  });

  it("rejeita nome só com espaços (trim antes de medir)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ nome_cliente: "   " }));
    expect(r.success).toBe(false);
  });

  it("faz trim do nome (espaços nas pontas são removidos)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ nome_cliente: "  Ana  " }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as { nome_cliente: string }).nome_cliente).toBe("Ana");
    }
  });

  it("rejeita nome absurdamente longo (anti-abuso)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ nome_cliente: "A".repeat(500) }),
    );
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — endereco_entrega", () => {
  it("rejeita endereço sem bairro", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        endereco_entrega: {
          cep: "01001-000",
          rua: "Rua das Flores",
          numero: "123",
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita endereço sem rua", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        endereco_entrega: { cep: "01001-000", numero: "123", bairro: "Centro" },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita endereço sem numero", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        endereco_entrega: {
          cep: "01001-000",
          rua: "Rua das Flores",
          bairro: "Centro",
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita CEP em formato inválido", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        endereco_entrega: {
          cep: "123",
          rua: "Rua das Flores",
          numero: "123",
          bairro: "Centro",
        },
      }),
    );
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — forma_pagamento", () => {
  it.each(["pix", "dinheiro", "link", "cartao"])(
    "aceita forma de pagamento válida '%s'",
    (forma) => {
      const r = schemaPayloadPedido.safeParse(payload({ forma_pagamento: forma }));
      expect(r.success).toBe(true);
    },
  );

  it("rejeita forma de pagamento fora do enum", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ forma_pagamento: "boleto" }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita forma de pagamento ausente", () => {
    const p = payload();
    delete p.forma_pagamento;
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — codigo_cupom", () => {
  it("aceita ausência de cupom (opcional)", () => {
    const r = schemaPayloadPedido.safeParse(payload());
    expect(r.success).toBe(true);
  });

  it("rejeita cupom com caracteres inválidos (formato)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ codigo_cupom: "drop table;" }),
    );
    expect(r.success).toBe(false);
  });
});
