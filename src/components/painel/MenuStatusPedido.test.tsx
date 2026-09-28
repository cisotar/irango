/**
 * Testes do MenuStatusPedido (issue 329 — selo de status clicável nas listas do
 * painel e do hub admin, spec páginas 1, 2, 4 e 5).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia: renderToStaticMarkup
 * (react-dom/server), padrão do projeto (AcoesStatus.test.tsx, TabelaPedidos.test.tsx).
 *
 * Confirmado por inspeção direta do markup (sem jsdom) antes de escrever as
 * asserções: em status terminal o componente devolve só `BadgeStatusPedido`
 * (nenhum `<button`); em status aberto, o `MenuTrigger` é um `<button
 * aria-haspopup="menu">` com o `aria-label` e o chevron. Os itens do
 * `MenuPopup` vivem num `MenuPortal` — no render estático (sem DOM real para o
 * portal), eles NÃO aparecem no HTML gerado; por isso os rótulos das ações são
 * cobertos pela função pura `acoesDisponiveis` (acoesStatusPedido.test.ts) e,
 * onde a marcação é a mesma lista de botões, por `AcoesStatus.test.tsx`.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MenuStatusPedido } from "@/components/painel/MenuStatusPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

const PEDIDO_ID = "abcdef12-3456-7890-abcd-ef1234567890";

function render(status: StatusPedido, tipoEntrega: string | null = "entrega") {
  return renderToStaticMarkup(
    <MenuStatusPedido pedidoId={PEDIDO_ID} status={status} tipoEntrega={tipoEntrega} />,
  );
}

describe("MenuStatusPedido — status terminal: selo estático, sem gatilho", () => {
  it.each<StatusPedido>(["entregue", "cancelado"])(
    "%s não renderiza <button> nem aria-haspopup — o selo não é clicável",
    (status) => {
      const html = render(status);
      expect(html).not.toContain("<button");
      expect(html).not.toContain("aria-haspopup");
      expect(html).not.toContain("lucide-chevron-down");
    },
  );

  it("entregue ainda mostra o rótulo do status (o cliente vê o selo, só não pode alterá-lo)", () => {
    expect(render("entregue")).toContain("Entregue");
  });
});

describe("MenuStatusPedido — status aberto: gatilho com chevron", () => {
  it.each<StatusPedido>(["pendente", "confirmado", "em_preparo", "saiu_entrega"])(
    "%s renderiza <button aria-haspopup='menu'> com o chevron",
    (status) => {
      const html = render(status);
      expect(html).toContain("<button");
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).toContain("lucide-chevron-down");
    },
  );
});

describe("MenuStatusPedido — aria-label do gatilho", () => {
  it("formato exato: 'Alterar status do pedido #XXXX, atual: <rótulo>'", () => {
    const html = render("pendente");
    expect(html).toContain(
      'aria-label="Alterar status do pedido #ABCDEF12, atual: Pendente"',
    );
  });

  it("usa o rótulo POR MODALIDADE em saiu_entrega+retirada — nunca 'Saiu pra entrega'", () => {
    const html = render("saiu_entrega", "retirada");
    expect(html).toContain(
      'aria-label="Alterar status do pedido #ABCDEF12, atual: Pronto para retirada"',
    );
    expect(html).not.toContain("Saiu pra entrega");
  });

  it("saiu_entrega+entrega usa 'Saiu pra entrega' no aria-label", () => {
    const html = render("saiu_entrega", "entrega");
    expect(html).toContain(
      'aria-label="Alterar status do pedido #ABCDEF12, atual: Saiu pra entrega"',
    );
  });
});

describe("MenuStatusPedido — itens do menu não vazam para fora do portal", () => {
  it("nenhum rótulo de AÇÃO (ex.: 'Confirmar', 'Iniciar preparo') aparece no markup estático", () => {
    // O único texto de status esperado no gatilho é o do PRÓPRIO status atual
    // (via aria-label e badge) — as ações do menu vivem no MenuPortal.
    const html = render("pendente");
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Iniciar preparo");
  });
});
