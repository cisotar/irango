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
import { ComandaCozinha } from "@/components/painel/ComandaCozinha";
import { TabelaPedidos, type PedidoLinha } from "@/components/painel/TabelaPedidos";
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

// ═══════════════════════════════════════════════════════════════════════════
// Spec `specs/modalidades-entrega-loja.md`, fatia D (fase RED).
//
// "Pedido de retirada mostra RETIRADA em destaque na lista, no detalhe, na
// comanda e no recibo, no lugar de 'Sem endereço de entrega.'", e o frete a
// combinar nunca vira "Grátis"/"R$ 0,00" — nem antes, nem depois do registro.
//
// As quatro superfícies do LOJISTA renderizáveis em `environment: node`:
// DetalhePedido, ComandaCozinha, ReciboCliente e TabelaPedidos (a lista).
// Comanda e recibo JÁ imprimem "Retirada" via ROTULO_TIPO_ENTREGA: aqui são
// travas de regressão. Detalhe e lista são o RED.
// ═══════════════════════════════════════════════════════════════════════════

function pedidoRetirada(): PedidoComItens {
  return {
    ...pedido(),
    tipo_entrega: "retirada",
    endereco_entrega: null,
    taxa_entrega: 0,
    frete_a_combinar: false,
    total: 90,
  } as unknown as PedidoComItens;
}

/** Entrega a combinar: taxa NULL + flag (o par do CHECK chk_pedidos_frete_a_combinar). */
function pedidoACombinar(over: Record<string, unknown> = {}): PedidoComItens {
  return {
    ...pedido(),
    tipo_entrega: "entrega",
    endereco_entrega: { rua: "Rua X", numero: "10", bairro: "Centro", cep: "01000-000" },
    taxa_entrega: null,
    frete_a_combinar: true,
    subtotal: 90,
    desconto: 0,
    total: 90,
    ...over,
  } as unknown as PedidoComItens;
}

function htmlComanda(p: PedidoComItens): string {
  return norm(renderToStaticMarkup(<ComandaCozinha pedido={p} />));
}

const LINHA_BASE = {
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  nome_cliente: "Fulano de Teste",
  total: 90,
  status: "pendente",
  criado_em: "2026-07-07T17:32:00Z",
} as const;

function htmlLista(tipo: "retirada" | "entrega"): string {
  // `tipo_entrega` ainda não faz parte de `PedidoLinha` (o GREEN acrescenta).
  const linha = { ...LINHA_BASE, tipo_entrega: tipo } as unknown as PedidoLinha;
  return norm(renderToStaticMarkup(<TabelaPedidos pedidos={[linha]} />));
}

describe("[modalidades · D] pedido de RETIRADA aparece como retirada nas superfícies do lojista", () => {
  it("DetalhePedido: mostra 'Retirada' no lugar de 'Sem endereço de entrega.'", () => {
    const html = htmlDetalhe(pedidoRetirada());
    expect(html).toMatch(/retirada/i);
    expect(html).not.toContain("Sem endereço de entrega");
  });

  it("ComandaCozinha: mostra 'Retirada' e nenhum bloco de endereço vazio", () => {
    const html = htmlComanda(pedidoRetirada());
    expect(html).toMatch(/retirada/i);
    expect(html).not.toContain("Sem endereço");
    expect(html).not.toContain("Bairro:");
  });

  it("ReciboCliente: mostra 'Retirada' e nenhum bloco de endereço vazio", () => {
    const html = htmlRecibo(pedidoRetirada());
    expect(html).toMatch(/retirada/i);
    expect(html).not.toContain("Sem endereço");
  });

  it("TabelaPedidos (lista): linha de retirada é marcada como retirada", () => {
    expect(htmlLista("retirada")).toMatch(/retirada/i);
  });

  it("TabelaPedidos (lista): linha de ENTREGA não ganha o selo de retirada", () => {
    expect(htmlLista("entrega")).not.toMatch(/retirada/i);
  });

  it("DetalhePedido: pedido de ENTREGA continua mostrando o endereço (sem o rótulo de retirada no lugar)", () => {
    const html = htmlDetalhe(pedidoACombinar({ frete_a_combinar: false, taxa_entrega: 5, total: 95 }));
    expect(html).toContain("Rua X, 10");
    expect(html).not.toContain("Sem endereço de entrega");
  });
});

describe("[modalidades · D] frete a combinar nunca vira 'Grátis' nem 'R$ 0,00'", () => {
  it("DetalhePedido: pedido a combinar mostra 'A combinar' na taxa, nunca R$ 0,00 nem Grátis", () => {
    const html = htmlDetalhe(pedidoACombinar());
    expect(html).toContain("A combinar");
    expect(html).not.toContain("R$ 0,00");
    expect(html).not.toMatch(/gr[aá]tis/i);
  });

  it("ReciboCliente: pedido a combinar mostra 'A combinar', nunca R$ 0,00 nem Grátis", () => {
    const html = htmlRecibo(pedidoACombinar());
    expect(html).toContain("A combinar");
    expect(html).not.toContain("R$ 0,00");
    expect(html).not.toMatch(/gr[aá]tis/i);
  });

  it("após o registro com valor 0: DetalhePedido mostra R$ 0,00 (valor), não 'A combinar'", () => {
    const html = htmlDetalhe(pedidoACombinar({ frete_a_combinar: false, taxa_entrega: 0 }));
    expect(html).toContain("R$ 0,00");
    expect(html).not.toContain("A combinar");
  });

  it("após o registro com valor 0: ReciboCliente mostra R$ 0,00 (valor), não 'A combinar'", () => {
    const html = htmlRecibo(pedidoACombinar({ frete_a_combinar: false, taxa_entrega: 0 }));
    expect(html).toContain("R$ 0,00");
    expect(html).not.toContain("A combinar");
  });

  it("após o registro com valor 7 (subtotal 90): detalhe e recibo mostram R$ 7,00 e o total R$ 97,00", () => {
    const registrado = pedidoACombinar({ frete_a_combinar: false, taxa_entrega: 7, total: 97 });
    for (const html of [htmlDetalhe(registrado), htmlRecibo(registrado)]) {
      expect(html).toContain("R$ 7,00");
      expect(html).toContain("R$ 97,00");
      expect(html).not.toContain("A combinar");
    }
  });
});
