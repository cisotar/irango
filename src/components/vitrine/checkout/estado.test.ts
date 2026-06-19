// RED (TDD red-first) — issue 006. Funções puras `podeConfirmar` e
// `montarPayloadPedido` ainda NÃO existem em estado.ts. Estes testes provam:
//
//  1. O gate `podeConfirmar` só libera o submit com endereço (se entrega) +
//     forma de pagamento + frete resolvido — a decisão da issue 001.
//  2. O payload montado para o submit NUNCA carrega valor monetário
//     (subtotal/desconto/taxa_entrega/total/preco/valor) — seguranca.md §10,
//     spec §171. É a garantia client-side contra "passar o total como prop".
//
// environment: node (vitest.config.ts) — sem jsdom; testamos as funções puras
// direto, sem simular clique/DOM. As funções vivem em estado.ts (módulo neutro,
// sem 'use client'/'use server'), por isso são importáveis no teste.

import { describe, it, expect } from "vitest";

import {
  podeConfirmar,
  montarPayloadPedido,
  chaveFrete,
  ESTADO_INICIAL,
  type EstadoWizard,
} from "./estado";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";

const ENDERECO_VALIDO: EnderecoEntrega = {
  cep: "01310-100",
  rua: "Av. Paulista",
  numero: "1000",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
};

/** Estado base de cliente identificado — cada teste sobrescreve o relevante. */
function estado(patch: Partial<EstadoWizard>): EstadoWizard {
  return {
    ...ESTADO_INICIAL,
    nome: "Maria",
    ...patch,
  };
}

const PRODUTO_ID = "11111111-1111-4111-8111-111111111111";
const OPCIONAL_ID = "22222222-2222-4222-8222-222222222222";

const ITENS_BASE = [{ produtoId: PRODUTO_ID, quantidade: 2 }];

const LOJA_ID = "33333333-3333-4333-8333-333333333333";

// ────────────────────────────────────────────────────────────────────────────
//  chaveFrete — gate do efeito de frete (issue 002): só calcula quando o
//  endereço que o cliente VÊ está completo; nunca contra bairro fantasma.
//  Retorna a chave de dedupe `cep|bairro` ou null (não calcular).
// ────────────────────────────────────────────────────────────────────────────
describe("chaveFrete (issue 002)", () => {
  it("retirada (ehEntrega=false) → null mesmo com endereço", () => {
    expect(chaveFrete(false, ENDERECO_VALIDO)).toBeNull();
  });

  it("entrega + endereço null → null (sem cálculo, sem mensagem)", () => {
    expect(chaveFrete(true, null)).toBeNull();
  });

  it("entrega + endereço completo → chave `cep|bairro`", () => {
    expect(chaveFrete(true, ENDERECO_VALIDO)).toBe("01310-100|Bela Vista");
  });

  it("entrega + endereço sem bairro (incompleto) → null", () => {
    expect(
      chaveFrete(true, { ...ENDERECO_VALIDO, bairro: "   " }),
    ).toBeNull();
  });

  it("mesmo endereço → mesma chave (dedupe estável)", () => {
    expect(chaveFrete(true, ENDERECO_VALIDO)).toBe(
      chaveFrete(true, { ...ENDERECO_VALIDO }),
    );
  });

  it("CEP diferente, mesmo bairro → chaves diferentes (recalcula p/ paridade de cobrança)", () => {
    const a = chaveFrete(true, ENDERECO_VALIDO);
    const b = chaveFrete(true, { ...ENDERECO_VALIDO, cep: "01310-200" });
    expect(a).not.toBe(b);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  podeConfirmar — tabela-verdade (issue 001: enderecoValido && pagamentoValido)
// ────────────────────────────────────────────────────────────────────────────

describe("podeConfirmar", () => {
  it("retirada + forma de pagamento selecionada → true", () => {
    const e = estado({ tipoEntrega: "retirada", formaPagamento: "pix" });
    expect(podeConfirmar(e, "retirada", "ocioso")).toBe(true);
  });

  it("retirada + sem forma de pagamento → false", () => {
    const e = estado({ tipoEntrega: "retirada", formaPagamento: null });
    expect(podeConfirmar(e, "retirada", "ocioso")).toBe(false);
  });

  it("entrega + endereço null (frete ok) → false", () => {
    const e = estado({
      tipoEntrega: "entrega",
      endereco: null,
      formaPagamento: "pix",
    });
    expect(podeConfirmar(e, "entrega", "ok")).toBe(false);
  });

  it('entrega + endereço preenchido + frete "calculando" → false', () => {
    const e = estado({
      tipoEntrega: "entrega",
      endereco: ENDERECO_VALIDO,
      formaPagamento: "pix",
    });
    expect(podeConfirmar(e, "entrega", "calculando")).toBe(false);
  });

  it('entrega + endereço preenchido + frete "ok" + pagamento → true', () => {
    const e = estado({
      tipoEntrega: "entrega",
      endereco: ENDERECO_VALIDO,
      formaPagamento: "dinheiro",
    });
    expect(podeConfirmar(e, "entrega", "ok")).toBe(true);
  });

  it('entrega + frete "indisponivel" → false', () => {
    const e = estado({
      tipoEntrega: "entrega",
      endereco: ENDERECO_VALIDO,
      formaPagamento: "pix",
    });
    expect(podeConfirmar(e, "entrega", "indisponivel")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  montarPayloadPedido — payload de submit livre de valor monetário (§10/§171)
// ────────────────────────────────────────────────────────────────────────────

const CAMPOS_MONETARIOS_PROIBIDOS = [
  "subtotal",
  "desconto",
  "taxa_entrega",
  "total",
  "preco",
  "valor",
];

describe("montarPayloadPedido", () => {
  it("nunca contém campos monetários na raiz nem nos itens", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: [
        {
          produtoId: PRODUTO_ID,
          quantidade: 2,
          opcionais: [{ opcionalId: OPCIONAL_ID, quantidade: 1 }],
        },
      ],
      estado: estado({
        tipoEntrega: "entrega",
        endereco: ENDERECO_VALIDO,
        formaPagamento: "pix",
        codigoCupom: "PROMO10",
      }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    // raiz
    const chavesRaiz = Object.keys(payload as Record<string, unknown>);
    for (const proibido of CAMPOS_MONETARIOS_PROIBIDOS) {
      expect(chavesRaiz).not.toContain(proibido);
    }
    // itens
    for (const item of (payload as { itens: Record<string, unknown>[] }).itens) {
      for (const proibido of CAMPOS_MONETARIOS_PROIBIDOS) {
        expect(Object.keys(item)).not.toContain(proibido);
      }
      // opcionais
      const opcionais = (item.opcionais ?? []) as Record<string, unknown>[];
      for (const opc of opcionais) {
        expect(Object.keys(opc)).not.toContain("preco");
        expect(Object.keys(opc)).not.toContain("valor");
      }
    }
  });

  it("contém loja_id, tipo_entrega e itens com produto_id + quantidade", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: ITENS_BASE,
      estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as {
      loja_id: string;
      tipo_entrega: string;
      itens: { produto_id: string; quantidade: number }[];
    };

    expect(payload.loja_id).toBe(LOJA_ID);
    expect(payload.tipo_entrega).toBe("retirada");
    expect(payload.itens).toEqual([
      { produto_id: PRODUTO_ID, quantidade: 2 },
    ]);
  });

  it("item com opcionais → opcional_id + quantidade (nunca preco)", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: [
        {
          produtoId: PRODUTO_ID,
          quantidade: 1,
          opcionais: [{ opcionalId: OPCIONAL_ID, quantidade: 3 }],
        },
      ],
      estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as { itens: { opcionais?: Record<string, unknown>[] }[] };

    expect(payload.itens[0].opcionais).toEqual([
      { opcional_id: OPCIONAL_ID, quantidade: 3 },
    ]);
  });

  it("entrega → endereco_entrega presente; retirada → ausente", () => {
    const entrega = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: ITENS_BASE,
      estado: estado({
        tipoEntrega: "entrega",
        endereco: ENDERECO_VALIDO,
        formaPagamento: "pix",
      }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as Record<string, unknown>;
    expect(entrega).toHaveProperty("endereco_entrega");

    const retirada = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: ITENS_BASE,
      estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as Record<string, unknown>;
    expect(retirada).not.toHaveProperty("endereco_entrega");
  });

  it("cupom presente → codigo_cupom presente; sem cupom → ausente", () => {
    const comCupom = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: ITENS_BASE,
      estado: estado({
        tipoEntrega: "retirada",
        formaPagamento: "pix",
        codigoCupom: "PROMO10",
      }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as Record<string, unknown>;
    expect(comCupom).toHaveProperty("codigo_cupom");

    const semCupom = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: ITENS_BASE,
      estado: estado({
        tipoEntrega: "retirada",
        formaPagamento: "pix",
        codigoCupom: null,
      }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }) as Record<string, unknown>;
    expect(semCupom).not.toHaveProperty("codigo_cupom");
  });

  it("payload montado passa schemaPayloadPedido.safeParse (fronteira .strict())", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: [
        {
          produtoId: PRODUTO_ID,
          quantidade: 2,
          opcionais: [{ opcionalId: OPCIONAL_ID, quantidade: 1 }],
        },
      ],
      estado: estado({
        tipoEntrega: "entrega",
        endereco: ENDERECO_VALIDO,
        formaPagamento: "pix",
        codigoCupom: "PROMO10",
      }),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    const parsed = schemaPayloadPedido.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
