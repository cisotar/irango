/**
 * Testes do DashboardLoja (issue 122 — extração do dashboard inline do painel).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (TabelaPedidos.test.tsx, ThumbProduto.test.tsx).
 *
 * Foco: travar a regressão real da extração — métricas derivadas corretas, o
 * link "Ver todos" e os hrefs das linhas dirigidos por `basePedidos` (default
 * e admin), e o corte em 20 recentes.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardLoja } from "@/components/painel/DashboardLoja";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

const HOJE = new Date().toISOString();

function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    nome_cliente: "Fulano de Teste",
    total: 4200,
    status: "pendente",
    criado_em: HOJE,
    ...over,
  } as PedidoComItens;
}

function render(
  props: Partial<Parameters<typeof DashboardLoja>[0]> = {},
): string {
  return renderToStaticMarkup(
    <DashboardLoja pedidos={props.pedidos ?? [pedido()]} basePedidos={props.basePedidos} />,
  );
}

describe("DashboardLoja métricas", () => {
  it("renderiza os três rótulos de métrica", () => {
    const html = render();
    expect(html).toContain("Pedidos hoje");
    expect(html).toContain("Pendentes");
    expect(html).toContain("Total do dia");
  });

  it("deriva os valores de métrica dos pedidos crus (calcularMetricasDoDia)", () => {
    const html = render({
      pedidos: [
        pedido({ id: "11111111-1111-1111-1111-111111111111", total: 1000 }),
        pedido({ id: "22222222-2222-2222-2222-222222222222", total: 2000 }),
      ],
    });
    // 2 pedidos hoje, ambos pendentes, total = 3000 formatado.
    expect(html).toContain(formatarMoeda(3000));
  });

  it("ignora cancelados no total do dia", () => {
    const html = render({
      pedidos: [
        pedido({ id: "11111111-1111-1111-1111-111111111111", total: 1000 }),
        pedido({
          id: "22222222-2222-2222-2222-222222222222",
          total: 9999,
          status: "cancelado",
        }),
      ],
    });
    // O total do CANCELADO ainda aparece na sua linha da tabela; o que não
    // pode é somar à métrica "Total do dia". Escopamos ao card de métrica
    // (parágrafo `text-2xl`), que deve mostrar só os 1000 não-cancelados.
    const metrica = `text-2xl font-bold text-foreground">`;
    expect(html).toContain(`${metrica}${formatarMoeda(1000)}</p>`);
    expect(html).not.toContain(`${metrica}${formatarMoeda(9999)}</p>`);
  });
});

describe("DashboardLoja links", () => {
  it("sem basePedidos: 'Ver todos' e linhas apontam para /painel/pedidos (default)", () => {
    const html = render();
    expect(html).toContain('href="/painel/pedidos"');
    // Linhas da tabela (desktop + mobile) usam o mesmo prefixo.
    const linhas = html.match(
      /href="\/painel\/pedidos\/abcdef12-3456-7890-abcd-ef1234567890"/g,
    );
    expect(linhas).toHaveLength(2);
    expect(html).not.toContain("/admin/");
  });

  it("com basePedidos admin: 'Ver todos' e linhas reapontam sem cópia de markup", () => {
    const html = render({ basePedidos: "/admin/assinantes/L1/pedidos" });
    expect(html).toContain('href="/admin/assinantes/L1/pedidos"');
    const linhas = html.match(
      /href="\/admin\/assinantes\/L1\/pedidos\/abcdef12-3456-7890-abcd-ef1234567890"/g,
    );
    expect(linhas).toHaveLength(2);
    expect(html).not.toContain('href="/painel/pedidos"');
  });
});

describe("DashboardLoja recentes", () => {
  it("corta em no máximo 20 linhas (slice 0,20)", () => {
    const pedidos = Array.from({ length: 25 }, (_, i) =>
      pedido({ id: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000` }),
    );
    const html = render({ pedidos });
    // Cada pedido renderiza duas linhas de link (desktop + mobile).
    const linhas = html.match(/href="\/painel\/pedidos\/[^"]+"/g) ?? [];
    // 20 recentes * 2 breakpoints = 40; +1 do "Ver todos" (sem id).
    const comId = linhas.filter((l) => /pedidos\/\d{8}-/.test(l));
    expect(comId).toHaveLength(40);
  });

  it("lista vazia: estado vazio da tabela, métricas zeradas", () => {
    const html = render({ pedidos: [] });
    expect(html).toContain("Nenhum pedido ainda");
    expect(html).toContain(formatarMoeda(0));
  });
});
