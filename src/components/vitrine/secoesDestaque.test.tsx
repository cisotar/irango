/**
 * [263] D16 na tela — o cenário 8 do spec, renderizado.
 *
 * `environment: node`, sem jsdom: `renderToStaticMarkup` prova a ÁRVORE do
 * estado inicial (busca vazia). O estado "buscando" é interno ao
 * `CatalogoVitrine` e não é alcançável por render aqui — por isso a trava da
 * busca (RN-16) é afirmada sobre a FONTE, no último bloco: `filtrarCatalogo` e
 * `contarProdutos` só podem ver `categorias`, e isso é verificável por texto.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CatalogoVitrine } from "./CatalogoVitrine";
import { SecaoCatalogo } from "./SecaoCatalogo";
import {
  ancoraCardapio,
  ancoraCategoria,
  idNaSecao,
} from "@/lib/utils/ancoraCategoria";
import {
  agruparPorCardapio,
  projetarCatalogoVitrine,
  type ProdutoVitrine,
  type SecaoVitrine,
} from "@/lib/utils/catalogoVitrine";
import type { CardapioVigencia, VinculoVigencia } from "@/lib/utils/vigenciaCardapio";
import { instanteNoFuso } from "@/lib/utils/fusoLoja";

function produto(id: string, nome: string): ProdutoVitrine {
  return {
    id,
    nome,
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 48,
    precoEfetivo: 48,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
  };
}

// Cenário 8: duas categorias e um "Cardápio de Inverno" aberto agora, com a
// Lasanha ('menu') e a Sopa ('cardapio') dentro. As MESMAS referências de
// objeto nas duas seções — é isso que faz os dois cards dizerem o mesmo.
const LASANHA = produto("lasanha", "Lasanha");
const NHOQUE = produto("nhoque", "Nhoque");
const SOPA = produto("sopa", "Sopa de cebola");

const DESTAQUE: SecaoVitrine[] = [
  {
    id: "inverno",
    nome: "Cardápio de Inverno",
    tipo: "cardapio",
    produtos: [LASANHA, SOPA],
  },
];

const CATEGORIAS: SecaoVitrine[] = [
  { id: "massas", nome: "Massas", tipo: "categoria", produtos: [LASANHA, NHOQUE] },
  { id: "sopas", nome: "Sopas", tipo: "categoria", produtos: [SOPA] },
];

function renderizar() {
  return renderToStaticMarkup(
    <CatalogoVitrine
      categorias={CATEGORIAS}
      secoesDestaque={DESTAQUE}
      rotulosJanela={{ inverno: "Até domingo" }}
      rotulosVigencia={{}}
    />,
  );
}

describe("263 cenário 8 — 3 produtos, 5 cards, 3 seções, destaque primeiro", () => {
  it("renderiza 3 seções e 5 cards (a Lasanha e a Sopa aparecem 2× cada)", () => {
    const html = renderizar();

    expect(html.match(/<section /g)).toHaveLength(3);
    expect(html.match(/<article /g)).toHaveLength(5);
  });

  it("a seção de destaque vem ANTES da primeira categoria", () => {
    const html = renderizar();

    expect(html.indexOf(`id="${ancoraCardapio("inverno")}"`)).toBeLessThan(
      html.indexOf(`id="${ancoraCategoria("massas", 1)}"`),
    );
  });

  it("o cabeçalho traz o nome do lojista SEM prefixo e o rótulo de janela", () => {
    const html = renderizar();

    expect(html).toContain("Cardápio de Inverno");
    expect(html).not.toContain("Cardápio: Cardápio de Inverno");
    expect(html).toContain("Até domingo");
    // Nenhum badge de estado na vitrine: a seção só existe aberta (§13.1).
    expect(html).not.toContain("Aberto agora");
  });

  it("os dois cards da Lasanha dizem EXATAMENTE a mesma coisa", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo
        secoes={[...DESTAQUE, ...CATEGORIAS]}
        rotulosVigencia={{}}
        rotulosJanela={{ inverno: "Até domingo" }}
      />,
    );

    // O card inteiro, menos o id (que é escopado de propósito): idêntico byte
    // a byte porque é a MESMA referência de objeto nas duas seções (RN-16).
    const cards = [...html.matchAll(/<article [^>]*id="([^"]*lasanha)"[\s\S]*?<\/article>/g)];
    expect(cards).toHaveLength(2);
    const semId = cards.map((c) => c[0].replace(c[1], ""));
    expect(semId[0]).toBe(semId[1]);
  });

  it("o id de DOM de cada card é escopado pela seção — nenhum repetido", () => {
    const html = renderizar();

    expect(html).toContain(`id="${idNaSecao(ancoraCardapio("inverno"), "lasanha")}"`);
    expect(html).toContain(
      `id="${idNaSecao(ancoraCategoria("massas", 1), "lasanha")}"`,
    );

    const ids = [...html.matchAll(/<article [^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("o trilho ganha 3 pílulas, destaque primeiro, com href da MESMA âncora", () => {
    const html = renderizar();
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

    expect(hrefs).toEqual([
      ancoraCardapio("inverno"),
      ancoraCategoria("massas", 1),
      ancoraCategoria("sopas", 2),
    ]);
    // Antes de D16 esta loja teria 2 seções e NENHUM trilho: o destaque conta
    // para o `MINIMO_CATEGORIAS = 3`, que é o comportamento certo.
    expect(html).toContain('<nav aria-label="Categorias do cardápio"');
  });

  it("a seção de destaque usa a MESMA grade do catálogo, nunca carrossel", () => {
    const html = renderizar();

    expect(html.match(/grid grid-cols-2 gap-2\.5 md:grid-cols-3/g)).toHaveLength(3);
    expect(html).not.toContain("overflow-x-auto snap-x");
  });

  it("mesmo `scroll-margin-top` das categorias, medido da barra fixa", () => {
    const html = renderizar();

    expect(
      html.match(/scroll-margin-top:calc\(var\(--altura-barra\) \+ 0\.75rem\)/g),
    ).toHaveLength(3);
  });

  it("sem cardápio aberto, nenhuma seção de destaque — e ninguém publica nada", () => {
    const html = renderToStaticMarkup(
      <CatalogoVitrine categorias={CATEGORIAS} rotulosVigencia={{}} />,
    );

    expect(html).not.toContain("Cardápio de Inverno");
    expect(html.match(/<section /g)).toHaveLength(2);
  });
});

describe("263/RN-16 — a busca nunca vê o destaque (trava de fonte)", () => {
  const FONTE = readFileSync(
    join(process.cwd(), "src/components/vitrine/CatalogoVitrine.tsx"),
    "utf8",
  );

  it("`filtrarCatalogo` recebe `categorias`, e só", () => {
    expect(FONTE).toContain("filtrarCatalogo(categorias, termo)");
    expect(FONTE.match(/filtrarCatalogo\(/g)).toHaveLength(1);
  });

  it("`contarProdutos` recebe o resultado do filtro, e só", () => {
    expect(FONTE).toContain("contarProdutos(filtradas)");
    expect(FONTE.match(/contarProdutos\(/g)).toHaveLength(1);
  });

  it("`secoesDestaque` só é lida no ramo `emBusca === false`", () => {
    const usos = [...FONTE.matchAll(/secoesDestaque/g)];
    // Declaração no tipo, desestruturação com default, a concatenação e a
    // dependência do `useMemo`. Nenhuma outra — em especial, nenhuma dentro de
    // `filtrarCatalogo(...)` ou `contarProdutos(...)`.
    expect(usos).toHaveLength(4);
    expect(FONTE).toContain("emBusca ? filtradas : [...secoesDestaque, ...filtradas]");
  });
});

describe("279 — dia sem item do cardápio: a seção não chega a existir", () => {
  type CardapioDaLoja = CardapioVigencia & { ordem: number };

  /** "Especiais do Dia": aberto os 7 dias — quem esvazia a seção é o ITEM. */
  const ESPECIAIS: CardapioDaLoja = {
    id: "inverno",
    nome: "Cardápio de Inverno",
    ativo: true,
    modo: "recorrente",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ordem: 1,
  };

  const SP = "America/Sao_Paulo";
  /** Domingo 18/10/2026 12:00 no fuso da loja — nenhum item é de domingo. */
  const DOMINGO = new Date(instanteNoFuso("2026-10-18T12:00", SP));

  /** A Sopa ('cardapio') só é servida às quartas. */
  const SOPA_CRUA = {
    id: "sopa",
    nome: "Sopa de cebola",
    descricao: null,
    foto_url: null,
    categoria_id: "sopas",
    disponivel: true,
    preco: 48,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    visibilidade: "cardapio",
  };
  const vinculos = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
    ["sopa", [{ cardapio: ESPECIAIS, dias_semana: [3] }]],
  ]);

  function renderizarDomingo() {
    const { produtos, cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
      produtos: [SOPA_CRUA],
      vinculosPorProduto: vinculos,
      agora: DOMINGO,
      timezone: SP,
    });
    const secoesDestaque = agruparPorCardapio(
      produtos,
      cardapiosAbertos,
      vinculos,
      DOMINGO,
      SP,
    );
    // A seção nem chega ao render: o `agruparPorCardapio` já a descartou.
    expect(secoesDestaque).toEqual([]);

    return renderToStaticMarkup(
      <CatalogoVitrine
        categorias={[
          { id: "sopas", nome: "Sopas", tipo: "categoria", produtos },
        ]}
        secoesDestaque={secoesDestaque}
        rotulosJanela={{ inverno: "Hoje" }}
        rotulosVigencia={{ sopa: "Só às quartas" }}
      />,
    );
  }

  it("a âncora da seção de destaque não existe no HTML", () => {
    const html = renderizarDomingo();

    expect(html).not.toContain(`id="${ancoraCardapio("inverno")}"`);
    expect(html.match(/<section /g)).toHaveLength(1);
  });

  it("o trilho não lista o cardápio — e nem aparece, com 1 seção só", () => {
    const html = renderizarDomingo();

    expect(html).not.toContain(`href="#${ancoraCardapio("inverno")}"`);
    // Efeito colateral registrado na 279: abaixo de MINIMO_CATEGORIAS o trilho
    // some — comportamento certo, não há o que navegar.
    expect(html).not.toContain('<nav aria-label="Categorias do cardápio"');
  });

  it("o produto continua na CATEGORIA dele, marcado, com o selo do item", () => {
    const html = renderizarDomingo();

    expect(html).toContain("Sopa de cebola");
    expect(html.match(/<article /g)).toHaveLength(1);
    expect(html).toContain("Só às quartas");
  });
});
