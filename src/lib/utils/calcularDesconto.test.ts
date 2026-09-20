import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/calcularDesconto.ts com a função pura + estes tipos.
import {
  calcularDesconto,
  type BasesDesconto,
  type CupomCalculo,
} from "./calcularDesconto";

// ---------------------------------------------------------------------------
// Builder mínimo de CupomCalculo — função PURA, sem I/O. Defaults no caminho
// feliz (percentual 10%, sem pedido mínimo); cada teste sobrescreve o que precisa.
//
// RESPONSABILIDADE DA FUNÇÃO PURA (227 / D5, D5-a, D9): dado um cupom e as
// BASES { subtotal, baseElegivel }, calcular o VALOR do desconto.
//   - gate     → bases.subtotal < pedido_minimo ⇒ não aplica (D5-a: a régua do
//                pedido mínimo é o SUBTOTAL, nunca a base elegível)
//   - percentual → arredondar(bases.baseElegivel * valor / 100)
//   - fixo       → valor
//   - clamp    → Math.min(Math.max(bruto, 0), bases.baseElegivel)  (o teto é a
//                BASE, não o subtotal — RN-10-b)
//   - resultado ecoa `baseElegivel` nos dois ramos (D-4)
//
// FORA DA RESPONSABILIDADE (callers: `revisarCarrinhoAction` e `criarPedido`,
// via a função pura `validarUsoCupom`):
//   validade temporal (expira_em < agora), ativo=false, usos_contagem >=
//   usos_maximos, escopo de loja (loja_id). Essas validações exigem "agora",
//   estado de uso e RLS — não pertencem a uma função pura de cálculo. Por isso
//   CupomCalculo NÃO inclui ativo/expira_em/usos_*: o caller já barra o cupom
//   inválido ANTES de chamar calcularDesconto. Ver issue 013.
// ---------------------------------------------------------------------------

function cupom(over: Partial<CupomCalculo> = {}): CupomCalculo {
  return {
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    ...over,
  };
}

/**
 * Bases SINTÉTICAS, só para teste. `BasesDesconto` é marcada: em produção o
 * único produtor é `derivarBasesCupom` (um literal não compila mais). Aqui a
 * marca é forçada de propósito, porque estes casos precisam de pares que
 * `derivarBasesCupom` nunca produziria — NaN, negativo, base > subtotal,
 * Infinity — que são exatamente o que o guard fail-closed existe para barrar.
 */
function bases(subtotal: number, baseElegivel: number): BasesDesconto {
  return { subtotal, baseElegivel } as unknown as BasesDesconto;
}

describe("calcularDesconto — cupom percentual", () => {
  it("aplica percentual sobre o subtotal (10% de 100 → 10)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(100, 100));
    expect(r.aplicado).toBe(true);
    expect(r.desconto).toBe(10);
  });

  it("arredonda o percentual a 2 casas (10% de 33.33 = 3.333 → 3.33)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(33.33, 33.33));
    expect(r.desconto).toBe(3.33);
  });

  it("percentual de 100% é limitado ao subtotal (total nunca negativo)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 100 }), bases(50, 50));
    expect(r.desconto).toBe(50);
    expect(r.aplicado).toBe(true);
  });
});

describe("calcularDesconto — cupom fixo", () => {
  it("desconto fixo de R$15 → 15", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 15 }), bases(100, 100));
    expect(r.desconto).toBe(15);
    expect(r.aplicado).toBe(true);
  });

  it("desconto fixo maior que o subtotal é limitado ao subtotal", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 20 }), bases(12, 12));
    expect(r.desconto).toBe(12);
    expect(r.aplicado).toBe(true);
  });

  it("fixo igual ao subtotal zera o pagável sem ir negativo", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 30 }), bases(30, 30));
    expect(r.desconto).toBe(30);
  });
});

describe("calcularDesconto — pedido mínimo", () => {
  it("subtotal abaixo do pedido_minimo NÃO aplica (desconto 0 + motivo)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "fixo", valor: 10, pedido_minimo: 50 }),
      bases(49.99, 49.99),
    );
    expect(r.aplicado).toBe(false);
    expect(r.desconto).toBe(0);
    expect(r.motivo).toBe("pedido_minimo");
  });

  it("subtotal exatamente igual ao pedido_minimo aplica", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 50 }),
      bases(50, 50),
    );
    expect(r.aplicado).toBe(true);
    expect(r.desconto).toBe(5);
  });
});

describe("calcularDesconto — piso 0 (desconto nunca negativo)", () => {
  // FIX auditoria: cupom fixo com valor negativo NÃO pode virar acréscimo.
  it("fixo com valor negativo resulta em desconto 0 (não vira acréscimo)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "fixo", valor: -10, pedido_minimo: 0 }),
      bases(50, 50),
    );
    expect(r.desconto).toBe(0);
    expect(r.desconto).toBeGreaterThanOrEqual(0);
    expect(r.aplicado).toBe(true);
  });

  it("percentual de 150% é limitado ao subtotal (não ultrapassa)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 150, pedido_minimo: 0 }),
      bases(50, 50),
    );
    expect(r.desconto).toBe(50);
    expect(r.aplicado).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RED 227 — o describe que distingue a implementação certa da errada.
// REGRA: todo caso aqui tem `baseElegivel < subtotal`. Com bases IGUAIS a
// fórmula nova reduz à antiga e o teste não prova nada.
// ---------------------------------------------------------------------------

describe("calcularDesconto — bases distintas (D5/D9)", () => {
  it("percentual incide sobre a baseElegivel, não sobre o subtotal (RN-10-a: 10% de 50 → 5)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(130, 50));
    // Sobre o subtotal seriam 13 — o cupom acumularia com o desconto do produto.
    expect(r.desconto).toBe(5);
    expect(r.aplicado).toBe(true);
  });

  it("clamp do fixo é a baseElegivel, não o subtotal (RN-10-b: fixo 80 sobre base 50 → 50)", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 80 }), bases(130, 50));
    // Com o teto antigo (subtotal) seriam 80: R$ 30,00 de prejuízo por pedido.
    expect(r.desconto).toBe(50);
  });

  it("baseElegivel zero: desconto 0 com aplicado=true e motivo null (RN-10-c)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(80, 0));
    // `aplicado` = passou no gate de pedido mínimo, NUNCA "descontou dinheiro".
    expect(r.aplicado).toBe(true);
    expect(r.motivo).toBe(null);
    expect(r.desconto).toBe(0);
  });

  it("percentual sobre base com opcional de linha promocional (RN-10-d: 10% de 60 → 6)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(140, 60));
    expect(r.desconto).toBe(6);
  });

  it("gate de pedido_minimo olha o SUBTOTAL: aceita 130 >= 100 mesmo com base 50 (D5-a)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 100 }),
      bases(130, 50),
    );
    expect(r.aplicado).toBe(true);
    expect(r.motivo).toBe(null);
    expect(r.desconto).toBe(5);
  });

  it("gate de pedido_minimo olha o SUBTOTAL: recusa 130 < 130.01 (D5-a, sentido inverso)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 130.01 }),
      bases(130, 50),
    );
    expect(r.aplicado).toBe(false);
    expect(r.desconto).toBe(0);
    expect(r.motivo).toBe("pedido_minimo");
  });

  it("ecoa baseElegivel no ramo aplicado (D-4)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases(140, 60));
    expect(r.baseElegivel).toBe(60);
  });

  it("ecoa baseElegivel no ramo recusado — o campo descreve a base, não o veredito (D-4)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "fixo", valor: 10, pedido_minimo: 999 }),
      bases(130, 50),
    );
    expect(r.aplicado).toBe(false);
    expect(r.baseElegivel).toBe(50);
  });
});

describe("calcularDesconto — guard fail-closed (D-5)", () => {
  it("lança quando baseElegivel > subtotal (bug de montagem, não estado de negócio)", () => {
    expect(() =>
      calcularDesconto(cupom(), bases(50, 80)),
    ).toThrow(/bases invalidas/);
  });

  it("lança quando baseElegivel é NaN (nunca vira desconto NaN → p_desconto null)", () => {
    expect(() =>
      calcularDesconto(cupom(), bases(130, NaN)),
    ).toThrow(/bases invalidas/);
  });

  it("lança quando baseElegivel é negativa", () => {
    expect(() =>
      calcularDesconto(cupom(), bases(130, -1)),
    ).toThrow(/bases invalidas/);
  });

  it("lança quando o subtotal é Infinity (senão o desconto sai Infinity → total NaN → p_desconto null)", () => {
    expect(() =>
      calcularDesconto(cupom(), bases(Infinity, Infinity)),
    ).toThrow(/bases invalidas/);
  });
});
