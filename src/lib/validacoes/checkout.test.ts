import { describe, it, expect } from "vitest";

import { schemaCheckout } from "./checkout"; // import que vai falhar RED

describe("schemaCheckout — invariante anti-fraude monetária", () => {
  const LOJA_ID = "11111111-1111-1111-1111-111111111111";
  const PRODUTO_ID = "22222222-2222-2222-2222-222222222222";
  const FORMA_PAGAMENTO_ID = "33333333-3333-3333-3333-333333333333";

  const payloadOk = {
    loja_id: LOJA_ID,
    itens: [{ produto_id: PRODUTO_ID, quantidade: 2 }],
    endereco: {
      cep: "01310-100",
      rua: "Av Paulista",
      numero: "1000",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    },
    forma_pagamento_id: FORMA_PAGAMENTO_ID,
    nome: "João Silva",
    telefone: "11999999999",
  };

  it("aceita payload válido sem campos monetários", () => {
    expect(schemaCheckout.safeParse(payloadOk).success).toBe(true);
  });

  it("ATAQUE: total injetado → .strict() rejeita OU campo ignorado", () => {
    const r = schemaCheckout.safeParse({ ...payloadOk, total: 0.01 });
    // .strict() rejeita campos extras → success=false
    // OU se não usar .strict(), o campo extra deve ser stripped (não presente em r.data)
    if (r.success) {
      expect((r.data as Record<string, unknown>).total).toBeUndefined();
    } else {
      expect(r.success).toBe(false);
    }
  });

  it("ATAQUE: subtotal injetado → não presente no output", () => {
    const r = schemaCheckout.safeParse({ ...payloadOk, subtotal: 999 });
    if (r.success) {
      expect((r.data as Record<string, unknown>).subtotal).toBeUndefined();
    } else {
      expect(r.success).toBe(false);
    }
  });

  it("ATAQUE: frete injetado → não presente no output", () => {
    const r = schemaCheckout.safeParse({ ...payloadOk, frete: 5 });
    if (r.success) {
      expect((r.data as Record<string, unknown>).frete).toBeUndefined();
    } else {
      expect(r.success).toBe(false);
    }
  });

  it("itens sem quantidade → inválido", () => {
    const r = schemaCheckout.safeParse({
      ...payloadOk,
      itens: [{ produto_id: PRODUTO_ID }],
    });
    expect(r.success).toBe(false);
  });

  it("itens com quantidade 0 → inválido", () => {
    const r = schemaCheckout.safeParse({
      ...payloadOk,
      itens: [{ produto_id: PRODUTO_ID, quantidade: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("itens vazio → inválido", () => {
    const r = schemaCheckout.safeParse({ ...payloadOk, itens: [] });
    expect(r.success).toBe(false);
  });
});
