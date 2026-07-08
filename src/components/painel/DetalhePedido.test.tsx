/**
 * Testes do DetalhePedido (issue 125 — extração do detalhe inline do painel
 * para componente compartilhado painel/admin).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (DashboardLoja.test.tsx, TabelaPedidos.test.tsx).
 *
 * Foco: travar a regressão da extração — cabeçalho/badge, o link "Voltar"
 * dirigido por `basePedidos` (default e admin), itens/totais formatados via
 * snapshot autoritativo, e os fallbacks de endereço/forma de pagamento.
 * Limitação: o disparo de `acaoStatus` (client em `AcoesStatus`) não é
 * observável em `renderToStaticMarkup`; a fiação é garantida por tipo.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// DetalhePedido renderiza AcoesStatus (client), que chama useRouter() no topo;
// SSR estático não tem App Router montado. Mock idêntico ao de AcoesStatus.test
// — infra de render, sem relação com o que estes testes cobrem.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DetalhePedido } from "@/components/painel/DetalhePedido";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { VarianteImpressao } from "@/lib/utils/variantesHabilitadas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

// Token de acesso do pedido — SEGREDO que jamais pode vazar no markup renderizado
// (invariante do detalhe; leitura sem login só com id + este token). Valor
// distintivo, improvável de colidir com qualquer outra string do DOM, para a
// asserção negativa da issue 135 (caso 5).
const TOKEN_ACESSO_SECRETO = "tok-3f9c1a2b-NUNCA-NO-DOM";

function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: "(11) 90000-0000",
    status: "pendente",
    subtotal: 3000,
    desconto: 0,
    cupom_codigo: null,
    taxa_entrega: 500,
    total: 3500,
    forma_pagamento: "pix",
    observacoes: null,
    endereco_entrega: null,
    // Campos exigidos pelos blocos de impressão (ComandaCozinha/ReciboCliente)
    // quando o gate os monta (GREEN): `criado_em` alimenta formatarDataHora,
    // `tipo_entrega`/`troco_para` completam o snapshot. `token_acesso` fica no
    // objeto mas NUNCA deve ser renderizado (caso 5).
    token_acesso: TOKEN_ACESSO_SECRETO,
    criado_em: "2026-07-07T17:32:00Z",
    tipo_entrega: "retirada",
    troco_para: null,
    itens_pedido: [
      {
        id: "item-1",
        nome: "X-Salada",
        preco: 1500,
        quantidade: 2,
      },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

// Contrato-alvo da issue 135 (GREEN): a assinatura passa a incluir
// `modulosImpressao: VarianteImpressao[]` (decidida no servidor) e `nomeLoja`
// (exigido por ReciboCliente). O tipo atual do componente ainda NÃO declara
// essas props — sob vitest/esbuild o type-check é ignorado e o teste RODA (o
// componente atual só ignora props extras); `next build`/tsc passam a exigir as
// props depois que o executar as adicionar.
type PropsDetalhe = {
  pedido?: PedidoComItens;
  basePedidos?: string;
  modulosImpressao?: VarianteImpressao[];
  nomeLoja?: string;
};

function render(props: PropsDetalhe = {}): string {
  return renderToStaticMarkup(
    <DetalhePedido
      pedido={props.pedido ?? pedido()}
      basePedidos={props.basePedidos}
      modulosImpressao={props.modulosImpressao ?? []}
      nomeLoja={props.nomeLoja ?? "Loja Teste"}
    />,
  );
}

describe("DetalhePedido cabeçalho", () => {
  it("mostra 'Pedido #' com os 8 primeiros chars do id em maiúsculas", () => {
    const html = render();
    expect(html).toContain("Pedido #ABCDEF12");
  });

  it("renderiza o badge com o rótulo de APARENCIA_STATUS", () => {
    expect(render()).toContain("Pendente");
    expect(render({ pedido: pedido({ status: "entregue" }) })).toContain(
      "Entregue",
    );
  });
});

describe("DetalhePedido link Voltar", () => {
  it("sem basePedidos: aponta para /painel/pedidos (default)", () => {
    const html = render();
    expect(html).toContain('href="/painel/pedidos"');
    expect(html).not.toContain("/admin/");
  });

  it("com basePedidos admin: reaponta sem cópia de markup", () => {
    const html = render({ basePedidos: "/admin/assinantes/L1/pedidos" });
    expect(html).toContain('href="/admin/assinantes/L1/pedidos"');
    expect(html).not.toContain('href="/painel/pedidos"');
  });
});

describe("DetalhePedido itens e totais", () => {
  it("cada item exibe quantidade, nome e preço*quantidade formatado", () => {
    const html = render();
    expect(html).toContain("2×");
    expect(html).toContain("X-Salada");
    // preço 1500 * quantidade 2 = 3000 (snapshot, não recálculo do produto).
    expect(html).toContain(formatarMoeda(3000));
  });

  it("subtotal, taxa e total formatados", () => {
    const html = render();
    expect(html).toContain(formatarMoeda(3000)); // subtotal
    expect(html).toContain(formatarMoeda(500)); // taxa
    expect(html).toContain(formatarMoeda(3500)); // total
  });

  it("desconto some quando 0", () => {
    expect(render()).not.toContain("Desconto");
  });

  it("desconto aparece com cupom_codigo quando > 0", () => {
    const html = render({
      pedido: pedido({ desconto: 500, cupom_codigo: "PROMO10" }),
    });
    expect(html).toContain("Desconto (PROMO10)");
    expect(html).toContain(formatarMoeda(500));
  });
});

describe("DetalhePedido fallbacks", () => {
  it("endereço nulo → 'Sem endereço de entrega.'", () => {
    expect(render()).toContain("Sem endereço de entrega.");
  });

  it("forma_pagamento fora do mapa cai no valor cru", () => {
    const html = render({
      pedido: pedido({ forma_pagamento: "boleto" as never }),
    });
    expect(html).toContain("boleto");
  });
});

describe("DetalhePedido bordas", () => {
  it("pedido sem itens: lista fica vazia mas totais continuam exibidos", () => {
    const html = render({ pedido: pedido({ itens_pedido: [] }) });
    expect(html).not.toContain("X-Salada");
    // sem <li> de item — só a estrutura de totais permanece.
    expect(html).not.toMatch(/<li/);
    expect(html).toContain(formatarMoeda(3000)); // subtotal do snapshot
    expect(html).toContain(formatarMoeda(3500)); // total do snapshot
  });

  it("status fora de APARENCIA_STATUS: badge omitido e AcoesStatus não quebra (transicaoPermitida com fallback)", () => {
    // Ambos os guards seguram um status desconhecido no banco (ou digitado
    // errado): DetalhePedido omite o badge (`aparencia &&`) e
    // `transicaoPermitida` retorna `false` via `TRANSICOES[de] ?? []` em vez
    // de lançar `Cannot read properties of undefined`.
    const html = render({
      pedido: pedido({
        status: "em_transito" as unknown as PedidoComItens["status"],
      }),
    });
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Iniciar preparo");
  });

  it("endereço como array: lerEndereco descarta e cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: ["rua", "numero"] as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).toContain("Sem endereço de entrega.");
  });

  it("endereço como string: lerEndereco descarta e cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: "Rua Teste, 123" as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).toContain("Sem endereço de entrega.");
  });

  it("endereço objeto válido: renderiza campos e não cai no fallback", () => {
    const html = render({
      pedido: pedido({
        endereco_entrega: {
          rua: "Rua das Flores",
          numero: "42",
          bairro: "Centro",
          cidade: "São Paulo",
          cep: "01000-000",
        } as unknown as PedidoComItens["endereco_entrega"],
      }),
    });
    expect(html).not.toContain("Sem endereço de entrega.");
    expect(html).toContain("Rua das Flores");
    expect(html).toContain("42");
    expect(html).toContain("CEP 01000-000");
  });
});

// Marcadores de texto LITERAIS que cada bloco renderiza. `renderToStaticMarkup`
// NÃO aplica o CSS `uppercase`, então o texto sai exatamente como no componente
// (com em-dash U+2014, não hífen). O executar (GREEN) deve preservar esses
// literais nos componentes montados, ou o gate deixa de ser observável no teste:
//   - ComandaCozinha → "Comanda — Cozinha"          (ComandaCozinha.tsx, título)
//   - ReciboCliente  → "Documento sem valor fiscal"  (rodapé não-fiscal RN-P6)
//   - Seletor 1 var. → "Via da cozinha" / "Recibo do cliente" (botão direto)
//   - Seletor 2+ var.→ "Imprimir" (MenuTrigger; os itens ficam no portal, que
//     NÃO sai no markup estático — por isso não asserto rótulos dentro do menu).
const MARCADOR_COMANDA = "Comanda — Cozinha";
const MARCADOR_RECIBO = "Documento sem valor fiscal";

describe("DetalhePedido gate de módulos de impressão (RN-M1)", () => {
  it("modulosImpressao=[] → sem seletor e SEM comanda/recibo no DOM (gate fechado)", () => {
    const html = render({ modulosImpressao: [] });
    // Nada habilitado: nenhum bloco de impressão montado, nenhum seletor.
    expect(html).not.toContain("Imprimir");
    expect(html).not.toContain(MARCADOR_COMANDA);
    expect(html).not.toContain(MARCADOR_RECIBO);
  });

  it("modulosImpressao=['cozinha'] → comanda + seletor no DOM; recibo AUSENTE", () => {
    const html = render({ modulosImpressao: ["cozinha"] });
    expect(html).toContain(MARCADOR_COMANDA); // bloco cozinha montado
    expect(html).toContain("Via da cozinha"); // seletor (1 variante) presente
    expect(html).not.toContain(MARCADOR_RECIBO); // recibo NÃO habilitado → fora do DOM
  });

  it("modulosImpressao=['recibo'] → recibo + seletor no DOM; comanda AUSENTE", () => {
    const html = render({ modulosImpressao: ["recibo"] });
    expect(html).toContain(MARCADOR_RECIBO); // bloco recibo montado
    expect(html).toContain("Recibo do cliente"); // seletor (1 variante) presente
    expect(html).not.toContain(MARCADOR_COMANDA); // comanda NÃO habilitada → fora do DOM
  });

  it("modulosImpressao=['a4'] → só seletor com 'Comum (A4)'; comanda e recibo AUSENTES", () => {
    // Combinação real do domínio (RN-M2): só Módulo A habilitado, sem Módulo B
    // (térmica). Isola o branch "a4" do seletor (rótulo próprio, sem overlap
    // com os literais de cozinha/recibo) e prova que nenhum dos dois blocos
    // térmicos é montado quando SÓ a4 está na lista.
    const html = render({ modulosImpressao: ["a4"] });
    expect(html).toContain("Comum (A4)"); // seletor (1 variante) presente
    expect(html).not.toContain(MARCADOR_COMANDA);
    expect(html).not.toContain(MARCADOR_RECIBO);
    expect(html).not.toContain("Via da cozinha");
    expect(html).not.toContain("Recibo do cliente");
  });

  it("modulosImpressao=['a4','cozinha','recibo'] → comanda + recibo + seletor no DOM", () => {
    const html = render({ modulosImpressao: ["a4", "cozinha", "recibo"] });
    expect(html).toContain(MARCADOR_COMANDA);
    expect(html).toContain(MARCADOR_RECIBO);
    expect(html).toContain("Imprimir"); // seletor (2+ variantes) → trigger de menu
  });

  it("token_acesso NUNCA aparece no markup, em qualquer combinação de módulos", () => {
    const combinacoes: VarianteImpressao[][] = [
      [],
      ["cozinha"],
      ["recibo"],
      ["a4", "cozinha", "recibo"],
    ];
    for (const modulosImpressao of combinacoes) {
      const html = render({ modulosImpressao });
      expect(html).not.toContain(TOKEN_ACESSO_SECRETO);
    }
  });
});
