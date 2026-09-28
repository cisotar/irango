/**
 * Testes do PedidosClient (issue 123 — parametrização de `basePedidos`).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão de
 * TabelaPedidos.test.tsx.
 *
 * Gap coberto: os testes de TabelaPedidos.test.tsx exercitam o componente
 * DIRETO — nunca provam que `PedidosClient` de fato repassa `basePedidos`
 * adiante (src/app/(painel)/painel/pedidos/PedidosClient.tsx:79). Se essa
 * linha for removida/quebrada, TabelaPedidos cai no próprio default
 * ("/painel/pedidos") e nenhum teste existente notaria — os hrefs
 * continuariam "corretos" para o caso sem prop, mascarando a regressão.
 * Por isso o teste abaixo usa um basePedidos customizado DIFERENTE do
 * default de TabelaPedidos, para que só passe se o valor realmente atravessar
 * o componente.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PedidosClient } from "./PedidosClient";
import type { PedidoLinha } from "@/components/painel/TabelaPedidos";

const PEDIDO: PedidoLinha = {
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  nome_cliente: "Fulano de Teste",
  total: 4200,
  status: "pendente",
  criado_em: "2026-07-03T12:00:00.000Z",
  tipo_entrega: "entrega",
};

describe("PedidosClient repasse de basePedidos", () => {
  it("sem basePedidos, repassa o default do painel para TabelaPedidos", () => {
    const html = renderToStaticMarkup(<PedidosClient pedidos={[PEDIDO]} />);
    const ocorrencias = html.match(
      new RegExp(`href="/painel/pedidos/${PEDIDO.id}"`, "g"),
    );
    expect(ocorrencias).toHaveLength(2); // desktop + mobile
  });

  it("com basePedidos customizado, repassa para TabelaPedidos (não cai no default)", () => {
    const html = renderToStaticMarkup(
      <PedidosClient
        pedidos={[PEDIDO]}
        basePedidos="/admin/assinantes/L1/pedidos"
      />,
    );
    const ocorrenciasAdmin = html.match(
      new RegExp(`href="/admin/assinantes/L1/pedidos/${PEDIDO.id}"`, "g"),
    );
    expect(ocorrenciasAdmin).toHaveLength(2); // desktop + mobile

    // Se o repasse quebrar, TabelaPedidos usa seu próprio default e este
    // href apareceria em vez do admin acima.
    expect(html).not.toContain(`href="/painel/pedidos/${PEDIDO.id}"`);
  });

  it("lista vazia: não crasha e não renderiza nenhum link, mesmo com basePedidos custom", () => {
    const html = renderToStaticMarkup(
      <PedidosClient pedidos={[]} basePedidos="/admin/assinantes/L1/pedidos" />,
    );
    expect(html).toContain("Nenhum pedido ainda");
    expect(html).not.toContain("/admin/assinantes/L1/pedidos/");
  });
});

// ---------------------------------------------------------------------------
// Filtro "A caminho / pronto" (P12, issue 329) — junta saiu_entrega de entrega
// e retirada numa aba só, em vez de duas abas separadas por modalidade.
// ---------------------------------------------------------------------------

describe("PedidosClient — aba de filtro por status", () => {
  it("existe uma aba 'A caminho / pronto' (junta saiu_entrega de entrega e retirada)", () => {
    const html = renderToStaticMarkup(<PedidosClient pedidos={[PEDIDO]} />);
    expect(html).toContain("A caminho / pronto");
  });

  it("NÃO existem abas separadas 'Saiu pra entrega' ou 'Pronto para retirada' (uma aba só para saiu_entrega)", () => {
    const html = renderToStaticMarkup(<PedidosClient pedidos={[PEDIDO]} />);
    expect(html).not.toContain("Saiu pra entrega");
    expect(html).not.toContain("Pronto para retirada");
  });

  it("no estado inicial (filtro 'todos'), só a aba 'Todos' está com aria-selected=true", () => {
    const html = renderToStaticMarkup(<PedidosClient pedidos={[PEDIDO]} />);
    const abasSelecionadas = html.match(/aria-selected="true"[^>]*>([^<]*)</g) ?? [];
    expect(abasSelecionadas).toHaveLength(1);
    expect(abasSelecionadas[0]).toContain("Todos");
  });

  it("a aba 'A caminho / pronto' começa NÃO selecionada", () => {
    const html = renderToStaticMarkup(<PedidosClient pedidos={[PEDIDO]} />);
    const inicioBotao = html.indexOf(">A caminho / pronto<");
    const abreBotao = html.lastIndexOf("<button", inicioBotao);
    const tag = html.slice(abreBotao, inicioBotao);
    expect(tag).toContain('aria-selected="false"');
  });
});
