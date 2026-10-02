import { describe, it, expect } from "vitest";
import { cupomSchema } from "./cupom";

/**
 * Fase RED (TDD) da issue 342 — `limite_por_cliente` no schema do cupom
 * (specs/cliente-vinculo-pedido.md §Cupons (painel):
 * `z.number().int().min(1).max(1000).nullable()`). Arquivo NOVO; `cupom.test.ts` intocado.
 *
 * Por que é RED: o schema atual não conhece o campo — o zod o REMOVE em silêncio
 * (`0`/`1001` passam; `null`/`5` somem do output).
 */

function cupomValido(over: Record<string, unknown> = {}) {
  return {
    codigo: "PROMO5",
    tipo: "fixo",
    valor: 5,
    pedido_minimo: 0,
    usos_maximos: null,
    expira_em: null,
    ativo: true,
    limite_por_cliente: null,
    ...over,
  };
}

describe("342 cupomSchema.limite_por_cliente", () => {
  it.each([0, 1001, -1, 1.5])("recusa %s", (v) => {
    expect(cupomSchema.safeParse(cupomValido({ limite_por_cliente: v })).success).toBe(false);
  });

  it("recusa string numérica (sem coerção)", () => {
    expect(cupomSchema.safeParse(cupomValido({ limite_por_cliente: "3" })).success).toBe(false);
  });

  it.each([1, 5, 1000])("aceita %s e o preserva no output", (v) => {
    const r = cupomSchema.safeParse(cupomValido({ limite_por_cliente: v }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).limite_por_cliente).toBe(v);
  });

  it("aceita null (sem limite) e o preserva no output", () => {
    const r = cupomSchema.safeParse(cupomValido({ limite_por_cliente: null }));
    expect(r.success).toBe(true);
    expect(r.success && Object.prototype.hasOwnProperty.call(r.data, "limite_por_cliente")).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).limite_por_cliente).toBeNull();
  });
});
