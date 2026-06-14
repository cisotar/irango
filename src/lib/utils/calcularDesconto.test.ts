import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/calcularDesconto.ts com a função pura + estes tipos.
import { calcularDesconto, type CupomCalculo } from "./calcularDesconto";

// ---------------------------------------------------------------------------
// Builder mínimo de CupomCalculo — função PURA, sem I/O. Defaults no caminho
// feliz (percentual 10%, sem pedido mínimo); cada teste sobrescreve o que precisa.
//
// RESPONSABILIDADE DA FUNÇÃO PURA: dado um cupom e um subtotal, calcular o VALOR
// do desconto, respeitando pedido_minimo e o clamp (desconto nunca > subtotal).
//   - tipo 'percentual' → subtotal * valor / 100, arredondado a 2 casas
//   - tipo 'fixo'       → valor, limitado ao subtotal
//   - subtotal < pedido_minimo → não aplica (aplicado=false, desconto=0)
//
// FORA DA RESPONSABILIDADE (caller / Server Action 013 validarCupom):
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

describe("calcularDesconto — cupom percentual", () => {
  it("aplica percentual sobre o subtotal (10% de 100 → 10)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), 100);
    expect(r.aplicado).toBe(true);
    expect(r.desconto).toBe(10);
  });

  it("arredonda o percentual a 2 casas (10% de 33.33 = 3.333 → 3.33)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), 33.33);
    expect(r.desconto).toBe(3.33);
  });

  it("percentual de 100% é limitado ao subtotal (total nunca negativo)", () => {
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 100 }), 50);
    expect(r.desconto).toBe(50);
    expect(r.aplicado).toBe(true);
  });
});

describe("calcularDesconto — cupom fixo", () => {
  it("desconto fixo de R$15 → 15", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 15 }), 100);
    expect(r.desconto).toBe(15);
    expect(r.aplicado).toBe(true);
  });

  it("desconto fixo maior que o subtotal é limitado ao subtotal", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 20 }), 12);
    expect(r.desconto).toBe(12);
    expect(r.aplicado).toBe(true);
  });

  it("fixo igual ao subtotal zera o pagável sem ir negativo", () => {
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 30 }), 30);
    expect(r.desconto).toBe(30);
  });
});

describe("calcularDesconto — pedido mínimo", () => {
  it("subtotal abaixo do pedido_minimo NÃO aplica (desconto 0 + motivo)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "fixo", valor: 10, pedido_minimo: 50 }),
      49.99,
    );
    expect(r.aplicado).toBe(false);
    expect(r.desconto).toBe(0);
    expect(r.motivo).toBe("pedido_minimo");
  });

  it("subtotal exatamente igual ao pedido_minimo aplica", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 50 }),
      50,
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
      50,
    );
    expect(r.desconto).toBe(0);
    expect(r.desconto).toBeGreaterThanOrEqual(0);
    expect(r.aplicado).toBe(true);
  });

  it("percentual de 150% é limitado ao subtotal (não ultrapassa)", () => {
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 150, pedido_minimo: 0 }),
      50,
    );
    expect(r.desconto).toBe(50);
    expect(r.aplicado).toBe(true);
  });
});
