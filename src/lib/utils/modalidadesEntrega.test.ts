import { describe, it, expect } from "vitest";
import {
  entregaDisponivel,
  modalidadesDaLoja,
  retiradaDisponivel,
} from "./modalidadesEntrega";

const ZONA_ATIVA = { ativo: true, taxa: { taxa: 5 } };
const ZONA_INATIVA = { ativo: false, taxa: { taxa: 5 } };
const ZONA_SEM_TAXA = { ativo: true, taxa: null };

describe("entregaDisponivel", () => {
  it("entrega desligada: indisponível mesmo com zona ativa e a combinar", () => {
    expect(
      entregaDisponivel({ aceita_entrega: false, modo_frete: "a_combinar" }, [ZONA_ATIVA]),
    ).toBe(false);
  });

  it("a combinar dispensa zona e fallback", () => {
    expect(entregaDisponivel({ aceita_entrega: true, modo_frete: "a_combinar" }, [])).toBe(true);
  });

  it("automático com zona ativa e com taxa: disponível", () => {
    expect(entregaDisponivel({ modo_frete: "automatico" }, [ZONA_ATIVA])).toBe(true);
  });

  it("automático só com fallback fora-de-zona: disponível", () => {
    expect(entregaDisponivel({ modo_frete: "automatico", taxa_entrega_fora_zona: 8 }, [])).toBe(true);
  });

  it("D4: automático sem zona ativa com taxa e sem fallback: indisponível", () => {
    expect(
      entregaDisponivel(
        { aceita_entrega: true, modo_frete: "automatico", taxa_entrega_fora_zona: null },
        [ZONA_INATIVA, ZONA_SEM_TAXA],
      ),
    ).toBe(false);
  });

  it("colunas ausentes valem o default (entrega ligada, automático)", () => {
    expect(entregaDisponivel({}, [ZONA_ATIVA])).toBe(true);
    expect(entregaDisponivel({}, [])).toBe(false);
  });
});

describe("retiradaDisponivel", () => {
  it.each([
    [true, true],
    [false, false],
    [null, true],
    [undefined, true],
  ] as const)("aceita_retirada=%s → %s", (v, esperado) => {
    expect(retiradaDisponivel({ aceita_retirada: v })).toBe(esperado);
  });
});

describe("modalidadesDaLoja", () => {
  it("estreita modo_frete para o enum; desconhecido vira automatico", () => {
    expect(modalidadesDaLoja({ aceita_retirada: false, aceita_entrega: true, modo_frete: "a_combinar" })).toEqual({
      aceita_retirada: false,
      aceita_entrega: true,
      modo_frete: "a_combinar",
    });
    expect(modalidadesDaLoja({ modo_frete: "x" })).toEqual({
      aceita_retirada: true,
      aceita_entrega: true,
      modo_frete: "automatico",
    });
  });
});
