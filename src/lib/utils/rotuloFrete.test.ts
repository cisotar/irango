import { describe, it, expect } from "vitest";

import {
  freteConhecido,
  ROTULO_FRETE_A_COMBINAR,
  ROTULO_FRETE_A_COMBINAR_CURTO,
} from "./rotuloFrete";

// A REGRA QUE NÃO PODE CAIR (comentário do próprio módulo): a etiqueta "a
// combinar" vem de `frete_a_combinar`, NUNCA de `taxa_entrega === 0` — zero é
// frete GRÁTIS legítimo. Estes testes travam exatamente essa distinção nos 4
// quadrantes possíveis, mais os casos de defesa em profundidade (linha
// legada/órfã com taxa NULL mas a flag ainda false).

describe("freteConhecido — os 4 quadrantes (frete_a_combinar × taxa_entrega)", () => {
  it("frete_a_combinar=false + taxa_entrega=5 → conhecido (frete pago normal)", () => {
    expect(
      freteConhecido({ frete_a_combinar: false, taxa_entrega: 5 }),
    ).toBe(true);
  });

  it("frete_a_combinar=false + taxa_entrega=0 → conhecido (frete GRÁTIS legítimo, não é 'a combinar')", () => {
    expect(
      freteConhecido({ frete_a_combinar: false, taxa_entrega: 0 }),
    ).toBe(true);
  });

  it("frete_a_combinar=true + taxa_entrega=null → NÃO conhecido (a combinar de verdade)", () => {
    expect(
      freteConhecido({ frete_a_combinar: true, taxa_entrega: null }),
    ).toBe(false);
  });

  it("frete_a_combinar=true mesmo com taxa_entrega=0 → NÃO conhecido (a flag manda, não o valor)", () => {
    // Combinação que o CHECK do banco (chk_pedidos_frete_a_combinar) proíbe de
    // existir gravada, mas o predicado em memória não pode silenciosamente
    // tratar como grátis se algum caminho (bug futuro, linha corrompida) a
    // produzir — ele TEM que continuar dizendo "não é conhecido".
    expect(
      freteConhecido({ frete_a_combinar: true, taxa_entrega: 0 }),
    ).toBe(false);
  });

  it("frete_a_combinar=false + taxa_entrega=null (linha legada/órfã) → NÃO conhecido, defesa em profundidade", () => {
    // Comentário do módulo: uma linha legada com NULL nunca deve virar R$ 0,00.
    expect(
      freteConhecido({ frete_a_combinar: false, taxa_entrega: null }),
    ).toBe(false);
  });
});

describe("freteConhecido — type narrowing", () => {
  it("dentro do bloco `if (freteConhecido(pedido))`, taxa_entrega é number (não null) — checado em compile-time", () => {
    const pedido = { frete_a_combinar: false, taxa_entrega: 12.5 };
    if (freteConhecido(pedido)) {
      // Se isto não compilasse, `npx tsc --noEmit` já teria falhado antes do
      // teste rodar — a asserção aqui só prova que o runtime concorda.
      const valor: number = pedido.taxa_entrega;
      expect(valor).toBe(12.5);
    } else {
      throw new Error("esperava freteConhecido=true neste cenário");
    }
  });
});

describe("rótulos — texto longo × curto não podem ser confundidos com moeda", () => {
  it("ROTULO_FRETE_A_COMBINAR não contém dígito nem 'R$'", () => {
    expect(ROTULO_FRETE_A_COMBINAR).not.toMatch(/\d|R\$/);
  });

  it("ROTULO_FRETE_A_COMBINAR_CURTO não contém dígito nem 'R$'", () => {
    expect(ROTULO_FRETE_A_COMBINAR_CURTO).not.toMatch(/\d|R\$/);
  });

  it("o rótulo curto é de fato mais curto (cabe no recibo térmico/WhatsApp)", () => {
    expect(ROTULO_FRETE_A_COMBINAR_CURTO.length).toBeLessThan(
      ROTULO_FRETE_A_COMBINAR.length,
    );
  });
});
