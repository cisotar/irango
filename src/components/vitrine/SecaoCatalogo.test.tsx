/**
 * Fase RED (TDD) da issue 086 — propagação de `disponivel` até a vitrine.
 *
 * Contexto: `buscarCatalogoPublico` passa a retornar produtos esgotados
 * (`disponivel = false`, não-ocultos). Sem fechar a cadeia de propagação
 * (page.tsx → SecaoCatalogo → CardProduto), o produto esgotado APARECE mas
 * renderiza como DISPONÍVEL — pior que hoje. Este teste prova o contrato de UI:
 * `SecaoCatalogo` deve levar `disponivel` de cada produto ao `CardProduto`, que
 * então renderiza o estado "esgotado" (ribbon + botão desabilitado + aria-label).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia idêntica ao
 * HeaderLoja.test.tsx: renderToStaticMarkup (react-dom/server) para asserções
 * sobre o HTML gerado. `useCarrinho` usa store de módulo + useSyncExternalStore
 * com getServerSnapshot (carrinho vazio no SSR) — não exige provider.
 *
 * Por que é RED de verdade HOJE: `ProdutoCatalogo` (SecaoCatalogo.tsx) NÃO tem
 * campo `disponivel` e o `<CardProduto>` é montado SEM `disponivel` → default
 * `true`. Logo o card do produto esgotado renderiza como disponível (sem ribbon
 * "Esgotado", com o botão habilitado). A asserção do estado esgotado cai vermelha.
 * A GREEN fecha a cadeia (adiciona `disponivel` ao type e passa ao CardProduto).
 *
 * O estado visual do "esgotado" em si é contrato de CardProduto (já suportado);
 * aqui provamos SÓ a PROPAGAÇÃO do dado por SecaoCatalogo, não a matriz visual.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ancoraCategoria } from "@/lib/utils/ancoraCategoria";

import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";

import { SecaoCatalogo, type CategoriaComProdutos } from "./SecaoCatalogo";
import type { SecaoVitrine } from "@/lib/utils/catalogoVitrine";

/**
 * [263] As fixtures continuam descrevendo CATEGORIAS — é o mesmo objeto de
 * sempre. `SecaoCatalogo` passou a exigir o discriminante `tipo` (SecaoVitrine),
 * então ele é acrescentado aqui, num lugar só, em vez de espalhado por cada
 * literal: o que os testes abaixo afirmam não mudou.
 */
const comoSecoes = (categorias: CategoriaComProdutos[]): SecaoVitrine[] =>
  categorias.map((categoria) => ({ ...categoria, tipo: "categoria" }));

/**
 * Fixture do contrato de catálogo (224/225). As ASSERÇÕES abaixo são as mesmas
 * de sempre — só o SHAPE do produto mudou, de campos avulsos para o
 * `ProdutoVitrine` inteiro. Sem desconto vigente, `precoEfetivo === preco`, e é
 * por isso que todo preço esperado nos testes continua idêntico.
 */
function produtoVitrine(over: Partial<ProdutoVitrine> = {}): ProdutoVitrine {
  const preco = over.preco ?? 5;
  return {
    id: "p-1",
    nome: "Produto",
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco,
    precoEfetivo: preco,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
    ...over,
  };
}

function categoriasFixture(): CategoriaComProdutos[] {
  const disponivel: ProdutoVitrine = produtoVitrine({
    id: "p-disp",
    nome: "Coca Gelada",
    descricao: null,
    preco: 5,
    foto_url: null,
    categoria_id: "cat-bebidas",
  });
  const esgotado: ProdutoVitrine = produtoVitrine({
    id: "p-esg",
    nome: "Suco Esgotado",
    descricao: null,
    preco: 7,
    foto_url: null,
    categoria_id: "cat-bebidas",
    compravel: false,
    motivoNaoCompravel: "esgotado",
  });
  return [
    {
      id: "cat-bebidas",
      nome: "Bebidas",
      produtos: [disponivel, esgotado],
    },
  ];
}

describe("086 SecaoCatalogo — propaga `disponivel` ao CardProduto", () => {
  it("produto INDISPONÍVEL renderiza estado 'esgotado' (ribbon + botão desabilitado)", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasFixture())} />,
    );

    // CardProduto com disponivel=false: ribbon "Esgotado" + aria-label de esgotado.
    expect(html).toContain("Esgotado");
    expect(html).toContain('aria-label="Suco Esgotado esgotado"');
    // O botão do produto esgotado precisa estar desabilitado.
    const trecho = html.slice(html.indexOf("Suco Esgotado"));
    expect(trecho).toContain("disabled");
  });

  it("produto DISPONÍVEL segue clicável (aria-label de adicionar, sem 'esgotado')", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasFixture())} />,
    );

    // O disponível mantém o aria-label de adicionar, agora com o preço que o
    // leitor de tela precisa ouvir (233 — `rotuloPrecoAcessivel`). Sem desconto
    // a frase é só o preço efetivo: nada de "de/por" inventado.
    expect(html).toContain(
      'aria-label="Adicionar Coca Gelada ao carrinho, R$\u00a05,00"',
    );
    expect(html).not.toContain('aria-label="Coca Gelada esgotado"');
  });
});

/**
 * Issue "toggle-imagens-por-categoria" (RN-3/RN-4): por grupo, `SecaoCatalogo`
 * escolhe `CardProduto` (grid, exibir_imagens true/ausente) ou
 * `ItemProdutoLista` (lista textual, exibir_imagens false) — nunca mistura os
 * dois no mesmo grupo. A escolha vem pronta do dado resolvido no servidor.
 */
describe("toggle-imagens-por-categoria — SecaoCatalogo escolhe grid ou lista por grupo", () => {
  function categoriasComToggle(): CategoriaComProdutos[] {
    const salgado: ProdutoVitrine = produtoVitrine({
      id: "p-salgado",
      nome: "Coxinha de frango",
      descricao: null,
      preco: 8.5,
      foto_url: null,
      categoria_id: "cat-salgados",
    });
    const bebida: ProdutoVitrine = produtoVitrine({
      id: "p-bebida",
      nome: "Suco de laranja 500ml",
      descricao: null,
      preco: 9,
      foto_url: "https://exemplo.com/suco.jpg",
      categoria_id: "cat-bebidas",
    });
    return [
      {
        id: "cat-salgados",
        nome: "Salgados",
        exibir_imagens: true,
        produtos: [salgado],
      },
      {
        id: "cat-bebidas",
        nome: "Bebidas",
        exibir_imagens: false,
        produtos: [bebida],
      },
    ];
  }

  it("grupo com exibir_imagens=true renderiza CardProduto (grid, com área de imagem)", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasComToggle())} />,
    );

    // CardProduto expõe o botão "Adicionar X ao carrinho" (contrato do grid).
    expect(html).toContain(
      'aria-label="Adicionar Coxinha de frango ao carrinho, R$\u00a08,50"',
    );
  });

  it("grupo com exibir_imagens=false renderiza ItemProdutoLista (sem imagem)", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasComToggle())} />,
    );

    // ItemProdutoLista: role="button" + aria-label "Ver detalhes de..." — sem
    // botão de adicionar rápido, sem <img>/foto_url no HTML da linha.
    // Nota: formatarMoeda usa Intl.NumberFormat pt-BR, que insere um espaço
    // NBSP (U+00A0) entre "R$" e o valor — não um espaço comum.
    expect(html).toContain(
      "aria-label=\"Ver detalhes de Suco de laranja 500ml, R$ 9,00\"",
    );
    expect(html).not.toContain(
      'aria-label="Adicionar Suco de laranja 500ml ao carrinho"',
    );
    expect(html).not.toContain("exemplo.com/suco.jpg");
  });
});

/**
 * Issue 201 — a âncora da seção vem de `ancoraCategoria` (fonte única) e o
 * deslocamento de âncora passa a ser a altura MEDIDA da barra sticky
 * (`--altura-barra`), não mais a antiga classe fixa de scroll-margin. Falha
 * silenciosa em produção (título escondido atrás da barra) não quebra build
 * nem tipo — só este teste pega.
 */
describe("201 SecaoCatalogo — âncora compartilhada e scroll-margin medido", () => {
  function categoriasComGrupoSemId(): CategoriaComProdutos[] {
    const produto: ProdutoVitrine = produtoVitrine({
      id: "p-1",
      nome: "Pão na chapa",
      descricao: null,
      preco: 6,
      foto_url: null,
      categoria_id: null,
    });
    return [
      { id: null, nome: "Outros", produtos: [produto] },
      { id: "cat-doces", nome: "Doces", produtos: [produto] },
    ];
  }

  it("o id da seção é exatamente `ancoraCategoria(id, indice)`", () => {
    const categorias = categoriasComGrupoSemId();
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categorias)} />,
    );

    categorias.forEach((categoria, indice) => {
      expect(html).toContain(`id="${ancoraCategoria(categoria.id, indice)}"`);
    });
  });

  it('grupo sem id ("Outros") vira `grupo-<indice>`', () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasComGrupoSemId())} />,
    );

    expect(html).toContain('id="grupo-0"');
    expect(html).toContain('id="cat-cat-doces"');
  });

  it("a seção usa scroll-margin-top medido e NÃO a antiga classe fixa de scroll-margin", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasFixture())} />,
    );

    expect(html).toContain("scroll-margin-top:calc(var(--altura-barra)");
    // Montada por concatenação: um literal contíguo aqui seria varrido pelo
    // scanner de texto do Tailwind v4 e geraria um utilitário órfão no CSS
    // compilado (achado verificar/201) — mesmo sem nenhuma className usá-lo.
    expect(html).not.toContain(["scroll", "mt", "24"].join("-"));
  });
});

/**
 * Issue 200 — repasse do `termo` de busca até o realce do nome.
 *
 * O casamento vive em `partirPorTermo` (199, testado em buscarProdutos.test.ts)
 * e a projeção em DOM em `TextoRealcado.test.tsx`. Aqui se prova só a CADEIA:
 * `SecaoCatalogo` leva `termo` aos dois ramos (grid e lista) e, sem termo, a
 * vitrine renderiza exatamente como antes.
 */
describe("SecaoCatalogo (200) — realce do trecho casado", () => {
  function categoriasPao(exibirImagens: boolean): CategoriaComProdutos[] {
    return [
      {
        id: "cat-paes",
        nome: "Pães",
        exibir_imagens: exibirImagens,
        produtos: [
          produtoVitrine({
            id: "p-pao",
            nome: "Pão na chapa",
            descricao: null,
            preco: 6,
            foto_url: null,
            categoria_id: "cat-paes",
          }),
        ],
      },
    ];
  }

  it("sem termo (e com termo vazio) o HTML é byte a byte o de antes, sem <mark>", () => {
    const categorias = categoriasFixture();
    const semTermo = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categorias)} />,
    );
    const termoVazio = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categorias)} termo="" />,
    );

    expect(termoVazio).toBe(semTermo);
    expect(semTermo).not.toContain("<mark");
  });

  it("com termo, o ramo de grid realça o nome preservando o acento", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasPao(true))} termo="pao" />,
    );

    expect(html).toMatch(/<mark[^>]*>Pão<\/mark>/);
  });

  it("com termo, o ramo de lista (exibir_imagens=false) também realça", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasPao(false))} termo="pao" />,
    );

    expect(html).toMatch(/<mark[^>]*>Pão<\/mark>/);
  });

  it("`alt` e `aria-label` continuam com o nome cru, sem <mark> dentro", () => {
    const grid = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasPao(true))} termo="pao" />,
    );
    const lista = renderToStaticMarkup(
      <SecaoCatalogo rotulosVigencia={{}} secoes={comoSecoes(categoriasPao(false))} termo="pao" />,
    );

    expect(grid).toContain(
      'aria-label="Adicionar Pão na chapa ao carrinho, R$\u00a06,00"',
    );
    expect(lista).toContain('aria-label="Ver detalhes de Pão na chapa,');
  });
});
