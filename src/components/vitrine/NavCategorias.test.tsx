/**
 * Issue 203 — árvore do trilho de categorias. `environment: node`, sem jsdom:
 * `renderToStaticMarkup` NÃO roda efeitos, então o scrollspy não é testável
 * aqui (está coberto em `scrollspyCategorias.test.ts`, com observer fake). O
 * que se prova aqui é o que chega ao cliente ANTES da hidratação — que é
 * justamente o critério "tocar num chip rola mesmo com JS desligado".
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NavCategorias, type CategoriaNavegavel } from "./NavCategorias";
import { ancoraCategoria } from "@/lib/utils/ancoraCategoria";

function categorias(quantidade: number): CategoriaNavegavel[] {
  return Array.from({ length: quantidade }, (_, indice) => ({
    id: `id-${indice}`,
    nome: `Categoria ${indice}`,
  }));
}

function render(lista: CategoriaNavegavel[]) {
  return renderToStaticMarkup(
    <NavCategorias categorias={lista} alturaBarra={0} />,
  );
}

describe("203 NavCategorias — gate, árvore acessível e âncoras", () => {
  it("com menos de 3 categorias não renderiza nada (RN-4)", () => {
    expect(render(categorias(2))).toBe("");
    expect(render(categorias(1))).toBe("");
    expect(render([])).toBe("");
  });

  it("com 3+ categorias renderiza <nav aria-label> + <ul> + um <a> por categoria", () => {
    const html = render(categorias(3));

    expect(html).toContain('<nav aria-label="Categorias do cardápio"');
    expect(html).toContain("<ul");
    expect(html.match(/<a /g)).toHaveLength(3);
    // Não é Tabs nem carousel de lib (spec §Fora do Escopo): nada de role/tab.
    expect(html).not.toContain('role="tab');
  });

  it("o href vem de ancoraCategoria — a MESMA fonte do id da <section> (201)", () => {
    const html = render(categorias(3));

    expect(html).toContain(`href="#${ancoraCategoria("id-0", 0)}"`);
    expect(html).toContain(`href="#${ancoraCategoria("id-2", 2)}"`);
  });

  it("categoria sem id (grupo Outros) usa a âncora por índice", () => {
    const html = render([
      { id: null, nome: "Outros" },
      ...categorias(2),
    ]);

    expect(html).toContain(`href="#${ancoraCategoria(null, 0)}"`);
  });

  it("o primeiro chip já sai marcado no SSR, e só ele", () => {
    const html = render(categorias(3));

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const posicaoMarcado = html.indexOf('aria-current="true"');
    expect(posicaoMarcado).toBeGreaterThan(-1);
    expect(posicaoMarcado).toBeLessThan(html.indexOf("Categoria 1"));
  });

  it("o chip tem o alvo de toque literal de 44px (design-system §5)", () => {
    // `min-h-11` seria 52,8px na base 120% — não é a régua.
    expect(render(categorias(3))).toContain(["min-h-[44px]"].join(""));
  });

  it("o chip ativo tem sublinhado interno além da cor (WCAG 1.4.1)", () => {
    const html = render(categorias(3));

    expect(html).toContain("box-shadow:inset 0 -3px 0 rgba(255,255,255,.45)");
    expect(html).toContain("bg-primaria");
    // Texto branco FIXO (RN-7): nunca derivado do tema da loja.
    expect(html).toContain("text-white");
  });

  it("o nome da categoria é escapado pelo JSX, nunca injetado como HTML", () => {
    const html = render([
      { id: "id-x", nome: "<img src=x onerror=alert(1)>" },
      ...categorias(2),
    ]);

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
