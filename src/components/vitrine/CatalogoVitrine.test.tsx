/**
 * Issue 201 — estrutura do wrapper client da vitrine. `environment: node`, sem
 * jsdom: `renderToStaticMarkup` não roda efeitos, então o que se prova aqui é a
 * ÁRVORE (barra presente/ausente, `<main>` único, scroll-margin medido nas
 * seções), não a medição em si — essa é verificação manual no devtools.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
        precoEfetivo: 5,
        temDesconto: false,
        seloDesconto: null,
        descontoFim: null,
        compravel: true,
        motivoNaoCompravel: null,
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
          precoEfetivo: 5,
          temDesconto: false,
          seloDesconto: null,
          descontoFim: null,
          compravel: true,
          motivoNaoCompravel: null,
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

describe("202 CatalogoVitrine — modo busca no primeiro render", () => {
  it("a barra traz o campo de busca acima do trilho", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(3)} />);

    expect(html).toContain('role="search"');
    expect(html.indexOf('role="search"')).toBeLessThan(
      html.indexOf('<nav aria-label="Categorias do cardápio"'),
    );
  });

  it("a busca existe mesmo onde a nav não se justifica (o gate de 3 é da nav)", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(2)} />);

    expect(html).toContain('role="search"');
  });

  it("a região viva é ÚNICA, existe vazia e fica FORA da barra medida (D3)", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(3)} />);

    // Uma só, nunca aninhada (4.1.3).
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    // Nasce vazia: com `termo=""` nada é anunciado.
    expect(html).toMatch(/role="status"[^>]*><\/p>/);
    // Fora do <div sticky> medido pelo ResizeObserver da 201 — o </div> que
    // fecha a barra vem ANTES da região viva.
    const inicioBarra = html.indexOf("sticky top-0 z-30");
    const regiao = html.indexOf('role="status"');
    expect(html.lastIndexOf("</div>", regiao)).toBeGreaterThan(inicioBarra);
  });

  it("com termo vazio o <main> segue com o catálogo íntegro, sem estado vazio", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(3)} />);

    expect(html).toContain("Produto 0");
    expect(html).toContain("Produto 2");
    expect(html).not.toContain("Nenhum produto encontrado");
    // Sem texto no campo não há ✕ e nem linha de resumo.
    expect(html).not.toContain('aria-label="Limpar busca"');
    expect(html).not.toContain("produtos encontrados para");
  });

  it("com termo vazio nenhum <mark> é montado (o realce da 200 fica inerte)", () => {
    const html = renderToStaticMarkup(<CatalogoVitrine categorias={varias(3)} />);

    expect(html).not.toContain("<mark");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D2 (202) — NavCategorias é DESMONTADA em modo busca, nunca escondida por
// CSS. Sem jsdom não há como digitar e observar a árvore em modo busca via
// `renderToStaticMarkup` (`termo` é `useState` interno, não prop) — mesma
// lacuna que já vale para toda a mecânica interativa de 201/203. A invariante
// que PODE ser travada em `environment: node`, no precedente de
// `isolamento-entitlement-print.test.tsx`/`enforcement-escopo-admin.test.ts`,
// é estática: se alguém trocar o ternário por "renderiza os dois e esconde
// um com CSS" (regressão real — reabriria o bug do D2: o `IntersectionObserver`
// da 203 ficaria vivo sobre `<section>` que `filtrarCatalogo` tirou do DOM,
// o chip ativo congelaria e o scrollspy voltaria errado ao limpar a busca),
// este teste falha.
// ═══════════════════════════════════════════════════════════════════════════
describe("202 D2 — NavCategorias desmontada em modo busca, nunca oculta por CSS (regressão estática)", () => {
  const FONTE = readFileSync(
    join(process.cwd(), "src/components/vitrine/CatalogoVitrine.tsx"),
    "utf8",
  );

  it("a troca trilho↔resumo é UM ternário que monta só um dos dois componentes", () => {
    // `{emBusca ? (<ResumoBusca .../>) : (<NavCategorias .../>)}` — exatamente
    // um ramo é montado por vez. Se alguém duplicar a condição (ex.: dois
    // ternários independentes, um por componente) os dois podem ficar
    // montados ao mesmo tempo — é o que esta asserção único-bloco impede.
    expect(FONTE).toMatch(/emBusca\s*\?\s*\(\s*<ResumoBusca/);
    expect(FONTE).toMatch(/<NavCategorias[\s\S]{0,160}\/>\s*\)\s*\}/);
  });

  it("nenhum idioma de esconder por CSS (hidden/display:none/aria-hidden) existe no arquivo — só desmontagem real", () => {
    // O componente inteiro nunca usa esses idiomas: se um deles aparecer
    // perto da troca trilho↔resumo, é sinal de alguém ter voltado a ocultar
    // em vez de desmontar.
    expect(FONTE).not.toMatch(/\bhidden\b/);
    expect(FONTE).not.toMatch(/display:\s*none/);
  });
});
