import { describe, it, expect } from "vitest";

import { projetarFrequenciasDoPainel } from "./frequenciaPainel";
import { FREQUENCIA_PERMANENTE, type Frequencia } from "./frequencia";

/** [323/C8] Projeção do painel: chip + aviso por produto e por categoria. */

const SP = "America/Sao_Paulo";
const AGORA = new Date("2027-01-15T15:00:00.000Z");

const freq = (over: Partial<Frequencia> = {}): Frequencia => ({
  ...FREQUENCIA_PERMANENTE,
  ...over,
});

const CAT_SEMANA = { id: "cat-semana", oculta: false, ...freq({ dias_semana: [1, 2, 3, 4, 5] }) };
const CAT_OCULTA = { id: "cat-oculta", oculta: true, ...freq() };
const CAT_NATAL = {
  id: "cat-natal",
  oculta: false,
  ...freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" }),
};

describe("323 — projetarFrequenciasDoPainel", () => {
  const r = projetarFrequenciasDoPainel(
    [
      { id: "permanente", categoria_id: null, ...freq() },
      { id: "sabado", categoria_id: "cat-semana", ...freq({ dias_semana: [6] }) },
      { id: "nunca", categoria_id: "cat-semana", ...freq({ dias_semana: [] }) },
      {
        id: "encerrado-e-rn1",
        categoria_id: "cat-semana",
        ...freq({ dias_semana: [6], periodo_fim: "2026-12-31" }),
      },
      { id: "orfao", categoria_id: "cat-inexistente", ...freq({ dias_semana: [6] }) },
    ],
    [CAT_SEMANA, CAT_OCULTA, CAT_NATAL],
    AGORA,
    SP,
  );

  it("produto permanente: sem chip e sem aviso", () => {
    expect(r.produtos.permanente).toEqual({ rotulo: null, aviso: null });
  });

  it("RN-1: produto só sáb em categoria seg a sex ⇒ chip + aviso de interseção", () => {
    expect(r.produtos.sabado.rotulo).toBe("sáb");
    expect(r.produtos.sabado.aviso).toContain("não batem com os da categoria");
  });

  it("RN-8: `[]` ⇒ chip 'Nunca disponível' e NENHUM aviso", () => {
    expect(r.produtos.nunca).toEqual({ rotulo: "Nunca disponível", aviso: null });
  });

  it("período encerrado VENCE o aviso RN-1", () => {
    expect(r.produtos["encerrado-e-rn1"].aviso).toBe(
      "Período encerrado em 31/12: não aparece mais na vitrine. Mude o período para voltar a vender.",
    );
  });

  it("categoria fora do mapa ⇒ avaliado só o produto (sem aviso inventado)", () => {
    expect(r.produtos.orfao.aviso).toBeNull();
  });

  it("categorias: oculta, frequência crua, chip e aviso de encerrado", () => {
    expect(r.categorias["cat-oculta"]).toEqual({
      oculta: true,
      frequencia: freq(),
      rotulo: null,
      aviso: null,
    });
    expect(r.categorias["cat-semana"].frequencia).toEqual(freq({ dias_semana: [1, 2, 3, 4, 5] }));
    expect(r.categorias["cat-semana"].rotulo).toBe("seg a sex");
    expect(r.categorias["cat-natal"].aviso).toContain("Período encerrado em 31/12");
  });

  it("carrega o instante da página e o fuso da loja (o browser não usa o relógio dele)", () => {
    expect(r.agora).toBe(AGORA.toISOString());
    expect(r.timezone).toBe(SP);
  });

  it("a frequência da categoria não carrega colunas extras (só os 5 eixos)", () => {
    expect(Object.keys(r.categorias["cat-semana"].frequencia).sort()).toEqual(
      ["dias_semana", "hora_fim", "hora_inicio", "periodo_fim", "periodo_inicio"],
    );
  });
});
