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
// [069] tipo_entrega='entrega' é o default; endereco_entrega obrigatório para entrega.
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loja_id: UUID,
    tipo_entrega: "entrega",
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

  it("normaliza cupom p/ maiúsculas (paridade preview↔real — achado auditoria)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ codigo_cupom: "promo10" }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.codigo_cupom).toBe("PROMO10");
  });
});

// ===========================================================================
// [069] tipo_entrega, endereço condicional e troco_para
// TDD RED — testes escritos antes da implementação (issue 069, crítica).
// A fase GREEN estende schemaPayloadPedido com tipo_entrega + refine condicional.
// ===========================================================================

// Builder adaptado para os novos cenários — inclui tipo_entrega e respeita
// o refine condicional (tipo_entrega='entrega' exige endereco_entrega).
function payloadEntrega(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loja_id: UUID,
    tipo_entrega: "entrega",
    itens: [{ produto_id: UUID2, quantidade: 2 }],
    endereco_entrega: {
      cep: "01001-000",
      rua: "Rua das Flores",
      numero: "123",
      bairro: "Centro",
      cidade: "São Paulo",
      uf: "SP",
    },
    forma_pagamento: "pix",
    nome_cliente: "Maria Silva",
    ...over,
  };
}

function payloadRetirada(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loja_id: UUID,
    tipo_entrega: "retirada",
    itens: [{ produto_id: UUID2, quantidade: 2 }],
    forma_pagamento: "pix",
    nome_cliente: "Maria Silva",
    ...over,
  };
}

describe("schemaPayloadPedido — [069] tipo_entrega (campo obrigatório)", () => {
  it("aceita tipo_entrega='entrega' com endereco_entrega presente", () => {
    const r = schemaPayloadPedido.safeParse(payloadEntrega());
    expect(r.success).toBe(true);
  });

  it("aceita tipo_entrega='retirada' sem endereco_entrega (endereço é opcional para retirada)", () => {
    const r = schemaPayloadPedido.safeParse(payloadRetirada());
    expect(r.success).toBe(true);
  });

  it("rejeita tipo_entrega ausente — campo obrigatório", () => {
    const p = payloadEntrega();
    delete p.tipo_entrega;
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(false);
  });

  it("rejeita tipo_entrega com valor inválido fora do enum", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ tipo_entrega: "drive-thru" }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita tipo_entrega vazio", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ tipo_entrega: "" }),
    );
    expect(r.success).toBe(false);
  });
});

describe("schemaPayloadPedido — [069] endereço condicional (refine)", () => {
  it("rejeita tipo_entrega='entrega' SEM endereco_entrega (refine condicional)", () => {
    const p = payloadEntrega();
    delete p.endereco_entrega;
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(false);
    if (!r.success) {
      const temErroEndereco = r.error.issues.some(
        (i) => i.path.includes("endereco_entrega"),
      );
      expect(temErroEndereco).toBe(true);
    }
  });

  it("aceita tipo_entrega='retirada' mesmo com endereco_entrega undefined (não exigido)", () => {
    const r = schemaPayloadPedido.safeParse(payloadRetirada());
    expect(r.success).toBe(true);
  });

  it("aceita endereco_entrega com campo uf (novo campo do spec)", () => {
    const r = schemaPayloadPedido.safeParse(payloadEntrega());
    expect(r.success).toBe(true);
  });

  it("aceita endereco_entrega com campo cidade (opcional no schema existente, presença válida)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        endereco_entrega: {
          cep: "01001-000",
          rua: "Av. Paulista",
          numero: "1000",
          bairro: "Bela Vista",
          cidade: "São Paulo",
          uf: "SP",
        },
      }),
    );
    expect(r.success).toBe(true);
  });
});

describe("schemaPayloadPedido — [069] troco_para", () => {
  it("aceita ausência de troco_para (opcional)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ forma_pagamento: "dinheiro" }),
    );
    expect(r.success).toBe(true);
  });

  it("aceita troco_para positivo com dinheiro", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ forma_pagamento: "dinheiro", troco_para: 50 }),
    );
    expect(r.success).toBe(true);
  });

  it("rejeita troco_para negativo (deve ser positivo)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ forma_pagamento: "dinheiro", troco_para: -10 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita troco_para = 0 (deve ser positivo, não zero)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ forma_pagamento: "dinheiro", troco_para: 0 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita injeção de campo monetário total mesmo com troco_para presente (strict)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({ forma_pagamento: "dinheiro", troco_para: 50, total: 9.99 }),
    );
    expect(r.success).toBe(false);
  });
});

// ===========================================================================
// [083] opcionais por item — RN-O2: cliente envia apenas opcional_id+quantidade,
// nunca preco/nome. .strict() no objeto opcional bloqueia injeção de valores.
// TDD RED — testes escritos antes da implementação (issue 083, crítica).
// ===========================================================================

const UUID3 = "33333333-3333-4333-8333-333333333333";

describe("schemaItemPedido — [083] opcionais", () => {
  it("aceita item com opcionais válidos (opcional_id uuid + quantidade positiva)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [
          {
            produto_id: UUID2,
            quantidade: 1,
            opcionais: [{ opcional_id: UUID3, quantidade: 2 }],
          },
        ],
      }),
    );
    expect(r.success).toBe(true);
  });

  it("rejeita opcional com campo 'preco' extra (.strict — RN-O2)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [
          {
            produto_id: UUID2,
            quantidade: 1,
            opcionais: [{ opcional_id: UUID3, quantidade: 1, preco: 5 }],
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita opcional com quantidade = 0 (.positive())", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [
          {
            produto_id: UUID2,
            quantidade: 1,
            opcionais: [{ opcional_id: UUID3, quantidade: 0 }],
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita opcional com quantidade > 99 (teto anti-overflow — achado auditoria)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [
          {
            produto_id: UUID2,
            quantidade: 1,
            opcionais: [{ opcional_id: UUID3, quantidade: 999999 }],
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita item SEM opcionais (compatibilidade checkout — campo opcional)", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [{ produto_id: UUID2, quantidade: 2 }],
      }),
    );
    expect(r.success).toBe(true);
  });

  it("rejeita opcional_id que não é uuid", () => {
    const r = schemaPayloadPedido.safeParse(
      payloadEntrega({
        itens: [
          {
            produto_id: UUID2,
            quantidade: 1,
            opcionais: [{ opcional_id: "nao-e-uuid", quantidade: 1 }],
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
  });
});
