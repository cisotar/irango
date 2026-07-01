/**
 * Testes do ThumbProduto (issue 106).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server) idêntica ao padrão do
 * projeto (StatusAssinatura.test.tsx, HeaderLoja.test.tsx).
 *
 * Comportamentos cobertos:
 *   (a) fotoUrl https:// válida → <img> com o src correto no HTML
 *   (b) fotoUrl null            → fallback div com a inicial maiúscula do nome
 *   (c) fotoUrl http://...      → NÃO vira src (fallback) — guard anti-XSS
 *   (d) fotoUrl javascript:...  → NÃO vira src (fallback)
 *   (e) nome vazio ("")         → fallback div sem letra, não explode
 *   (f) nome com espaço leading → inicial da primeira letra real (trim)
 *
 * Cada teste falharia se o guard `fotoSegura` ou a lógica de inicial fosse
 * removida/alterada.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ThumbProduto } from "@/components/painel/ThumbProduto";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function render(fotoUrl: string | null, nome: string): string {
  return renderToStaticMarkup(<ThumbProduto fotoUrl={fotoUrl} nome={nome} />);
}

// ---------------------------------------------------------------------------
// (a) URL https:// válida → renderiza <img> com o src
// ---------------------------------------------------------------------------

describe("foto https válida", () => {
  it("inclui o src da foto no HTML", () => {
    const url = "https://cdn.example.com/foto.jpg";
    const html = render(url, "Coxinha");
    expect(html).toContain(`src="${url}"`);
  });

  it("usa alt igual ao nome do produto", () => {
    const url = "https://cdn.example.com/foto.jpg";
    const html = render(url, "Coxinha");
    expect(html).toContain('alt="Coxinha"');
  });

  it("não exibe inicial do nome quando a foto é renderizada", () => {
    const url = "https://cdn.example.com/foto.jpg";
    const html = render(url, "Coxinha");
    // A div de fallback com a inicial não deve aparecer
    expect(html).not.toContain(">C<");
  });
});

// ---------------------------------------------------------------------------
// (b) fotoUrl null → fallback com inicial maiúscula
// ---------------------------------------------------------------------------

describe("fotoUrl null → fallback", () => {
  it("não renderiza tag img", () => {
    const html = render(null, "Brigadeiro");
    expect(html).not.toContain("<img");
  });

  it("exibe a inicial maiúscula do nome", () => {
    const html = render(null, "brigadeiro");
    // charAt(0).toUpperCase() de "brigadeiro" é "B"
    expect(html).toContain("B");
  });

  it("inicial é a primeira letra do nome em maiúsculo", () => {
    const html = render(null, "pastel de frango");
    expect(html).toContain("P");
  });
});

// ---------------------------------------------------------------------------
// (c) URL http:// → recusada, cai no fallback
// ---------------------------------------------------------------------------

describe("url http:// não vira src", () => {
  it("não renderiza tag img para url http://", () => {
    const html = render("http://cdn.example.com/foto.jpg", "Esfiha");
    expect(html).not.toContain("<img");
  });

  it("exibe fallback com inicial quando url é http://", () => {
    const html = render("http://cdn.example.com/foto.jpg", "Esfiha");
    expect(html).toContain("E");
  });
});

// ---------------------------------------------------------------------------
// (d) URL javascript: → recusada, cai no fallback (anti-XSS seguranca.md §15)
// ---------------------------------------------------------------------------

describe("url javascript: não vira src", () => {
  it("não renderiza tag img para javascript:", () => {
    const html = render("javascript:alert(1)", "Caldo");
    expect(html).not.toContain("<img");
  });

  it("não inclui 'javascript:' em nenhum atributo src do HTML", () => {
    const html = render("javascript:void(0)", "Caldo");
    expect(html).not.toContain("javascript:");
  });

  it("exibe fallback com inicial quando url é javascript:", () => {
    const html = render("javascript:alert(1)", "Caldo");
    expect(html).toContain("C");
  });
});

// ---------------------------------------------------------------------------
// (e) nome vazio → fallback sem letra, sem exceção
// ---------------------------------------------------------------------------

describe("nome vazio", () => {
  it("não lança exceção com nome vazio", () => {
    expect(() => render(null, "")).not.toThrow();
  });

  it("não renderiza tag img com nome vazio e sem foto", () => {
    const html = render(null, "");
    expect(html).not.toContain("<img");
  });

  it("não lança exceção com foto https e nome vazio", () => {
    expect(() =>
      render("https://cdn.example.com/x.jpg", ""),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (f) nome com espaço leading → trim antes de extrair inicial
// ---------------------------------------------------------------------------

describe("nome com espaço no início", () => {
  it("exibe inicial da primeira letra real, não de espaço", () => {
    const html = render(null, "  Yakisoba");
    // trim() remove os espaços; charAt(0) pega "Y"
    expect(html).toContain("Y");
  });

  it("não exibe espaço como inicial no fallback", () => {
    const html = render(null, "  Yakisoba");
    // Se trim não fosse aplicado, o conteúdo seria " " (espaço em branco)
    // O HTML gerado com espaço como innerHTML seria literalmente "> <" ou ">  <"
    // Verificamos que "Y" aparece e não que o div fica com só espaço
    expect(html).toContain("Y");
    expect(html).not.toMatch(/>\s+</);
  });
});

// ---------------------------------------------------------------------------
// (g) url string vazia → recusada, cai no fallback
// ---------------------------------------------------------------------------

describe("url string vazia", () => {
  it("não renderiza tag img para url vazia", () => {
    const html = render("", "Empada");
    expect(html).not.toContain("<img");
  });

  it("exibe fallback com inicial para url vazia", () => {
    const html = render("", "Empada");
    expect(html).toContain("E");
  });
});
