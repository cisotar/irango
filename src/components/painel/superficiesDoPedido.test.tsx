/**
 * Trava cross-superfície de RN-20 + RN-14 (issue 239).
 *
 * Existe porque o defeito de D15 nasceu de QUATRO cópias independentes da mesma
 * aritmética: consertar uma tela e deixar as outras é exatamente o que criou o
 * problema. Este arquivo afirma o MESMO cenário nas superfícies renderizáveis
 * em `environment: node` — `DetalhePedido`, `ReciboCliente` e `whatsappPedido`.
 * A quarta (a página de confirmação da vitrine) é um Server Component async com
 * I/O por token e não é montável aqui; ela consome exatamente as mesmas duas
 * funções (`totalDaLinha` + `textoDePor`), sem fórmula própria — garantido pelo
 * grep de aceite da issue.
 *
 * Cenário canônico de RN-20: 2× Pizza de R$ 50,00 + 1 borda de R$ 10,00.
 *   cobrado  (calcularSubtotal): (50 × 2) + 10 = R$ 110,00  ✓
 *   fórmula antiga:              (50 + 10) × 2 = R$ 120,00  ✗
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// DetalhePedido monta AcoesStatus (client), que chama useRouter() no topo; SSR
// estático não tem App Router montado. Mock idêntico ao de DetalhePedido.test —
// infra de render, sem relação com o que este arquivo cobre.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DetalhePedido } from "@/components/painel/DetalhePedido";
import { ReciboCliente } from "@/components/painel/ReciboCliente";
import { montarLinkWhatsappPedido } from "@/lib/utils/whatsappPedido";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";

// O Intl usa U+00A0 entre "R$" e o número; normalizamos nas asserções.
const norm = (s: string) => s.replace(/ |&#x27;|&nbsp;/g, " ");

const ITEM_PIZZA = {
  id: "item-1",
  nome: "Pizza",
  preco: 40,
  preco_original: 50,
  quantidade: 2,
  observacao: null,
  itens_pedido_opcionais: [
    {
      id: "op-1",
      nome_snapshot: "Borda recheada",
      preco_snapshot: 10,
      quantidade: 1,
    },
  ],
};

function pedido(item: object = ITEM_PIZZA): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    loja_id: "loja-1",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: "(11) 90000-0000",
    status: "pendente",
    tipo_entrega: "entrega",
    subtotal: 90,
    desconto: 0,
    cupom_codigo: null,
    taxa_entrega: 0,
    total: 90,
    troco_para: null,
    forma_pagamento: "pix",
    observacoes: null,
    criado_em: "2026-07-07T17:32:00Z",
    token_acesso: "11111111-2222-3333-4444-555555555555",
    endereco_entrega: { bairro: "Centro" },
    itens_pedido: [item],
  } as unknown as PedidoComItens;
}

function htmlDetalhe(p: PedidoComItens = pedido()): string {
  return norm(renderToStaticMarkup(<DetalhePedido pedido={p} />));
}

function htmlRecibo(p: PedidoComItens = pedido()): string {
  return norm(
    renderToStaticMarkup(<ReciboCliente pedido={p} nomeLoja="Cantina" />),
  );
}

function textoWhatsapp(p: PedidoComItens = pedido()): string {
  const link = montarLinkWhatsappPedido(p, {
    nome: "Cantina",
    whatsapp: "11999999999",
  });
  const texto = new URL(link!.href).searchParams.get("text") ?? "";
  return norm(texto);
}

describe("[239/RN-20] o total da linha exibido é o total COBRADO", () => {
  it("o cenário de RN-20 realmente cobra R$ 110,00 (não R$ 120,00)", () => {
    // Âncora: se `totalDaLinha`/`calcularSubtotal` mudarem, este teste muda com
    // elas — as telas nunca têm uma segunda fórmula própria.
    expect(
      calcularSubtotal([
        { preco: 50, quantidade: 2, opcionais: [{ preco: 10, quantidade: 1 }] },
      ]),
    ).toBe(110);
  });

  it("DetalhePedido imprime o total cobrado da linha", () => {
    const item = { ...ITEM_PIZZA, preco: 50, preco_original: null };
    expect(htmlDetalhe(pedido(item))).toContain("R$ 110,00");
    expect(htmlDetalhe(pedido(item))).not.toContain("R$ 120,00");
  });

  it("ReciboCliente imprime o total cobrado da linha", () => {
    const item = { ...ITEM_PIZZA, preco: 50, preco_original: null };
    expect(htmlRecibo(pedido(item))).toContain("R$ 110,00");
    expect(htmlRecibo(pedido(item))).not.toContain("R$ 120,00");
  });

  it("whatsappPedido imprime o total cobrado da linha", () => {
    const item = { ...ITEM_PIZZA, preco: 50, preco_original: null };
    const texto = textoWhatsapp(pedido(item));
    expect(texto).toContain("- 2x Pizza — R$ 110,00");
    expect(texto).not.toContain("R$ 120,00");
  });
});

describe("[239/RN-14] o par de/por é unitário e aparece nas superfícies", () => {
  it("DetalhePedido: par unitário com /un. e total da linha R$ 90,00", () => {
    const html = htmlDetalhe();
    expect(html).toContain("de R$ 50,00 por R$ 40,00/un.");
    expect(html).toContain("R$ 90,00"); // (40 × 2) + 10
  });

  it("ReciboCliente: par unitário com /un. e total da linha R$ 90,00", () => {
    const html = htmlRecibo();
    expect(html).toContain("de R$ 50,00 por R$ 40,00/un.");
    expect(html).toContain("R$ 90,00");
  });

  it("whatsappPedido: par entre PARÊNTESES, nunca ~tachado~", () => {
    const texto = textoWhatsapp();
    expect(texto).toContain(
      "- 2x Pizza — R$ 90,00 (de R$ 50,00 por R$ 40,00/un.)",
    );
    expect(texto).not.toContain("~");
  });

  it("preco_original NULL: nenhuma das superfícies renderiza par nenhum", () => {
    const semPromo = pedido({ ...ITEM_PIZZA, preco: 50, preco_original: null });
    expect(htmlDetalhe(semPromo)).not.toContain("de R$");
    expect(htmlRecibo(semPromo)).not.toContain("de R$");
    expect(textoWhatsapp(semPromo)).not.toContain("(de R$");
  });
});
