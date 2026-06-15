/**
 * Testes para CardStatusAssinatura e BotaoGerenciarHotmart (issue 060).
 *
 * Ambiente: vitest com environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server, sem dependência nova) para
 * produzir HTML e fazer asserções sobre texto/atributos reais.
 * As funções de formatação internas não são exportadas; cobrimos o comportamento
 * observável via HTML renderizado.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CardStatusAssinatura,
  BotaoGerenciarHotmart,
} from "@/components/painel/StatusAssinatura";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AssinaturaInput = {
  status: string;
  inicio: string | null;
  fimPeriodo: string | null;
  subscriberCode: string | null;
};

function render(
  assinatura: AssinaturaInput,
  agora: Date = new Date("2025-06-01T12:00:00Z"),
): string {
  return renderToStaticMarkup(
    <CardStatusAssinatura assinatura={assinatura} agora={agora} />,
  );
}

// ---------------------------------------------------------------------------
// 1. Rótulo e variante de Badge por status
// ---------------------------------------------------------------------------

describe("rótulo e variante de badge por status", () => {
  it("trial → 'Período de teste' + variante secondary", () => {
    const html = render({ status: "trial", inicio: null, fimPeriodo: "2025-06-10T00:00:00Z", subscriberCode: null });
    expect(html).toContain("Período de teste");
    // variante secondary produz a classe "bg-secondary" via cva
    expect(html).toContain("bg-secondary");
  });

  it("ativa → 'Ativa' + variante secondary", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("Ativa");
    expect(html).toContain("bg-secondary");
  });

  it("inadimplente → 'Pagamento pendente' + variante destructive", () => {
    const html = render({ status: "inadimplente", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("Pagamento pendente");
    // destructive contém "bg-destructive" nas classes geradas por cva
    expect(html).toContain("bg-destructive");
  });

  it("cancelada → 'Cancelada' + variante outline", () => {
    const html = render({ status: "cancelada", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("Cancelada");
    // outline produz "border-border" — não tem bg especial como secondary/destructive
    expect(html).toContain("border-border");
    expect(html).not.toContain("bg-secondary");
    expect(html).not.toContain("bg-destructive");
  });

  it("suspensa → 'Suspensa' + variante destructive", () => {
    const html = render({ status: "suspensa", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("Suspensa");
    expect(html).toContain("bg-destructive");
  });
});

// ---------------------------------------------------------------------------
// 2. Status desconhecido → rótulo "Desconhecida", variante outline, não quebra
// ---------------------------------------------------------------------------

describe("status fora do enum", () => {
  it("exibe 'Desconhecida' sem lançar exceção", () => {
    expect(() => render({ status: "xyz_invalido", inicio: null, fimPeriodo: null, subscriberCode: null })).not.toThrow();
    const html = render({ status: "xyz_invalido", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("Desconhecida");
  });

  it("usa variante outline para status desconhecido", () => {
    const html = render({ status: "zombie", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("border-border");
    expect(html).not.toContain("bg-secondary");
    expect(html).not.toContain("bg-destructive");
  });
});

// ---------------------------------------------------------------------------
// 3. inicio / fimPeriodo null → exibe "—"
// ---------------------------------------------------------------------------

describe("datas nulas exibem '—'", () => {
  it("inicio null → '—'", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: null });
    // O componente usa o caractere EM DASH literal (—)
    expect(html).toContain("—");
  });

  it("fimPeriodo null → '—'", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: null });
    // Pelo menos duas ocorrências (uma por campo)
    const count = (html.match(/—/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Data ISO inválida → "—" (não "Invalid Date")
// ---------------------------------------------------------------------------

describe("data ISO inválida", () => {
  it("inicio inválido → '—' (nunca 'Invalid Date')", () => {
    const html = render({ status: "ativa", inicio: "not-a-date", fimPeriodo: null, subscriberCode: null });
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("—");
  });

  it("fimPeriodo inválido → '—' (nunca 'Invalid Date')", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: "garbage-2025", subscriberCode: null });
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("—");
  });

  it("data vazia string → '—'", () => {
    const html = render({ status: "ativa", inicio: "", fimPeriodo: null, subscriberCode: null });
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// 5. trial com fimPeriodo futuro / passado (injetar agora)
// ---------------------------------------------------------------------------

describe("trial: contagem de dias restantes", () => {
  it("fimPeriodo 3 dias no futuro → 'termina em 3 dia(s)'", () => {
    const agora = new Date("2025-06-01T00:00:00Z");
    const fimPeriodo = "2025-06-04T00:00:00Z"; // 3 dias à frente exatos
    const html = render({ status: "trial", inicio: null, fimPeriodo, subscriberCode: null }, agora);
    expect(html).toContain("termina em 3 dia(s)");
  });

  it("fimPeriodo 1 dia no futuro → 'termina em 1 dia(s)'", () => {
    const agora = new Date("2025-06-10T00:00:00Z");
    const fimPeriodo = "2025-06-11T00:00:00Z";
    const html = render({ status: "trial", inicio: null, fimPeriodo, subscriberCode: null }, agora);
    expect(html).toContain("termina em 1 dia(s)");
  });

  it("fimPeriodo passado → 'terminou'", () => {
    const agora = new Date("2025-07-01T00:00:00Z");
    const fimPeriodo = "2025-06-01T00:00:00Z"; // já passou
    const html = render({ status: "trial", inicio: null, fimPeriodo, subscriberCode: null }, agora);
    expect(html).toContain("terminou");
    expect(html).not.toContain("termina em");
  });

  it("fimPeriodo igual a agora (0 dias restantes) → 'terminou'", () => {
    const agora = new Date("2025-06-15T12:00:00Z");
    const fimPeriodo = "2025-06-15T12:00:00Z";
    const html = render({ status: "trial", inicio: null, fimPeriodo, subscriberCode: null }, agora);
    // Math.ceil(0 ms) === 0, então dias === 0 → "terminou"
    expect(html).toContain("terminou");
  });

  it("status ativa com fimPeriodo futuro NÃO exibe mensagem de trial", () => {
    const agora = new Date("2025-06-01T00:00:00Z");
    const fimPeriodo = "2025-06-30T00:00:00Z";
    const html = render({ status: "ativa", inicio: null, fimPeriodo, subscriberCode: null }, agora);
    expect(html).not.toContain("termina em");
    expect(html).not.toContain("terminou");
  });
});

// ---------------------------------------------------------------------------
// 6. Bloco de ação visível para inadimplente/suspensa; ausente para ativa
// ---------------------------------------------------------------------------

describe("bloco de ação (exigeAcao)", () => {
  it("inadimplente → exibe mensagem de pagamento pendente", () => {
    const html = render({ status: "inadimplente", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("pagamento pendente");
  });

  it("suspensa → exibe mensagem de assinatura suspensa", () => {
    const html = render({ status: "suspensa", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).toContain("suspensa");
    // A mensagem menciona reativar
    expect(html).toContain("reativar");
  });

  it("ativa → bloco de ação NÃO é exibido", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: null });
    // Nenhuma das mensagens de ação aparece
    expect(html).not.toContain("Identificamos um pagamento pendente");
    expect(html).not.toContain("reativar sua loja");
  });

  it("cancelada → bloco de ação NÃO é exibido", () => {
    const html = render({ status: "cancelada", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).not.toContain("Identificamos um pagamento pendente");
    expect(html).not.toContain("reativar sua loja");
  });

  it("trial → bloco de ação NÃO é exibido (só o aviso de dias)", () => {
    const agora = new Date("2025-06-01T00:00:00Z");
    const html = render({ status: "trial", inicio: null, fimPeriodo: "2025-06-10T00:00:00Z", subscriberCode: null }, agora);
    expect(html).not.toContain("Identificamos um pagamento pendente");
    expect(html).not.toContain("reativar sua loja");
  });
});

// ---------------------------------------------------------------------------
// 7. subscriberCode presente / ausente
// ---------------------------------------------------------------------------

describe("subscriberCode", () => {
  it("presente → exibe 'Código do assinante' e o valor", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: "SUB-12345" });
    expect(html).toContain("Código do assinante");
    expect(html).toContain("SUB-12345");
  });

  it("null → linha 'Código do assinante' ausente", () => {
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: null });
    expect(html).not.toContain("Código do assinante");
  });

  it("string vazia é tratada como falsy — linha ausente", () => {
    // subscriberCode: "" é falsy em JS; o componente usa `{subscriberCode && ...}`
    const html = render({ status: "ativa", inicio: null, fimPeriodo: null, subscriberCode: "" });
    expect(html).not.toContain("Código do assinante");
  });
});

// ---------------------------------------------------------------------------
// 8. BotaoGerenciarHotmart — href, target _blank, rel noopener noreferrer
// ---------------------------------------------------------------------------

describe("BotaoGerenciarHotmart", () => {
  function renderBotao(): string {
    return renderToStaticMarkup(<BotaoGerenciarHotmart />);
  }

  it("contém href para o portal Hotmart", () => {
    const html = renderBotao();
    expect(html).toContain('href="https://consumer.hotmart.com/"');
  });

  it("abre em nova aba (target=_blank)", () => {
    const html = renderBotao();
    expect(html).toContain('target="_blank"');
  });

  it("rel noopener noreferrer (segurança de abertura em nova aba)", () => {
    const html = renderBotao();
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
  });

  it("texto do botão menciona Hotmart", () => {
    const html = renderBotao();
    expect(html).toContain("Hotmart");
  });

  it("aviso para screen reader '(abre em nova aba)'", () => {
    const html = renderBotao();
    expect(html).toContain("nova aba");
  });
});
