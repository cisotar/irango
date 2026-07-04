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
