/**
 * Issue 201 — estrutura do wrapper client da vitrine. `environment: node`, sem
 * jsdom: `renderToStaticMarkup` não roda efeitos, então o que se prova aqui é a
 * ÁRVORE (barra presente/ausente, `<main>` único, scroll-margin medido nas
 * seções), não a medição em si — essa é verificação manual no devtools.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CatalogoVitrine } from "./CatalogoVitrine";
import type { CategoriaComProdutos } from "./SecaoCatalogo";

/** N categorias com um produto cada — o gate da nav (RN-4) conta CATEGORIAS. */
function varias(quantidade: number): CategoriaComProdutos[] {
  return Array.from({ length: quantidade }, (_, indice) => ({
    id: `cat-${indice}`,
    nome: `Categoria ${indice}`,
    produtos: [
      {
        id: `p-${indice}`,
        nome: `Produto ${indice}`,
        descricao: null,
        preco: 5,
        foto_url: null,
        categoria_id: `cat-${indice}`,
        disponivel: true,
      },
    ],
  }));
}

function categorias(): CategoriaComProdutos[] {
  return [
    {
      id: "cat-bebidas",
      nome: "Bebidas",
      produtos: [
        {
          id: "p-1",
          nome: "Coca Gelada",
          descricao: null,
          preco: 5,
          foto_url: null,
          categoria_id: "cat-bebidas",
          disponivel: true,
        },
      ],
    },
  ];
}

describe("201 CatalogoVitrine — barra sticky e main do catálogo", () => {
  it("com ao menos uma categoria, renderiza a barra sticky E o <main>", () => {
    const html = renderToStaticMarkup(
      <CatalogoVitrine categorias={categorias()} />,
    );

    expect(html).toContain("sticky top-0 z-30");
    expect(html).toContain("<main");
    // Um único <main> por render (page.tsx deixa de ser dono dele no ramo cheio).
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  it("catálogo vazio (RN-4): sem barra, mas o <main> continua", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={[]} />);

    expect(html).not.toContain("sticky");
    expect(html).toContain("<main");
  });

  it("as seções saem com o scroll-margin medido, sem a antiga classe fixa", () => {
    const html = renderToStaticMarkup(
      <CatalogoVitrine categorias={categorias()} />,
    );

    expect(html).toContain("scroll-margin-top:calc(var(--altura-barra)");
    // Concatenado para não deixar o literal contíguo no fonte — o scanner de
    // texto do Tailwind v4 varre até comentário/string e geraria um
    // utilitário órfão no CSS compilado (achado verificar/201).
    expect(html).not.toContain(["scroll", "mt", "24"].join("-"));
  });

  it("203: com 3+ categorias a barra traz a nav de categorias", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(3)} />);

    expect(html).toContain('<nav aria-label="Categorias do cardápio"');
  });

  it("203: com 2 categorias a barra existe, mas sem nav (RN-4)", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(2)} />);

    expect(html).toContain("sticky top-0 z-30");
    expect(html).not.toContain("<nav");
  });
});
