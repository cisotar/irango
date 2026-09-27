import { describe, it, expect } from "vitest";

import {
  diasDasPilulas,
  mesmosDias,
  montarPayloadDaGrade,
  pilulasDosDias,
} from "./gradeFrequencia";

/** [323/C8] Grade produto × dia: tradução salvo ⇄ pílulas e payload (RN-6/RN-8). */

describe("323 — pílulas ⇄ dias salvos (D13)", () => {
  it("null (todo dia) ⇒ 7 marcadas; [] (nunca) ⇒ nenhuma", () => {
    expect(pilulasDosDias(null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pilulasDosDias([])).toEqual([]);
    expect(pilulasDosDias([6, 1])).toEqual([1, 6]);
  });

  it("7 marcadas ⇒ null; nenhuma ⇒ [] (e NÃO null)", () => {
    expect(diasDasPilulas([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(diasDasPilulas([])).toEqual([]);
    expect(diasDasPilulas([])).not.toBeNull();
  });

  it("mesmosDias compara normalizado: null ≠ [], [1,2] = [2,1], 7 dias = null", () => {
    expect(mesmosDias(null, [])).toBe(false);
    expect(mesmosDias([1, 2], [2, 1])).toBe(true);
    expect(mesmosDias([0, 1, 2, 3, 4, 5, 6], null)).toBe(true);
  });
});

describe("323 — montarPayloadDaGrade", () => {
  const inicial = { a: null, b: [6], c: [], d: [1, 2] };

  it("linha intocada não entra — inclusive a `null`, que exibe 7 marcadas", () => {
    const atual = {
      a: pilulasDosDias(null),
      b: pilulasDosDias([6]),
      c: pilulasDosDias([]),
      d: [2, 1],
    };
    expect(montarPayloadDaGrade(inicial, atual)).toEqual({ itens: [] });
  });

  it("só as alteradas, com `dias_semana` sempre presente; [] e null preservados", () => {
    const atual = {
      a: [], // todo dia → nunca
      b: [0, 1, 2, 3, 4, 5, 6], // só sáb → todo dia
      c: [3], // nunca → só qua
      d: [1, 2],
    };
    const { itens } = montarPayloadDaGrade(inicial, atual);
    expect(itens).toEqual([
      { produto_id: "a", dias_semana: [] },
      { produto_id: "b", dias_semana: null },
      { produto_id: "c", dias_semana: [3] },
    ]);
    for (const item of itens) expect(Object.keys(item).sort()).toEqual(["dias_semana", "produto_id"]);
  });

  it("produto que não está no estado salvo é ignorado (nada inventado)", () => {
    expect(montarPayloadDaGrade(inicial, { x: [1] })).toEqual({ itens: [] });
  });
});
