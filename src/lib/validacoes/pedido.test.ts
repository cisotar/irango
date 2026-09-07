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

// ===========================================================================
// [063] idempotency_key — z.guid().optional()
// Borda 1: chave inválida (não-uuid) é rejeitada pelo schema ANTES de I/O.
// Borda 2: ausência da chave é aceita (opcional) — compatibilidade legada.
// Borda 3: presença de chave UUID válida não contamina outros campos (strict).
// ===========================================================================

describe("schemaPayloadPedido — [063] idempotency_key", () => {
  const UUID_IDEMP = "55555555-5555-4555-8555-555555555555";

  it("[063-S1] idempotency_key uuid válido → aceito (campo presente e correto)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ idempotency_key: UUID_IDEMP }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.idempotency_key).toBe(UUID_IDEMP);
    }
  });

  it("[063-S2] idempotency_key ausente → aceito (campo opcional — compatibilidade legada)", () => {
    // Payload sem idempotency_key deve seguir funcionando normalmente.
    const p = payload();
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) {
      // campo não existe no dado parseado (undefined, não presente)
      expect(r.data.idempotency_key).toBeUndefined();
    }
  });

  it("[063-S3] idempotency_key string não-uuid → rejeitado por z.guid() ANTES de I/O", () => {
    // Um cliente malicioso tenta enviar string arbitrária no lugar de uuid;
    // o schema rejeita antes de qualquer query ser feita.
    const r = schemaPayloadPedido.safeParse(payload({ idempotency_key: "nao-e-uuid" }));
    expect(r.success).toBe(false);
  });

  it("[063-S4] idempotency_key string vazia → rejeitado por z.guid()", () => {
    const r = schemaPayloadPedido.safeParse(payload({ idempotency_key: "" }));
    expect(r.success).toBe(false);
  });

  it("[063-S5] idempotency_key numérico → rejeitado (tipo errado, schema é strict)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ idempotency_key: 12345 }));
    expect(r.success).toBe(false);
  });

  it("[063-S6] idempotency_key presente não abre brechas para campos monetários (strict permanece)", () => {
    // Mesmo com idempotency_key válido, .strict() deve barrar total adulterado.
    const r = schemaPayloadPedido.safeParse(
      payload({ idempotency_key: UUID_IDEMP, total: 0.01 }),
    );
    expect(r.success).toBe(false);
  });
});

// ===========================================================================
// [167] Observação por item — o GATE AUTORITATIVO de tamanho é aqui.
//
// LIMITE_OBSERVACAO = 200 (src/lib/constants/pedido.ts, criado na fase GREEN).
// O literal 200 aparece NESTE arquivo de propósito: o teste declara o número
// esperado; a produção o importa da constante única.
//
// Contrato esperado (plan/167 §Decisão 2):
//   observacao: z.string()
//     .transform(normalizarObservacao)
//     .pipe(z.string().max(LIMITE_OBSERVACAO))
//     .optional()
// PROIBIDO .min(1) (texto só de espaços normaliza para "" e derrubaria o pedido
// INTEIRO). PROIBIDO afrouxar o .strict() do item.
// ===========================================================================

const NBSP = "\u00A0";
const ZWSP = "\u200B";
const RLO = "\u202E";

/** Item do carrinho com a observação sob teste. */
function itemComObs(observacao: unknown) {
  return [{ produto_id: UUID2, quantidade: 2, observacao }];
}

/** Extrai `itens[0]` do parse bem-sucedido (falha o teste se não passou). */
function item0(r: ReturnType<typeof schemaPayloadPedido.safeParse>) {
  expect(r.success).toBe(true);
  if (!r.success) throw new Error("parse falhou");
  return (r.data as unknown as { itens: Record<string, unknown>[] }).itens[0];
}

describe("[167] schemaItemPedido.observacao — tamanho (gate autoritativo, §10)", () => {
  it("aceita observação de exatamente 200 chars visíveis", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("a".repeat(200)) }),
    );
    expect(r.success).toBe(true);
  });

  it("REJEITA observação de 201 chars visíveis", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("a".repeat(201)) }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita 210 chars com 15 de padding nas bordas → output com 195", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs(" ".repeat(15) + "a".repeat(195)) }),
    );
    expect(item0(r).observacao).toBe("a".repeat(195));
  });

  it("aceita 500 controles + 100 visíveis (prova a ordem transform → max)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("\u001B".repeat(500) + "b".repeat(100)) }),
    );
    expect(item0(r).observacao).toBe("b".repeat(100));
  });

  it("REJEITA 201 chars visíveis mesmo com padding removível em volta", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("   " + "a".repeat(201) + "   ") }),
    );
    expect(r.success).toBe(false);
  });

  it("FRONTEIRA: 201 chars ANTES de normalizar (1 espaço de borda + 200 visíveis) → 200 DEPOIS → ACEITO", () => {
    const entrada = " " + "a".repeat(200);
    expect(entrada).toHaveLength(201);
    const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(entrada) }));
    expect(item0(r).observacao).toBe("a".repeat(200));
  });

  it("FRONTEIRA: 202 chars ANTES de normalizar (1 espaço de borda + 201 visíveis) → 201 DEPOIS → REJEITADO", () => {
    const entrada = " " + "a".repeat(201);
    expect(entrada).toHaveLength(202);
    const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(entrada) }));
    expect(r.success).toBe(false);
  });

  // [167] surrogate pairs / emoji: .length (JS, UTF-16) vs. char_length do
  // Postgres (codepoints). Para caracteres fora do BMP, 1 codepoint = 2
  // unidades UTF-16 → o gate do zod (usa .length) é MAIS restritivo que o
  // CHECK do banco (20260907120000_itens_pedido_observacao.sql:51,
  // `char_length(observacao) <= 200`), nunca menos. Não existe payload aceito
  // pelo zod que viole o CHECK por causa de emoji — a divergência, quando
  // existe, só rejeita de mais (perda de UX), nunca abre brecha de tamanho.
  it("200 emoji fora do BMP (.length=400) → REJEITADO pelo zod mesmo tendo só 100 codepoints (bem abaixo do CHECK de 200 do banco)", () => {
    const EMOJI = "\u{1F600}";
    const entrada = EMOJI.repeat(200);
    expect(entrada).toHaveLength(400);
    expect(Array.from(entrada).length).toBe(200);
    const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(entrada) }));
    expect(r.success).toBe(false);
  });

  it("100 emoji fora do BMP (.length=200, no limite do zod) tem só 100 codepoints — aceito no zod E dentro do CHECK do banco", () => {
    const EMOJI = "\u{1F600}";
    const entrada = EMOJI.repeat(100);
    expect(entrada).toHaveLength(200);
    expect(Array.from(entrada).length).toBe(100);
    const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(entrada) }));
    expect(r.success).toBe(true);
  });
});

describe("[167] schemaItemPedido.observacao — opcionalidade e vazio (SEM .min(1))", () => {
  it("aceita item SEM o campo e o output NÃO tem a chave observacao", () => {
    const r = schemaPayloadPedido.safeParse(payload());
    expect(item0(r)).not.toHaveProperty("observacao");
  });

  it.each([
    ["string vazia", ""],
    ["só espaços", "   "],
    ["whitespace misto", "\n\t "],
    ["só NBSP", NBSP.repeat(200)],
    ["só invisíveis", ZWSP.repeat(50)],
  ])(
    'aceita observação %s e normaliza para "" (NÃO derruba o pedido inteiro)',
    (_rotulo, entrada) => {
      const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(entrada) }));
      expect(item0(r).observacao).toBe("");
    },
  );
});

describe("[167] schemaItemPedido.observacao — normalização", () => {
  it("preserva \\n no meio (é textarea — sem regex de linha única)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("sem cebola\ntrocar batata por salada") }),
    );
    expect(item0(r).observacao).toBe("sem cebola\ntrocar batata por salada");
  });

  it("converte \\r\\n em \\n", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("linha1\r\nlinha2") }),
    );
    expect(item0(r).observacao).toBe("linha1\nlinha2");
  });

  it("colapsa 50 quebras seguidas em 2", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs(`a${"\n".repeat(50)}b`) }),
    );
    expect(item0(r).observacao).toBe("a\n\nb");
  });

  it("colapsa run de NBSP (o btrim do Postgres não faria isso)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs(`sem${NBSP}${NBSP}${NBSP}cebola`) }),
    );
    expect(item0(r).observacao).toBe("sem cebola");
  });

  it("remove bidi override e zero-width do output (anti-spoofing de comanda)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs(`sem${RLO}${ZWSP} cebola`) }),
    );
    expect(item0(r).observacao).toBe("sem cebola");
  });

  it("troca tab por espaço", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ itens: itemComObs("bem\tpassado") }),
    );
    expect(item0(r).observacao).toBe("bem passado");
  });
});

describe("[167] schemaItemPedido.observacao — tipos inválidos", () => {
  // Estes 5 casos passavam ANTES do GREEN pelo motivo ERRADO: com `observacao`
  // não declarada no schema, o `.strict()` rejeitava o payload por CAMPO
  // DESCONHECIDO — não por tipo inválido. Agora que o campo existe, a rejeição
  // precisa vir do `z.string()` de `schemaObservacao` (invalid_type), no path
  // exato `itens[0].observacao`. Sem essa asserção de path/code, um `.strict()`
  // afrouxado em outro lugar do item continuaria fazendo este teste passar.
  it.each([
    ["número", 123],
    ["null", null],
    ["objeto", {}],
    ["array", ["a"]],
    ["booleano", true],
  ])("rejeita observacao do tipo %s pelo motivo certo (invalid_type em itens[0].observacao)", (_rotulo, valor) => {
    const r = schemaPayloadPedido.safeParse(payload({ itens: itemComObs(valor) }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const erro = r.error.issues.find(
      (i) => i.path.join(".") === "itens.0.observacao",
    );
    expect(erro).toBeDefined();
    expect(erro?.code).toBe("invalid_type");
    // anti-regressão: NENHUM issue deveria reclamar de chave desconhecida —
    // isso indicaria que voltamos ao comportamento "campo não declarado".
    expect(r.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(false);
  });
});

describe("[167] ANTI-REGRESSÃO do .strict() do item (trava anti-injeção monetária)", () => {
  // Estes 7 casos (6 do it.each + 1 abaixo) passavam ANTES do GREEN pelo
  // motivo ERRADO: `observacao` não declarada fazia o `.strict()` rejeitar o
  // payload por causa DELA, não do campo monetário/desconhecido sob teste —
  // o teste "passava" mesmo que o `.strict()` do campo alvo estivesse quebrado.
  // Agora que `observacao` é um campo legítimo, a rejeição só prova o que o
  // nome do teste promete se o issue do zod apontar para o campo INJETADO
  // (`unrecognized_keys` com esse nome no path do item) — não para `observacao`.
  it.each(["preco", "total", "subtotal", "desconto", "taxa_entrega", "observacoes"])(
    "declarar 'observacao' NÃO afrouxa o item: campo desconhecido '%s' continua rejeitado pelo motivo certo",
    (campo) => {
      const r = schemaPayloadPedido.safeParse(
        payload({
          itens: [{ produto_id: UUID2, quantidade: 2, observacao: "ok", [campo]: 0.01 }],
        }),
      );
      expect(r.success).toBe(false);
      if (r.success) return;
      const erro = r.error.issues.find((i) => i.path.join(".") === "itens.0");
      expect(erro).toBeDefined();
      expect(erro?.code).toBe("unrecognized_keys");
      // zod 4 lista as chaves não reconhecidas no issue — `observacao` NÃO
      // pode estar entre elas (ela está declarada e válida: "ok").
      expect((erro as { keys?: string[] } | undefined)?.keys).toContain(campo);
      expect((erro as { keys?: string[] } | undefined)?.keys).not.toContain("observacao");
    },
  );

  it("item com observacao válida + campo desconhecido arbitrário → rejeitado pelo campo arbitrário, não por observacao", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({
        itens: [{ produto_id: UUID2, quantidade: 2, observacao: "ok", xpto: "x" }],
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const erro = r.error.issues.find((i) => i.path.join(".") === "itens.0");
    expect(erro?.code).toBe("unrecognized_keys");
    expect((erro as { keys?: string[] } | undefined)?.keys).toContain("xpto");
    expect((erro as { keys?: string[] } | undefined)?.keys).not.toContain("observacao");
  });
});

describe("[167] schemaPayloadPedido.observacoes — teto cai de 500 para 200", () => {
  it("aceita observacoes de exatamente 200 chars", () => {
    const r = schemaPayloadPedido.safeParse(payload({ observacoes: "a".repeat(200) }));
    expect(r.success).toBe(true);
  });

  it("REJEITA observacoes de 201 chars (hoje o teto ainda é 500)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ observacoes: "a".repeat(201) }));
    expect(r.success).toBe(false);
  });

  it("REJEITA observacoes de 500 chars (hoje passa — é o RED)", () => {
    const r = schemaPayloadPedido.safeParse(payload({ observacoes: "a".repeat(500) }));
    expect(r.success).toBe(false);
  });

  it('observacoes só com espaços normaliza para "" (não rejeita)', () => {
    const r = schemaPayloadPedido.safeParse(payload({ observacoes: "   " }));
    expect(r.success).toBe(true);
    if (!r.success) throw new Error("parse falhou");
    expect((r.data as unknown as { observacoes?: string }).observacoes).toBe("");
  });

  it("observacoes recebe a MESMA normalização do item (paridade de contrato)", () => {
    const r = schemaPayloadPedido.safeParse(
      payload({ observacoes: `  linha1\r\n\r\n\r\nlinha2${NBSP}${NBSP}fim  ` }),
    );
    expect(r.success).toBe(true);
    if (!r.success) throw new Error("parse falhou");
    expect((r.data as unknown as { observacoes?: string }).observacoes).toBe(
      "linha1\n\nlinha2 fim",
    );
  });
});
