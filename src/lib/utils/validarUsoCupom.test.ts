import { describe, it, expect } from "vitest";
import { validarUsoCupom, type CupomUso } from "./validarUsoCupom";

// `agora` fixo → expiração determinística.
const AGORA = new Date("2026-06-14T12:00:00.000Z");
const ANTES = "2026-06-14T11:59:59.000Z"; // passado
const DEPOIS = "2026-06-14T12:00:01.000Z"; // futuro

// Cupom base válido: ativo, sem expiração, usos ilimitados, sem pedido mínimo.
function cupom(over: Partial<CupomUso> = {}): CupomUso {
  return {
    ativo: true,
    expira_em: null,
    usos_maximos: null,
    usos_contagem: 0,
    pedido_minimo: 0,
    ...over,
  };
}

describe("validarUsoCupom (puro)", () => {
  it("cupom ativo, sem expiração, sem mínimo → válido", () => {
    expect(validarUsoCupom(cupom(), 5000, AGORA)).toEqual({
      valido: true,
      motivo: null,
    });
  });

  it("cupom inativo → invalido (mesmo motivo que inexistente — anti-enumeração)", () => {
    expect(validarUsoCupom(cupom({ ativo: false }), 5000, AGORA)).toEqual({
      valido: false,
      motivo: "invalido",
    });
  });

  it("expira_em no passado → invalido (não revela 'expirou')", () => {
    expect(validarUsoCupom(cupom({ expira_em: ANTES }), 5000, AGORA)).toEqual({
      valido: false,
      motivo: "invalido",
    });
  });

  it("expira_em no futuro → válido", () => {
    expect(validarUsoCupom(cupom({ expira_em: DEPOIS }), 5000, AGORA)).toEqual({
      valido: true,
      motivo: null,
    });
  });

  it("borda: expira_em === agora → invalido (expira_em <= agora esgota)", () => {
    expect(
      validarUsoCupom(cupom({ expira_em: AGORA.toISOString() }), 5000, AGORA),
    ).toEqual({ valido: false, motivo: "invalido" });
  });

  it("usos esgotados (usos_contagem >= usos_maximos) → invalido", () => {
    expect(
      validarUsoCupom(
        cupom({ usos_maximos: 10, usos_contagem: 10 }),
        5000,
        AGORA,
      ),
    ).toEqual({ valido: false, motivo: "invalido" });
  });

  it("borda: usos_contagem === usos_maximos - 1 → ainda válido", () => {
    expect(
      validarUsoCupom(
        cupom({ usos_maximos: 10, usos_contagem: 9 }),
        5000,
        AGORA,
      ),
    ).toEqual({ valido: true, motivo: null });
  });

  it("usos_maximos null = ilimitado, nunca esgota → válido", () => {
    expect(
      validarUsoCupom(
        cupom({ usos_maximos: null, usos_contagem: 9999 }),
        5000,
        AGORA,
      ),
    ).toEqual({ valido: true, motivo: null });
  });

  it("subtotal abaixo do pedido_minimo → pedido_minimo (único motivo revelável)", () => {
    expect(
      validarUsoCupom(cupom({ pedido_minimo: 5000 }), 4999, AGORA),
    ).toEqual({ valido: false, motivo: "pedido_minimo" });
  });

  it("borda: subtotal === pedido_minimo → válido (mínimo é inclusivo)", () => {
    expect(
      validarUsoCupom(cupom({ pedido_minimo: 5000 }), 5000, AGORA),
    ).toEqual({ valido: true, motivo: null });
  });

  it("precedência: inativo prevalece sobre pedido_minimo atingido", () => {
    // Inativo E abaixo do mínimo: o motivo seguro (invalido) deve ganhar do
    // revelável (pedido_minimo) — senão a action vira oráculo de existência.
    expect(
      validarUsoCupom(
        cupom({ ativo: false, pedido_minimo: 5000 }),
        100,
        AGORA,
      ),
    ).toEqual({ valido: false, motivo: "invalido" });
  });
});
