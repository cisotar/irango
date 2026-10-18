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

// ═════════════════════════════════════════════════════ 325 · temZonaQueCobra
// CONTRATO (plan/loop-ativar-forma-frete.md D5): modalidadesEntrega.ts
//   export function temZonaQueCobra(zonas: ZonaResumo[]): boolean
//     = zonas.some(z => z.ativo && z.taxa !== null) — usado por entregaDisponivel
//     e pelo bloqueio do botão "Usar esta forma". Resolvido pelo namespace:
//     export ausente vira falha com mensagem, não import quebrado.
import * as modalidades from "./modalidadesEntrega";

function temZonaQueCobra(zonas: Array<{ ativo: boolean; taxa: unknown | null }>): boolean {
  const fn = (modalidades as unknown as { temZonaQueCobra?: (z: typeof zonas) => boolean }).temZonaQueCobra;
  if (typeof fn !== "function") {
    throw new Error("[RED 325/F5] `modalidadesEntrega.ts` ainda não exporta `temZonaQueCobra` (D5).");
  }
  return fn(zonas);
}

describe("[325/F5] temZonaQueCobra — botão 'Usar esta forma' só com zona ativa com taxa", () => {
  it("lista vazia ⇒ false", () => {
    expect(temZonaQueCobra([])).toBe(false);
  });

  it("só zona inativa (com taxa) ⇒ false", () => {
    expect(temZonaQueCobra([ZONA_INATIVA])).toBe(false);
  });

  it("só zona ativa sem taxa ⇒ false", () => {
    expect(temZonaQueCobra([ZONA_SEM_TAXA])).toBe(false);
  });

  it("inativa + sem taxa ⇒ false", () => {
    expect(temZonaQueCobra([ZONA_INATIVA, ZONA_SEM_TAXA])).toBe(false);
  });

  it("alguma ativa com taxa no meio de outras ⇒ true", () => {
    expect(temZonaQueCobra([ZONA_INATIVA, ZONA_SEM_TAXA, ZONA_ATIVA])).toBe(true);
  });

  it("taxa 0 (entrega grátis) conta como zona que cobra — número e objeto", () => {
    expect(temZonaQueCobra([{ ativo: true, taxa: 0 }])).toBe(true);
    expect(temZonaQueCobra([{ ativo: true, taxa: { taxa: 0 } }])).toBe(true);
  });

  it("entregaDisponivel segue a mesma regra de zona (automático, sem fallback)", () => {
    const loja = { aceita_entrega: true, modo_frete: "automatico", taxa_entrega_fora_zona: null };
    for (const zonas of [[], [ZONA_INATIVA], [ZONA_SEM_TAXA], [ZONA_ATIVA], [{ ativo: true, taxa: 0 }]]) {
      expect(entregaDisponivel(loja, zonas)).toBe(temZonaQueCobra(zonas));
    }
  });
});
