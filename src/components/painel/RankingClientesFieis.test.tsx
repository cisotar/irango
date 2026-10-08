/**
 * Issue 358 — clientes fiéis (RN-V17..V20), só no painel.
 * Ambiente node, sem jsdom: renderToStaticMarkup. Dados fictícios.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RankingClientesFieis } from "./RankingClientesFieis";
import { FILTROS_PADRAO, RANKING_PADRAO, type FiltrosRanking } from "@/lib/validacoes/vendas";
import type { ClienteRanking, ResultadoRanking } from "@/lib/vendas/carregarRankingClientes";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

const BASE = "/painel/vendas";

const cliente = (id: string, nome: string, over: Partial<ClienteRanking> = {}): ClienteRanking => ({
  clienteId: id,
  nome,
  totalPedidos: 2,
  totalGasto: 300,
  ultimoPedidoEm: "2026-10-07T12:00:00+00:00",
  itensTop: [{ nome: "Pizza", quantidade: 2 }],
  ...over,
});

function render(resultado: ResultadoRanking, ranking: FiltrosRanking = RANKING_PADRAO): string {
  return renderToStaticMarkup(
    <RankingClientesFieis
      baseVendas={BASE}
      filtros={{ ...FILTROS_PADRAO, entrega: "retirada" }}
      ranking={ranking}
      resultado={resultado}
      timezone="America/Sao_Paulo"
    />,
  );
}

const ok = (clientes: ClienteRanking[], convidados = 0): ResultadoRanking => ({
  ok: true,
  rotuloPeriodo: "05/out a 04/nov",
  clientes,
  convidados,
});

const hrefs = (html: string) =>
  [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("RankingClientesFieis (358)", () => {
  it("linhas na ordem recebida (sem reordenar), com métricas e itens", () => {
    const html = render(
      ok([
        cliente("b", "Cliente Bê", { totalPedidos: 2, totalGasto: 300 }),
        cliente("a", "Cliente Á", { totalPedidos: 5, totalGasto: 100, itensTop: [{ nome: "Coca", quantidade: 5 }, { nome: "X-Burger", quantidade: 3 }] }),
      ]),
    );
    expect(html.indexOf("Cliente Bê")).toBeLessThan(html.indexOf("Cliente Á"));
    expect(html).toContain(formatarMoeda(300));
    expect(html).toContain("5× Coca, 3× X-Burger");
    expect(html).toContain("07/10/2026 09:00");
  });

  it("RN-V17: aviso de convidados no plural e no singular; ausente com zero", () => {
    expect(render(ok([], 3))).toContain("3 pedidos de convidados fora do ranking");
    expect(render(ok([], 1))).toContain("1 pedido de convidado fora do ranking");
    expect(render(ok([], 0))).not.toContain("fora do ranking");
  });

  it("vazio → mensagem de lista vazia", () => {
    expect(render(ok([]))).toContain("Nenhum cliente com conta comprou no período.");
  });

  it("RN-V20: markup sem telefone nem e-mail", () => {
    // Sem os atributos de classe (Tailwind usa "@container"): só texto e dados.
    const html = render(ok([cliente("a", "Cliente A")])).replace(/class="[^"]*"/g, "");
    expect(html).not.toMatch(/telefone|e-mail|email|@/i);
  });

  it("falha → mensagem genérica, sem tabela", () => {
    const html = render({ ok: false });
    expect(html).toContain("Não foi possível carregar os clientes fiéis. Tente de novo.");
    expect(html).not.toContain("<table");
  });

  it("RN-V18: links de período e ordem preservam os filtros globais", () => {
    const h = hrefs(render(ok([]), { periodo: "ano", ordem: "pedidos" }));
    expect(h).toContain(`${BASE}?entrega=retirada&ranking=tudo`);
    expect(h).toContain(`${BASE}?entrega=retirada&ranking=ano&ordem=total`);
    // Mês é o padrão do ranking: o parâmetro some, os filtros ficam.
    expect(h).toContain(`${BASE}?entrega=retirada`);
  });
});
