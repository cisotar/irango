/**
 * Testes do LinhaTempoStatus (issue 130) — critério de aceite:
 *   - para cada status não-cancelado, o passo correto é ATUAL e os anteriores
 *     são CONCLUÍDOS;
 *   - `cancelado` renderiza o bloco de cancelamento (não um passo comum);
 *   - renderiza sem erro para os 6 status + status fora do enum (não lança).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), idêntica ao padrão de
 * HeaderLoja.test.tsx / StatusAssinatura.test.tsx. Asserções sobre o HTML e o
 * estado semântico (`aria-current`, sr-only "concluído"/"atual"/"a seguir").
 *
 * Copy e ordem NÃO são reasseridas aqui em matriz — vêm das fontes únicas
 * (`copyStatusConfirmacao` 129 / `STATUS_VALIDOS` 127), com seus próprios testes.
 * Aqui provamos só o que é específico do componente: mapeamento de estado.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LinhaTempoStatus } from "@/components/vitrine/confirmacao/LinhaTempoStatus";
import { STATUS_VALIDOS, type StatusPedido } from "@/lib/utils/transicaoStatus";

function render(status: StatusPedido | string, tipoEntrega: string | null = "entrega"): string {
  return renderToStaticMarkup(
    // cast: testamos deliberadamente status fora do enum em alguns casos
    <LinhaTempoStatus status={status as StatusPedido} tipoEntrega={tipoEntrega} />,
  );
}

const PASSOS = STATUS_VALIDOS.filter((s) => s !== "cancelado");

// ---------------------------------------------------------------------------
// 1. Render sem erro para os 6 status do enum
// ---------------------------------------------------------------------------

describe("render sem erro — 6 status", () => {
  it.each(STATUS_VALIDOS)("status %s renderiza sem lançar", (status) => {
    expect(() => render(status)).not.toThrow();
    expect(render(status).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Passo atual e anteriores concluídos, por status não-cancelado
// ---------------------------------------------------------------------------

describe("estado dos passos — passo atual marcado e anteriores concluídos", () => {
  it.each(PASSOS)("status %s marca exatamente um passo como atual", (status) => {
    const html = render(status);
    // aria-current="step" aparece exatamente uma vez
    const ocorrencias = html.split('aria-current="step"').length - 1;
    expect(ocorrencias).toBe(1);
  });

  it("pendente (primeiro) não tem passo concluído antes dele", () => {
    const html = render("pendente");
    expect(html).not.toContain("— concluído");
    expect(html).toContain("— atual");
  });

  it("em_preparo marca os 2 passos anteriores como concluídos", () => {
    const html = render("em_preparo");
    // pendente e confirmado concluídos → duas marcas sr-only "concluído"
    const concluidos = html.split("— concluído").length - 1;
    expect(concluidos).toBe(2);
    expect(html).toContain("— atual");
  });

  it("entregue (último) marca os 4 anteriores como concluídos e é o atual", () => {
    const html = render("entregue");
    const concluidos = html.split("— concluído").length - 1;
    expect(concluidos).toBe(4);
    const atuais = html.split("— atual").length - 1;
    expect(atuais).toBe(1);
  });

  it("saiu_entrega expõe os passos seguintes como 'a seguir'", () => {
    const html = render("saiu_entrega");
    // só resta 'entregue' à frente
    const aSeguir = html.split("— a seguir").length - 1;
    expect(aSeguir).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. cancelado — bloco distinto, não um passo da trilha
// ---------------------------------------------------------------------------

describe("cancelado — bloco destructive separado", () => {
  const html = render("cancelado");

  it("não renderiza a trilha (nenhum aria-current, nenhum role=list)", () => {
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain('role="list"');
  });

  it("renderiza um bloco role=status com a cor destructive fixa", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain("#fee2e2");
  });

  it("mostra o título de cancelamento", () => {
    expect(html).toContain("Pedido cancelado");
  });
});

// ---------------------------------------------------------------------------
// 4. tipoEntrega — variação de ícone/mensagem em saiu_entrega
// ---------------------------------------------------------------------------

describe("tipoEntrega em saiu_entrega", () => {
  it("retirada muda a mensagem afetiva do passo atual", () => {
    const html = render("saiu_entrega", "retirada");
    expect(html).toContain("pronto para retirada");
  });

  it("entrega mantém a mensagem 'a caminho'", () => {
    const html = render("saiu_entrega", "entrega");
    expect(html).toContain("a caminho");
  });

  it("tipoEntrega null não lança", () => {
    expect(() => render("saiu_entrega", null)).not.toThrow();
  });

  it("retirada troca o ícone do passo para shopping-bag (não bike)", () => {
    const html = render("saiu_entrega", "retirada");
    expect(html).toContain("lucide-shopping-bag");
    expect(html).not.toContain("lucide-bike");
  });

  it("entrega mantém o ícone bike (não shopping-bag)", () => {
    const html = render("saiu_entrega", "entrega");
    expect(html).toContain("lucide-bike");
    expect(html).not.toContain("lucide-shopping-bag");
  });

  it("tipoEntrega vazio ('') cai no ícone bike, igual a null/entrega", () => {
    const html = render("saiu_entrega", "");
    expect(html).toContain("lucide-bike");
    expect(html).not.toContain("lucide-shopping-bag");
  });
});

// ---------------------------------------------------------------------------
// 4b. Passo concluído substitui o ícone do status pelo Check (não cosmético)
// ---------------------------------------------------------------------------

describe("passo concluído sobrepõe o ícone original com Check", () => {
  it("em_preparo: pendente e confirmado concluídos mostram Check, não Clock/CircleCheck", () => {
    const html = render("em_preparo");
    // dois passos concluídos → dois ícones lucide-check; os ícones originais
    // (clock/circle-check) desses dois passos não devem aparecer mais.
    const checks = html.split("lucide-check").length - 1;
    expect(checks).toBe(2);
    expect(html).not.toContain("lucide-clock");
    expect(html).not.toContain("lucide-circle-check");
  });

  it("pendente (nenhum concluído) não renderiza nenhum ícone Check", () => {
    const html = render("pendente");
    expect(html).not.toContain("lucide-check");
  });
});

// ---------------------------------------------------------------------------
// 5. status fora do enum — fallback puro, sem passo atual, sem throw
// ---------------------------------------------------------------------------

describe("status desconhecido — fallback seguro", () => {
  it("não lança e não marca nenhum passo como atual", () => {
    let html = "";
    expect(() => {
      html = render("status_inexistente");
    }).not.toThrow();
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain("— atual");
    // trilha inteira vira 'a seguir' — 5 passos
    const aSeguir = html.split("— a seguir").length - 1;
    expect(aSeguir).toBe(PASSOS.length);
  });
});
