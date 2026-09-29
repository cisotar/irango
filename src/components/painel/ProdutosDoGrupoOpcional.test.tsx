/**
 * Fase RED (TDD) da issue 331 — fatia F5: `ProdutosDoGrupoOpcional`, o Sheet
 * aberto por "Por produto" em cada grupo marcado do `CartaoAssociacaoOpcionais`
 * (tela de opcionais, lojista e admin).
 *
 * Lista com checkbox SÓ os produtos DESTA categoria de produto:
 *   marcado   = o grupo aparece no produto;
 *   desmarcado = o grupo está oculto nele.
 * Salvar manda à action SÓ o diff (via `ocultacoes.aplicarLote`, o hook — fonte
 * única), nunca o conjunto inteiro.
 *
 * Ambiente: vitest environment=node, sem jsdom. Sheet ABERTO renderiza em
 * portal, e portal não existe em `react-dom/server` — por isso o conteúdo é o
 * componente exportado à parte `ConteudoProdutosDoGrupoOpcional` (mesmo padrão
 * de `SheetAdicionarItens.test.tsx`), e o diff é a função pura
 * `diffOcultacoesDoGrupo`, testável sem clique.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ConteudoProdutosDoGrupoOpcional,
  ProdutosDoGrupoOpcional,
  diffOcultacoesDoGrupo,
} from "./ProdutosDoGrupoOpcional";

const GRUPO = { id: "g-molhos", nome: "Molhos" };
const CAT = { id: "cat-lanches", nome: "Lanches" };
const PRODUTOS = [
  { id: "p1", nome: "X-Burger", categoria_id: "cat-lanches" },
  { id: "p2", nome: "X-Salada", categoria_id: "cat-lanches" },
  { id: "p3", nome: "Suco de laranja", categoria_id: "cat-bebidas" },
  { id: "p4", nome: "Brigadeiro", categoria_id: null },
];

function ocultacoes(ocultos: Array<[string, string]> = []) {
  return {
    oculto: (produtoId: string, grupoId: string) =>
      ocultos.some(([p, g]) => p === produtoId && g === grupoId),
    aplicarLote: vi.fn(async () => true),
  };
}

function montarConteudo(o = ocultacoes()): string {
  return renderToStaticMarkup(
    <ConteudoProdutosDoGrupoOpcional
      grupo={GRUPO}
      categoriaProduto={CAT}
      produtos={PRODUTOS}
      ocultacoes={o}
      onFechar={vi.fn()}
    />,
  );
}

/**
 * `aria-checked` do checkbox da LINHA do produto. Cada produto é um `<li>` da
 * lista (semântica de lista), com o checkbox e o nome dentro dele — é o que
 * torna a leitura independente da ordem checkbox/rótulo dentro da linha.
 */
function marcado(html: string, nomeProduto: string): string | null {
  const linha = html
    .split("<li")
    .slice(1)
    .map((l) => l.split("</li>")[0])
    .find((l) => l.includes(nomeProduto));
  if (!linha) return null;
  return linha.match(/aria-checked="(true|false)"/)?.[1] ?? null;
}

describe("331 F5 · ConteudoProdutosDoGrupoOpcional — a lista", () => {
  it("lista SÓ os produtos da categoria do cartão (nem outra categoria, nem sem categoria)", () => {
    const html = montarConteudo();
    expect(html).toContain("X-Burger");
    expect(html).toContain("X-Salada");
    expect(html).not.toContain("Suco de laranja");
    expect(html).not.toContain("Brigadeiro");
    expect((html.match(/role="checkbox"/g) ?? []).length).toBe(2);
  });

  it("marcado = aparece; desmarcado = oculto — lido do hook, não de estado próprio", () => {
    const html = montarConteudo(ocultacoes([["p2", "g-molhos"]]));
    expect(marcado(html, "X-Burger")).toBe("true");
    expect(marcado(html, "X-Salada")).toBe("false");
  });

  it("o oculto de OUTRO grupo no mesmo produto não desmarca este", () => {
    const html = montarConteudo(ocultacoes([["p1", "g-adicionais"]]));
    expect(marcado(html, "X-Burger")).toBe("true");
  });

  it("render não grava: aplicarLote não é chamado", () => {
    const o = ocultacoes();
    montarConteudo(o);
    expect(o.aplicarLote).not.toHaveBeenCalled();
  });

  it("nomeia o grupo e a categoria (o lojista sabe o que está editando)", () => {
    const html = montarConteudo();
    expect(html).toContain("Molhos");
    expect(html).toContain("Lanches");
  });
});

describe("331 F5 · diffOcultacoesDoGrupo — salvar manda SÓ o diff", () => {
  const produtoIds = ["p1", "p2", "p5"];
  const ocultosAntes = new Set(["p2"]);
  const estaOculto = (id: string) => ocultosAntes.has(id);

  it("nada mudou → lote vazio", () => {
    const r = diffOcultacoesDoGrupo({
      grupoId: GRUPO.id,
      produtoIds,
      estaOculto,
      marcados: new Set(["p1", "p5"]),
    });
    expect(r).toEqual([]);
  });

  it("desmarcar um que aparecia → {oculto:true}; marcar um oculto → {oculto:false}; o resto fica de fora", () => {
    const r = diffOcultacoesDoGrupo({
      grupoId: GRUPO.id,
      produtoIds,
      estaOculto,
      marcados: new Set(["p2", "p5"]), // p1 desmarcado, p2 marcado, p5 igual
    });
    expect(r).toEqual([
      { produtoId: "p1", categoriaOpcionalId: GRUPO.id, oculto: true },
      { produtoId: "p2", categoriaOpcionalId: GRUPO.id, oculto: false },
    ]);
  });

  it("todas as alterações carregam o grupo DESTE sheet", () => {
    const r = diffOcultacoesDoGrupo({
      grupoId: GRUPO.id,
      produtoIds,
      estaOculto,
      marcados: new Set(),
    });
    expect(r.map((a) => a.categoriaOpcionalId)).toEqual([GRUPO.id, GRUPO.id]);
    expect(r.every((a) => a.oculto)).toBe(true);
    expect(r.map((a) => a.produtoId)).toEqual(["p1", "p5"]);
  });

  it("ignora marcado de produto que não está na lista da categoria (não vira alteração)", () => {
    const r = diffOcultacoesDoGrupo({
      grupoId: GRUPO.id,
      produtoIds,
      estaOculto,
      marcados: new Set(["p1", "p2", "p5", "p-intruso"]),
    });
    expect(r).toEqual([{ produtoId: "p2", categoriaOpcionalId: GRUPO.id, oculto: false }]);
  });
});

describe("331 F5 · ProdutosDoGrupoOpcional — o gatilho", () => {
  it("fechado, renderiza o botão 'Por produto' nomeado pelo grupo", () => {
    const html = renderToStaticMarkup(
      <ProdutosDoGrupoOpcional
        grupo={GRUPO}
        categoriaProduto={CAT}
        produtos={PRODUTOS}
        ocultacoes={ocultacoes()}
      />,
    );
    expect(html).toContain("Por produto");
    const label = html.match(/aria-label="([^"]*Molhos[^"]*)"/)?.[1] ?? "";
    expect(label).toContain("Molhos");
  });
});
