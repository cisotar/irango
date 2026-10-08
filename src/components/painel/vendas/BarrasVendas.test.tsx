/**
 * Issue 358 (RN-V24) — barras do faturamento em CSS, acessíveis.
 * Ambiente node, sem jsdom: renderToStaticMarkup. Os rótulos vêm do rollup real
 * (`agregarVendas`), então semanal/mensal usam o mesmo texto do servidor.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BarrasVendas } from "./BarrasVendas";
import {
  agruparPorCiclo,
  agruparPorSemana,
  barrasDiarias,
  type LinhaDiariaVendas,
} from "@/lib/utils/agregarVendas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

const linha = (dia: string, liquido: number): LinhaDiariaVendas => ({
  dia,
  pedidos: 1,
  bruto: liquido,
  descontos: 0,
  liquido,
  frete: 0,
  freteACombinar: 0,
});

const DIAS = [linha("2026-10-04", 80), linha("2026-10-05", 120)];

/** Tags `role="img"` (as barras) do markup. */
const barras = (html: string) => html.match(/<div[^>]*role="img"[^>]*>/g) ?? [];

describe("BarrasVendas (358)", () => {
  it("diário: uma barra por dia com aria-label 'rótulo: valor' e classe bg-primary, nunca bg-chart-1", () => {
    const html = renderToStaticMarkup(<BarrasVendas barras={barrasDiarias(DIAS)} granularidade="diario" />);
    const tags = barras(html);
    expect(tags).toHaveLength(2);
    expect(tags[1]).toContain(`aria-label="05/out: ${formatarMoeda(120)}"`);
    expect(tags[0]).toContain(`aria-label="04/out: ${formatarMoeda(80)}"`);
    for (const t of tags) expect(t).toContain("bg-primary");
    expect(html).not.toContain("bg-chart-1");
    expect(html).toContain('aria-label="Faturamento líquido por dia"');
  });

  it("a maior barra tem 100% de altura; as demais, proporcionais", () => {
    const html = renderToStaticMarkup(<BarrasVendas barras={barrasDiarias(DIAS)} granularidade="diario" />);
    const tags = barras(html);
    expect(tags[1]).toContain("height:100%");
    expect(tags[0]).toMatch(/height:66\.6+\d*%/);
  });

  it("período sem venda: barras com altura 0, sem divisão por zero", () => {
    const html = renderToStaticMarkup(
      <BarrasVendas barras={barrasDiarias([linha("2026-10-05", 0)])} granularidade="diario" />,
    );
    expect(barras(html)[0]).toContain("height:0%");
    expect(html).not.toContain("NaN");
  });

  it("até 14 barras o valor fica visível em texto; acima, vira sr-only", () => {
    const quatorze = Array.from({ length: 14 }, (_, i) =>
      linha(`2026-10-${String(i + 1).padStart(2, "0")}`, i + 1),
    );
    const visivel = renderToStaticMarkup(<BarrasVendas barras={barrasDiarias(quatorze)} granularidade="diario" />);
    expect(visivel).toContain(`>${formatarMoeda(14)}</span>`);
    expect(visivel).not.toContain("sr-only");

    const quinze = [...quatorze, linha("2026-10-15", 15)];
    const escondido = renderToStaticMarkup(<BarrasVendas barras={barrasDiarias(quinze)} granularidade="diario" />);
    expect(escondido).toContain(`<span class="text-xs text-foreground sr-only">${formatarMoeda(15)}</span>`);
  });

  it("semanal e mensal usam os rótulos do intervalo inteiro", () => {
    const semanal = renderToStaticMarkup(<BarrasVendas barras={agruparPorSemana(DIAS)} granularidade="semanal" />);
    expect(semanal).toContain(`aria-label="28/set a 04/out: ${formatarMoeda(80)}"`);
    expect(semanal).toContain(`aria-label="05/out a 11/out: ${formatarMoeda(120)}"`);
    expect(semanal).toContain('aria-label="Faturamento líquido por semana"');

    const mensal = renderToStaticMarkup(<BarrasVendas barras={agruparPorCiclo(DIAS, 5)} granularidade="mensal" />);
    expect(mensal).toContain(`aria-label="05/set a 04/out: ${formatarMoeda(80)}"`);
    expect(mensal).toContain(`aria-label="05/out a 04/nov: ${formatarMoeda(120)}"`);
    expect(mensal).toContain('aria-label="Faturamento líquido por ciclo"');
  });
});
