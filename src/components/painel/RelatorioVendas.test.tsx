/**
 * Issue 358 — parte financeira do relatório (RN-V05, V18, V22, V23).
 * Ambiente node, sem jsdom: renderToStaticMarkup. `next/navigation` mockado só
 * para o `CicloMensal` (client) renderizar; nenhuma lógica do componente é stubada.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { RelatorioVendas, type RelatorioVendasProps } from "./RelatorioVendas";
import { FILTROS_PADRAO, RANKING_PADRAO } from "@/lib/validacoes/vendas";
import type { ResultadoRelatorioVendas } from "@/lib/vendas/carregarRelatorioVendas";
import type { TotaisVendas } from "@/lib/utils/agregarVendas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

const BASE = "/painel/vendas";

function relatorio(totais: Partial<TotaisVendas> = {}): ResultadoRelatorioVendas {
  return {
    ok: true,
    contexto: {
      janela: { deDia: "2026-10-05", ateDia: "2026-11-04", inicio: "2026-10-05T03:00:00.000Z", fim: "2026-11-05T03:00:00.000Z" },
      rotuloPeriodo: "05/out a 04/nov",
      cicloAtual: { deDia: "2026-10-05", ateDia: "2026-11-04", rotulo: "05/out a 04/nov" },
      diaInicioCiclo: 5,
    },
    dados: {
      totais: { pedidos: 3, bruto: 80, descontos: 10.5, liquido: 69.5, frete: 5, freteACombinar: 1, ...totais },
      barras: { diario: [], semanal: [], mensal: [] },
      categorias: [],
    },
  };
}

function render(over: Partial<RelatorioVendasProps> = {}): string {
  return renderToStaticMarkup(
    <RelatorioVendas
      baseVendas={BASE}
      filtros={FILTROS_PADRAO}
      ranking={RANKING_PADRAO}
      avisoFiltros={false}
      diaInicioCiclo={5}
      relatorio={relatorio()}
      salvarCiclo={async () => ({ ok: true })}
      {...over}
    />,
  );
}

/** hrefs (decodificados de &amp;) dos <a> do markup. */
const hrefs = (html: string) =>
  [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("RelatorioVendas (358)", () => {
  it("RN-V22: os dois avisos com o texto exato", () => {
    const html = render();
    expect(html).toContain("Este relatório cobre só as vendas feitas pelo iRango.");
    expect(html).toContain("Os valores são nominais: o iRango não registra se o pedido foi pago.");
  });

  it("resumo formatado: bruto, descontos, líquido e frete com formatarMoeda", () => {
    const html = render();
    for (const v of [80, 10.5, 69.5, 5]) expect(html).toContain(formatarMoeda(v));
    expect(html).toContain("Ciclo atual: 05/out a 04/nov");
  });

  it("RN-V05: frete a combinar no singular, no plural e ausente quando zero", () => {
    expect(render()).toContain("1 pedido com frete a combinar, não somado");
    expect(render({ relatorio: relatorio({ freteACombinar: 3 }) })).toContain(
      "3 pedidos com frete a combinar, não somados",
    );
    expect(render({ relatorio: relatorio({ freteACombinar: 0 }) })).not.toContain("frete a combinar");
  });

  it("itens: vazio mostra 'Nenhuma venda no período.' e a nota do desconto", () => {
    const html = render();
    expect(html).toContain("Nenhuma venda no período.");
    expect(html).toContain("O desconto é do pedido e não é dividido entre os itens.");
  });

  it("RN-V23: falha mostra só a mensagem genérica, sem números nem ciclo", () => {
    const html = render({ relatorio: { ok: false } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Não foi possível carregar o relatório. Tente de novo.");
    expect(html).not.toContain("Faturamento");
    expect(html).not.toContain("Ciclo atual:");
    // Os avisos e os filtros continuam (a página não quebra).
    expect(html).toContain("Este relatório cobre só as vendas feitas pelo iRango.");
    expect(hrefs(html)).toContain(`${BASE}?periodo=semana`);
  });

  it("RN-V18: presets preservam entrega, concluídos e o ranking; entrega preserva o período", () => {
    const html = render({
      filtros: { ...FILTROS_PADRAO, entrega: "retirada", concluidos: true },
      ranking: { periodo: "tudo", ordem: "total" },
    });
    const h = hrefs(html);
    expect(h).toContain(`${BASE}?periodo=semana&entrega=retirada&concluidos=1&ranking=tudo&ordem=total`);
    expect(h).toContain(`${BASE}?entrega=entrega&concluidos=1&ranking=tudo&ordem=total`);
    // "Só concluídos" ligado → o link desliga, mantendo o resto.
    expect(h).toContain(`${BASE}?entrega=retirada&ranking=tudo&ordem=total`);
  });

  it("admin (ranking null): nenhum link carrega parâmetro de ranking", () => {
    const base = "/admin/assinantes/L1/vendas";
    const html = render({ baseVendas: base, ranking: null });
    const h = hrefs(html).filter((x) => x.startsWith(base));
    expect(h.length).toBeGreaterThan(0);
    for (const x of h) expect(x).not.toMatch(/ranking=|ordem=/);
  });

  it("form personalizado: GET na base, com os demais filtros em campos ocultos", () => {
    const html = render({ filtros: { ...FILTROS_PADRAO, entrega: "entrega" }, ranking: { periodo: "ano", ordem: "pedidos" } });
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain(`action="${BASE}"`);
    expect(html).toMatch(/<input[^>]*name="de"[^>]*type="date"|<input[^>]*type="date"[^>]*name="de"/);
    expect(html).toMatch(/<input[^>]*name="ate"[^>]*type="date"|<input[^>]*type="date"[^>]*name="ate"/);
    expect(html).toContain('<input type="hidden" name="periodo" value="personalizado"/>');
    expect(html).toContain('<input type="hidden" name="entrega" value="entrega"/>');
    expect(html).toContain('<input type="hidden" name="ranking" value="ano"/>');
    expect(html).not.toContain('name="ordem"');
  });

  it("preset ativo marcado com aria-current", () => {
    const html = render({ filtros: { ...FILTROS_PADRAO, periodo: "semana" } });
    expect(html).toMatch(/<a[^>]*aria-current="true"[^>]*href="\/painel\/vendas\?periodo=semana"/);
  });

  it("aviso de filtro inválido só quando avisoFiltros", () => {
    const texto = "Filtro inválido no endereço. Mostrando o ciclo atual.";
    expect(render()).not.toContain(texto);
    expect(render({ avisoFiltros: true })).toContain(texto);
  });
});
