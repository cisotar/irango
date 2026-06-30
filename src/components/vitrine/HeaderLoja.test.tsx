/**
 * Testes do HeaderLoja (crit. 2, 3, 9 do spec logo-loja).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server) para asserções sobre HTML
 * gerado, idêntica ao padrão de StatusAssinatura.test.tsx.
 *
 * Critérios cobertos:
 *   2 — logoUrl https válida → <img> com o src correto é renderizado
 *   3 — logoUrl ausente/null → fallback com a primeira letra do nome
 *   9 — logoUrl http:// ou javascript: → NÃO renderiza <img>, cai no fallback
 *
 * fotoSegura: unitário isolado (fonte única do guard, seguranca.md §15) + render
 * integrado no componente, que consome o util via logo do header.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderLoja } from "@/components/vitrine/HeaderLoja";
import { fotoSegura } from "@/lib/utils/fotoSegura";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Horários completos para o componente não explodir — loja sempre fechada.
 * lojaAberta acessa todos os 7 dias; cada entrada precisa ter abre/fecha/ativo.
 */
const DIA_FECHADO = { abre: "08:00", fecha: "18:00", ativo: false };
const horariosFixo = {
  dom: DIA_FECHADO,
  seg: DIA_FECHADO,
  ter: DIA_FECHADO,
  qua: DIA_FECHADO,
  qui: DIA_FECHADO,
  sex: DIA_FECHADO,
  sab: DIA_FECHADO,
} as Parameters<typeof HeaderLoja>[0]["horarios"];
const timezoneFixo = "America/Sao_Paulo";

function render(overrides: Partial<Parameters<typeof HeaderLoja>[0]> = {}): string {
  return renderToStaticMarkup(
    <HeaderLoja
      nome="Burger Test"
      horarios={horariosFixo}
      timezone={timezoneFixo}
      {...overrides}
    />,
  );
}

// ---------------------------------------------------------------------------
// 1. fotoSegura — unitário (função pura, guard consumido pelo HeaderLoja)
// ---------------------------------------------------------------------------

describe("fotoSegura — função pura", () => {
  it("url https válida → retorna a própria url", () => {
    const url = "https://cdn.example.com/logo.jpg";
    expect(fotoSegura(url)).toBe(url);
  });

  it("url http (plain) → retorna null (não-segura)", () => {
    expect(fotoSegura("http://cdn.example.com/logo.jpg")).toBeNull();
  });

  it("protocolo javascript: → retorna null (anti-XSS)", () => {
    expect(fotoSegura("javascript:alert(1)")).toBeNull();
  });

  it("protocolo data: → retorna null", () => {
    expect(fotoSegura("data:image/png;base64,abc")).toBeNull();
  });

  it("string vazia → retorna null", () => {
    expect(fotoSegura("")).toBeNull();
  });

  it("undefined → retorna null", () => {
    expect(fotoSegura(undefined)).toBeNull();
  });

  it("url https com subdomínio e path → retorna a própria url", () => {
    const url = "https://storage.supabase.co/lojas/42/logo.png";
    expect(fotoSegura(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// 2. Render — logo https válida → <img> com src correto (crit. 2)
// ---------------------------------------------------------------------------

describe("render com logoUrl https válida — crit. 2", () => {
  const logoUrl = "https://cdn.example.com/loja/logo.png";

  it("renderiza elemento <img> com o src fornecido", () => {
    const html = render({ logoUrl });
    // next/image com unoptimized renderiza <img src="..."> diretamente
    expect(html).toContain(`src="${logoUrl}"`);
  });

  it("<img> tem alt igual ao nome da loja", () => {
    const html = render({ logoUrl, nome: "Burger Test" });
    expect(html).toContain('alt="Burger Test"');
  });

  it("fallback de letra NÃO aparece quando há logo válida", () => {
    const html = render({ logoUrl, nome: "Burger Test" });
    // O div de fallback tem bg-[#4a3a22] — presente apenas nele, nunca no <img>
    expect(html).not.toContain("bg-[#4a3a22]");
  });
});

// ---------------------------------------------------------------------------
// 3. Render — sem logo → fallback com primeira letra (crit. 3)
// ---------------------------------------------------------------------------

describe("render sem logoUrl — crit. 3", () => {
  it("renderiza a primeira letra do nome em maiúscula como fallback", () => {
    const html = render({ nome: "Pizzaria Roma" });
    // A letra maiúscula da primeira letra deve aparecer no HTML do avatar
    expect(html).toContain("P");
  });

  it("NÃO renderiza elemento <img> quando logoUrl é undefined", () => {
    const html = render({ logoUrl: undefined });
    expect(html).not.toContain("<img");
  });

  it("NÃO renderiza elemento <img> quando logoUrl é null (prop omitida)", () => {
    // @ts-expect-error testando null explícito
    const html = render({ logoUrl: null });
    expect(html).not.toContain("<img");
  });

  it("div de fallback tem aria-hidden (avatar decorativo)", () => {
    const html = render({ logoUrl: undefined });
    expect(html).toContain('aria-hidden="true"');
  });

  it("nome da loja com minúscula → primeira letra em maiúscula no fallback", () => {
    const html = render({ nome: "sushi bar" });
    // charAt(0).toUpperCase() → 'S'
    expect(html).toContain("S");
  });
});

// ---------------------------------------------------------------------------
// 4. Render — logoUrl com protocolo inseguro → fallback (crit. 9, anti-XSS)
// ---------------------------------------------------------------------------

describe("render com logoUrl insegura — crit. 9 (anti-XSS)", () => {
  it("http:// → NÃO renderiza <img>, exibe fallback", () => {
    const html = render({ logoUrl: "http://cdn.example.com/logo.png", nome: "Loja HTTP" });
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"'); // div do fallback
    expect(html).toContain("L"); // primeira letra do nome
  });

  it("javascript: → NÃO renderiza <img>, exibe fallback", () => {
    const html = render({ logoUrl: "javascript:alert(1)", nome: "XSS Loja" });
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("X");
  });

  it("data: URI → NÃO renderiza <img>, exibe fallback", () => {
    const html = render({ logoUrl: "data:image/png;base64,abc", nome: "Data Loja" });
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });

  it("url sem protocolo (relativa) → NÃO renderiza <img>", () => {
    const html = render({ logoUrl: "/uploads/logo.png", nome: "Relativa" });
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });

  it("string vazia → NÃO renderiza <img>", () => {
    const html = render({ logoUrl: "", nome: "Vazia" });
    expect(html).not.toContain("<img");
  });
});

// ---------------------------------------------------------------------------
// 5. Render — nome e estrutura geral
// ---------------------------------------------------------------------------

describe("render — estrutura e nome", () => {
  it("nome da loja aparece no <h1> (uppercase é CSS, HTML mantém o texto original)", () => {
    const html = render({ nome: "Tapioca Express" });
    // uppercase é aplicado via CSS — o HTML contém o texto sem transformação
    expect(html).toContain("Tapioca Express");
    expect(html).toContain("<h1");
  });

  it("whatsapp presente → renderiza link wa.me com número limpo", () => {
    const html = render({ whatsapp: "(11) 99999-8888" });
    // Remove não-dígitos: 11999998888
    expect(html).toContain("wa.me/11999998888");
  });

  it("whatsapp ausente → sem link wa.me", () => {
    const html = render({ whatsapp: undefined });
    expect(html).not.toContain("wa.me");
  });
});
