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
  itemCarrinhoParaPayload,
  type EstadoWizard,
} from "./estado";
import { readFileSync } from "node:fs";

import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import { canonizarObservacao } from "@/lib/utils/normalizarObservacao";
import { LIMITE_OBSERVACAO } from "@/lib/constants/pedido";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import type { ItemCarrinho } from "@/types/dominio";

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

// ═══════════════════════════════════════════════════════════════════════════
// RED (issue 168) — a observação por item precisa ATRAVESSAR a fronteira:
// ItemCarrinho → ItemPayload (CheckoutWizard) → payload (montarPayloadPedido)
// → schemaPayloadPedido (gate autoritativo do servidor, issue 167).
// Nada aqui pode introduzir campo monetário.
// ═══════════════════════════════════════════════════════════════════════════


const IDEMPOTENCY = "44444444-4444-4444-8444-444444444444";

function payloadCom(itens: Parameters<typeof montarPayloadPedido>[0]["itens"]) {
  return montarPayloadPedido({
    lojaId: LOJA_ID,
    itens,
    estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
    idempotencyKey: IDEMPOTENCY,
  }) as unknown as { itens: Record<string, unknown>[] };
}

describe("montarPayloadPedido — observacao por item (issue 168)", () => {
  // [18]
  it("[18] item com observação → itens[].observacao presente com o texto", () => {
    const p = payloadCom([
      { produtoId: PRODUTO_ID, quantidade: 1, observacao: "sem cebola" },
    ]);
    expect(p.itens[0].observacao).toBe("sem cebola");
  });

  // [18b] Duas linhas do MESMO produto com observações diferentes chegam como
  // dois itens distintos, cada um com SUA quantidade — é a contrapartida no
  // payload da dedup do carrinho. Fusão aqui = cliente paga menos do que pediu.
  it("[18b] duas linhas do mesmo produto → 2 itens, cada um com sua quantidade e observação", () => {
    const p = payloadCom([
      { produtoId: PRODUTO_ID, quantidade: 1, observacao: "sem cebola" },
      { produtoId: PRODUTO_ID, quantidade: 3, observacao: "sem tomate" },
    ]);
    expect(p.itens).toHaveLength(2);
    expect(p.itens.map((i) => i.quantidade)).toEqual([1, 3]);
    expect(p.itens.map((i) => i.observacao)).toEqual(["sem cebola", "sem tomate"]);
  });

  // [19] Ausente, não `undefined`: o schema é .strict() e o padrão do arquivo
  // (opcionais/telefone/cupom) é omitir a chave.
  it("[19] item sem observação → a chave `observacao` NÃO existe no objeto", () => {
    const p = payloadCom([{ produtoId: PRODUTO_ID, quantidade: 2 }]);
    expect("observacao" in p.itens[0]).toBe(false);
    expect(p.itens[0]).toEqual({ produto_id: PRODUTO_ID, quantidade: 2 });
  });

  // [20] A garantia de §10 continua valendo com o campo novo.
  it("[20] nenhum campo monetário entra junto com a observação", () => {
    const p = payloadCom([
      {
        produtoId: PRODUTO_ID,
        quantidade: 2,
        observacao: "sem cebola",
        opcionais: [{ opcionalId: OPCIONAL_ID, quantidade: 1 }],
      },
    ]);
    for (const item of p.itens) {
      for (const proibido of CAMPOS_MONETARIOS_PROIBIDOS) {
        expect(Object.keys(item)).not.toContain(proibido);
      }
    }
  });

  // [21] Paridade cliente ↔ gate do servidor (issue 167): o payload com
  // observação atravessa o .strict() sem ser rejeitado.
  it("[21] payload com observação passa em schemaPayloadPedido.safeParse", () => {
    const p = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: [{ produtoId: PRODUTO_ID, quantidade: 1, observacao: "sem cebola" }],
      estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
      idempotencyKey: IDEMPOTENCY,
    });
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itens[0].observacao).toBe("sem cebola");
  });

  // [22] O cliente NUNCA pode produzir um payload que o servidor recuse por
  // tamanho — o teto do zod é medido DEPOIS da normalização, e a canonização do
  // cliente usa a mesma função.
  it("[22] observação no limite de LIMITE_OBSERVACAO sobrevive ao safeParse", () => {
    const noLimite = "a".repeat(LIMITE_OBSERVACAO);
    const p = montarPayloadPedido({
      lojaId: LOJA_ID,
      itens: [{ produtoId: PRODUTO_ID, quantidade: 1, observacao: noLimite }],
      estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
      idempotencyKey: IDEMPOTENCY,
    });
    const r = schemaPayloadPedido.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.itens[0].observacao).toBe(noLimite);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Paridade preview ↔ servidor (anti-drift). A MESMA regra de texto define a
//  identidade da linha no cliente (canonizarObservacao, dentro de
//  linhaCarrinhoId) e o que o servidor persiste (schemaObservacao = normalizar
//  → medir). Se as duas divergirem, o carrinho mostra N linhas e a comanda
//  grava M — este caso-espelho é o que pega a divergência.
// ────────────────────────────────────────────────────────────────────────────
describe("paridade preview ↔ servidor — canonização do texto (issue 168)", () => {
  const ENTRADAS = [
    "sem cebola",
    "sem  cebola",
    " sem cebola ",
    "sem\u00A0cebola",
    "\u200Bsem cebola\uFEFF",
    "linha1\r\nlinha2",
    "\u202Esem cebola",
    "sem cebola | sem tomate",
    "a".repeat(LIMITE_OBSERVACAO + 20),
  ];

  it("o texto canonizado no cliente é EXATAMENTE o que o servidor aceita e grava", () => {
    for (const entrada of ENTRADAS) {
      const cliente = canonizarObservacao(entrada);
      const p = montarPayloadPedido({
        lojaId: LOJA_ID,
        itens: [{ produtoId: PRODUTO_ID, quantidade: 1, observacao: cliente }],
        estado: estado({ tipoEntrega: "retirada", formaPagamento: "pix" }),
        idempotencyKey: IDEMPOTENCY,
      });
      const r = schemaPayloadPedido.safeParse(p);
      expect(r.success).toBe(true);
      if (r.success) {
        // Sem drift: o gate do servidor não muda mais nada no texto do cliente.
        expect(r.data.itens[0].observacao ?? "").toBe(cliente);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  ItemCarrinho → ItemPayload — a fronteira que o CheckoutWizard aplica. Era o
//  ÚNICO mapeamento em produção e vivia inline no `useMemo<ItemPayload[]>`; a
//  fase GREEN da 168 extraiu-o para `itemCarrinhoParaPayload` (estado.ts), o que
//  troca a trava de arquitetura por teste de comportamento real. Se `observacao`
//  não for copiada aqui, TODOS os testes de `montarPayloadPedido` ficam verdes e
//  o checkout NUNCA envia a observação (plan/168 §Riscos residuais, risco ALTO).
//  A trava de fonte sobreviveu numa forma mais fraca: garantir que o Wizard
//  continua DELEGANDO para esta função em vez de reintroduzir um mapeamento
//  paralelo que voltaria a divergir em silêncio.
// ────────────────────────────────────────────────────────────────────────────
describe("itemCarrinhoParaPayload — ItemCarrinho → ItemPayload (issue 168)", () => {
  const base: ItemCarrinho = {
    produtoId: PRODUTO_ID,
    nome: "X-Burguer",
    preco: 25,
    quantidade: 2,
  };

  it("copia a observação da linha", () => {
    expect(
      itemCarrinhoParaPayload({ ...base, observacao: "sem cebola" }).observacao,
    ).toBe("sem cebola");
  });

  it("item sem observação → a chave NÃO existe no ItemPayload", () => {
    expect("observacao" in itemCarrinhoParaPayload(base)).toBe(false);
  });

  it("NUNCA copia preço/nome/foto — só intenção (seguranca.md §10)", () => {
    const payload = itemCarrinhoParaPayload({
      ...base,
      fotoUrl: "https://exemplo.test/x.png",
      observacao: "sem cebola",
      opcionais: [
        { opcionalId: OPCIONAL_ID, nome: "bacon", preco: 5, quantidade: 1 },
      ],
    });
    expect(Object.keys(payload).sort()).toEqual([
      "observacao",
      "opcionais",
      "produtoId",
      "quantidade",
    ]);
    expect(payload.opcionais).toEqual([
      { opcionalId: OPCIONAL_ID, quantidade: 1 },
    ]);
    for (const opcional of payload.opcionais ?? []) {
      for (const proibido of CAMPOS_MONETARIOS_PROIBIDOS) {
        expect(Object.keys(opcional)).not.toContain(proibido);
      }
    }
  });

  it("duas linhas do mesmo produto atravessam até o payload final", () => {
    const itens = [
      { ...base, quantidade: 1, observacao: "sem cebola" },
      { ...base, quantidade: 3, observacao: "sem tomate" },
    ].map(itemCarrinhoParaPayload);
    const p = payloadCom(itens);
    expect(p.itens.map((i) => i.quantidade)).toEqual([1, 3]);
    expect(p.itens.map((i) => i.observacao)).toEqual(["sem cebola", "sem tomate"]);
  });
});

describe("CheckoutWizard delega o mapeamento a itemCarrinhoParaPayload (168)", () => {
  it("o useMemo<ItemPayload[]> não reintroduz um mapeamento paralelo", () => {
    const fonte = readFileSync(
      new URL("./CheckoutWizard.tsx", import.meta.url),
      "utf8",
    );
    const inicio = fonte.indexOf("useMemo<ItemPayload[]>");
    expect(inicio).toBeGreaterThan(-1);

    // Recorta o bloco do useMemo por balanceamento de parênteses.
    let profundidade = 0;
    let fim = inicio;
    for (let i = fonte.indexOf("(", inicio); i < fonte.length; i++) {
      if (fonte[i] === "(") profundidade++;
      else if (fonte[i] === ")") {
        profundidade--;
        if (profundidade === 0) {
          fim = i;
          break;
        }
      }
    }
    const bloco = fonte.slice(inicio, fim + 1);

    expect(bloco).toContain("itemCarrinhoParaPayload");
    // Nenhuma cópia campo a campo sobrevivendo em paralelo à função pura.
    expect(bloco).not.toMatch(/i\.quantidade/);
  });
});
