/**
 * Testes do BadgeStatusPedido (issue 329 — extraído de TabelaPedidos/DetalhePedido
 * para o selo estático e o gatilho do menu (`MenuStatusPedido`) compartilharem
 * cor, ícone e rótulo).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia: renderToStaticMarkup
 * (react-dom/server), padrão do projeto (TabelaPedidos.test.tsx, ThumbProduto.test.tsx).
 *
 * Foco: o ícone (classe `lucide-*`) e o rótulo (fonte única `rotuloStatusPedido`)
 * casam por status × modalidade (RN-SC11); `carregando` troca SEMPRE para o
 * spinner, mesmo em `saiu_entrega`+retirada; status fora do enum não quebra e
 * não renderiza nada (drift de schema/dado legado).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BadgeStatusPedido } from "@/components/painel/BadgeStatusPedido";
import { STATUS_VALIDOS, type StatusPedido } from "@/lib/utils/transicaoStatus";

function iconesDe(html: string): string[] {
  return html.match(/lucide-[a-z-]+/g) ?? [];
}

describe("BadgeStatusPedido — ícone e rótulo por status (sem modalidade)", () => {
  const ICONE_ESPERADO: Record<Exclude<StatusPedido, "saiu_entrega">, string> = {
    pendente: "lucide-clock",
    confirmado: "lucide-check",
    em_preparo: "lucide-chef-hat",
    entregue: "lucide-check-check",
    cancelado: "lucide-x",
  };

  it.each(Object.entries(ICONE_ESPERADO))(
    "%s renderiza o ícone %s e o rótulo do painel",
    (status, icone) => {
      const html = renderToStaticMarkup(
        <BadgeStatusPedido status={status as StatusPedido} tipoEntrega={null} />,
      );
      expect(iconesDe(html)).toEqual([icone]);
    },
  );

  it("confirmado NÃO usa o ícone de pendente nem o de entregue (regressão de mapa errado)", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="confirmado" tipoEntrega={null} />,
    );
    expect(html).not.toContain("lucide-clock");
    expect(html).not.toContain("lucide-check-check");
  });
});

describe("BadgeStatusPedido — saiu_entrega por modalidade (RN-SC11)", () => {
  it("retirada: ícone ShoppingBag + rótulo 'Pronto para retirada', SEM Bike e SEM 'Saiu pra entrega'", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="saiu_entrega" tipoEntrega="retirada" />,
    );
    expect(iconesDe(html)).toEqual(["lucide-shopping-bag"]);
    expect(html).toContain("Pronto para retirada");
    expect(html).not.toContain("Saiu pra entrega");
  });

  it.each(["entrega", null, "", "drone"])(
    "tipoEntrega %j: ícone Bike + rótulo 'Saiu pra entrega' (default seguro)",
    (tipo) => {
      const html = renderToStaticMarkup(
        <BadgeStatusPedido status="saiu_entrega" tipoEntrega={tipo} />,
      );
      expect(iconesDe(html)).toEqual(["lucide-bike"]);
      expect(html).toContain("Saiu pra entrega");
      expect(html).not.toContain("Pronto para retirada");
    },
  );
});

describe("BadgeStatusPedido — carregando (preview otimista)", () => {
  it("troca o ícone para o spinner (Loader2) mesmo em pendente", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="pendente" tipoEntrega={null} carregando />,
    );
    expect(iconesDe(html)).toEqual(["lucide-loader-circle"]);
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("lucide-clock");
  });

  it("troca o ícone para o spinner mesmo em saiu_entrega+retirada (não mostra ShoppingBag)", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="saiu_entrega" tipoEntrega="retirada" carregando />,
    );
    expect(iconesDe(html)).toEqual(["lucide-loader-circle"]);
    // O rótulo textual continua o de retirada — só o ícone muda.
    expect(html).toContain("Pronto para retirada");
    expect(html).not.toContain("lucide-shopping-bag");
  });

  it("sem carregando (default), não anima nem usa o spinner", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="pendente" tipoEntrega={null} />,
    );
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("lucide-loader-circle");
  });
});

describe("BadgeStatusPedido — bordas", () => {
  it("status fora do enum: não renderiza nada (nem badge vazio)", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status={"em_transito" as unknown as StatusPedido} tipoEntrega={null} />,
    );
    expect(html).toBe("");
  });

  it("todo STATUS_VALIDOS renderiza uma badge não-vazia (cobertura exaustiva de APARENCIA_STATUS)", () => {
    for (const status of STATUS_VALIDOS) {
      const html = renderToStaticMarkup(
        <BadgeStatusPedido status={status} tipoEntrega={null} />,
      );
      expect(html).not.toBe("");
    }
  });

  it("children (ex.: chevron do gatilho) entram DEPOIS do rótulo, não antes", () => {
    const html = renderToStaticMarkup(
      <BadgeStatusPedido status="pendente" tipoEntrega={null}>
        <span data-testid="marcador-filho">chevron</span>
      </BadgeStatusPedido>,
    );
    const posRotulo = html.indexOf("Pendente");
    const posFilho = html.indexOf("marcador-filho");
    expect(posRotulo).toBeGreaterThan(-1);
    expect(posFilho).toBeGreaterThan(posRotulo);
  });
});
