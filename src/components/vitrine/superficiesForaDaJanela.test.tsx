/**
 * Issue 262 — o cliente VÊ o que o servidor já decidiu: o produto fora da
 * janela do cardápio aparece, marcado, sem botão de compra, com o selo dizendo
 * QUANDO VOLTA. Reuso literal do padrão de `esgotado` (D4): nenhum estilo novo,
 * nenhum componente novo, só o texto muda.
 *
 * Ambiente: vitest `environment: node`, sem jsdom — `renderToStaticMarkup` +
 * asserção estática sobre a fonte para o `ProdutoModal` (o `Dialog` do Base UI
 * usa portal e devolve string vazia no SSR). Mesmo precedente de
 * `superficiesPromocao.test.tsx` / `superficiesProdutoVitrine.test.tsx`.
 *
 * Nada de vigência é avaliado aqui nem nos componentes: `compravel`,
 * `motivoNaoCompravel` e a frase do selo chegam PRONTOS do servidor
 * (`projetarCatalogoVitrine`, issues 247/254).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { ROTULO_SEM_VOLTA } from "@/lib/utils/descreverVigencia";

import { CardProduto } from "./CardProduto";
import { ItemProdutoLista } from "./ItemProdutoLista";
import { SecaoCatalogo, type CategoriaComProdutos } from "./SecaoCatalogo";
import type { SecaoVitrine } from "@/lib/utils/catalogoVitrine";
import {
  ROTULO_ESGOTADO,
  rotuloAcessivelNaoCompravel,
  rotuloCtaNaoCompravel,
  rotuloNaoCompravel,
} from "./rotuloEsgotado";

/**
 * [263] As fixtures continuam descrevendo CATEGORIAS — é o mesmo objeto de
 * sempre. `SecaoCatalogo` passou a exigir o discriminante `tipo` (SecaoVitrine),
 * então ele é acrescentado aqui, num lugar só, em vez de espalhado por cada
 * literal: o que os testes abaixo afirmam não mudou.
 */
const comoSecoes = (categorias: CategoriaComProdutos[]): SecaoVitrine[] =>
  categorias.map((categoria) => ({ ...categoria, tipo: "categoria" }));

const ID = "p-feijoada";
const NOME = "Feijoada completa";
/** A frase real que `descreverVigencia::rotuloVoltaQuando` produz (cenário 1). */
const ROTULO = "Sáb e dom, 11:00–15:00";

function produto(over: Partial<ProdutoVitrine> = {}): ProdutoVitrine {
  return {
    id: ID,
    nome: NOME,
    descricao: "com couve",
    foto_url: null,
    categoria_id: null,
    preco: 100,
    precoEfetivo: 100,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: false,
    motivoNaoCompravel: "fora_da_janela",
    ...over,
  };
}

const FORA_DA_JANELA = produto();
const ESGOTADO = produto({ motivoNaoCompravel: "esgotado" });
const COMPRAVEL = produto({ compravel: true, motivoNaoCompravel: null });

const ROTULOS = { [ID]: ROTULO };

function categorias(
  comImagens: boolean,
  produtos: ProdutoVitrine[],
): CategoriaComProdutos[] {
  return [
    { id: "cat-1", nome: "Pratos", exibir_imagens: comImagens, produtos },
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// O módulo de rótulo — fonte ÚNICA das quatro superfícies
// ───────────────────────────────────────────────────────────────────────────

describe("262 rotuloEsgotado — um módulo, dois motivos", () => {
  it("`fora_da_janela` imprime a frase do servidor; `esgotado` segue 'Esgotado'", () => {
    expect(rotuloNaoCompravel("fora_da_janela", ROTULO)).toBe(ROTULO);
    expect(rotuloNaoCompravel("esgotado", ROTULO)).toBe(ROTULO_ESGOTADO);
  });

  it("chave AUSENTE no mapa ⇒ 'Indisponível no momento', nunca selo vazio", () => {
    expect(rotuloNaoCompravel("fora_da_janela", undefined)).toBe(
      ROTULO_SEM_VOLTA,
    );
    expect(rotuloNaoCompravel("fora_da_janela", "")).toBe(ROTULO_SEM_VOLTA);
    expect(ROTULO_SEM_VOLTA).toBe("Indisponível no momento");
  });

  it("o rótulo acessível carrega o motivo, e o de esgotado não muda (225)", () => {
    expect(rotuloAcessivelNaoCompravel(NOME, "fora_da_janela", ROTULO)).toBe(
      `${NOME} — ${ROTULO}`,
    );
    expect(rotuloAcessivelNaoCompravel(NOME, "esgotado")).toBe(
      `${NOME} esgotado`,
    );
  });

  it("o CTA do modal é CURTO: a frase de vigência nunca vira rótulo de botão", () => {
    expect(rotuloCtaNaoCompravel("fora_da_janela")).toBe("Produto indisponível");
    expect(rotuloCtaNaoCompravel("esgotado")).toBe("Produto esgotado");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Superfície A — CardProduto (grid)
// ───────────────────────────────────────────────────────────────────────────

describe("262 CardProduto — a pílula diz quando volta, e o card continua abrindo", () => {
  const html = () =>
    renderToStaticMarkup(
      <CardProduto idNaSecao="cat-x:p-1"
        produto={FORA_DA_JANELA}
        rotuloIndisponivel={ROTULO}
        onAdicionar={() => {}}
      />,
    );

  it("a pílula traz a frase do servidor, não 'Esgotado'", () => {
    expect(html()).toContain(ROTULO);
    expect(html()).not.toContain(">Esgotado<");
  });

  it("é a MESMA pílula de 225 — mesmo overlay, mesma opacidade do corpo", () => {
    expect(html()).toContain("bg-black/35");
    expect(html()).toContain("[&amp;_.card-body]:opacity-60");
  });

  it("o botão '+' fica `disabled` E `pointer-events-none` (o toque atravessa)", () => {
    const marcado = html();
    expect(marcado).toContain("disabled");
    expect(marcado).toContain("pointer-events-none");
    // No comprável nem uma classe a mais: a árvore é a de hoje.
    const bom = renderToStaticMarkup(
      <CardProduto idNaSecao="cat-x:p-1"
        produto={COMPRAVEL}
        rotuloIndisponivel={ROTULO}
        onAdicionar={() => {}}
      />,
    );
    expect(bom).not.toContain("pointer-events-none");
    expect(bom).not.toContain(ROTULO);
  });

  it("o `aria-label` do '+' carrega o motivo inteiro (o leitor de tela ouve a frase)", () => {
    expect(html()).toContain(`aria-label="${NOME} — ${ROTULO}"`);
  });

  it("chave ausente ⇒ a pílula degrada visível, nunca em branco", () => {
    const semRotulo = renderToStaticMarkup(
      <CardProduto idNaSecao="cat-x:p-1" produto={FORA_DA_JANELA} onAdicionar={() => {}} />,
    );
    expect(semRotulo).toContain(ROTULO_SEM_VOLTA);
  });

  it("`esgotado` renderiza exatamente como em 225 (não-regressão)", () => {
    const html225 = renderToStaticMarkup(
      <CardProduto idNaSecao="cat-x:p-1" produto={ESGOTADO} onAdicionar={() => {}} />,
    );
    expect(html225).toContain(ROTULO_ESGOTADO);
    expect(html225).toContain(`aria-label="${NOME} esgotado"`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Superfície B — ItemProdutoLista (categoria com exibir_imagens = false)
// ───────────────────────────────────────────────────────────────────────────

describe("262 ItemProdutoLista — a mesma pílula, inline, na variante textual", () => {
  const html = renderToStaticMarkup(
    <ItemProdutoLista
      produto={FORA_DA_JANELA}
      rotuloIndisponivel={ROTULO}
      onSelecionar={() => {}}
    />,
  );

  it("a pílula usa os tokens `--indisponivel-*`, nunca a cor do tema da loja", () => {
    expect(html).toContain("bg-indisponivel-fundo");
    expect(html).toContain("text-indisponivel-texto");
    expect(html).not.toContain("var(--cor-destaque)");
  });

  it("imprime a frase do servidor e a anuncia uma vez só, no texto acessível", () => {
    expect(html).toContain(ROTULO);
    expect(html).toContain(`${NOME} — ${ROTULO}`);
  });

  it("a linha não comprável não é alvo de clique (D13 segue valendo)", () => {
    expect(html).not.toContain('role="button"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Superfície D — o catálogo inteiro (e, por ser subtrativo, a busca)
// ───────────────────────────────────────────────────────────────────────────

describe("262 SecaoCatalogo — `rotulosVigencia` desce às duas variantes", () => {
  it("grid: a frase chega ao card", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo
        secoes={comoSecoes(categorias(true, [FORA_DA_JANELA]))}
        rotulosVigencia={ROTULOS}
      />,
    );
    expect(html).toContain(ROTULO);
  });

  it("lista textual: a frase chega à linha", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo
        secoes={comoSecoes(categorias(false, [FORA_DA_JANELA]))}
        rotulosVigencia={ROTULOS}
      />,
    );
    expect(html).toContain(ROTULO);
  });

  it("mapa VAZIO ⇒ 'Indisponível no momento' — degradação visível, nunca branco", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo
        secoes={comoSecoes(categorias(true, [FORA_DA_JANELA]))}
        rotulosVigencia={{}}
      />,
    );
    expect(html).toContain(ROTULO_SEM_VOLTA);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Superfície C — ProdutoModal (portal; asserção estática sobre a fonte)
// ───────────────────────────────────────────────────────────────────────────

const DIR_VITRINE = join(process.cwd(), "src/components/vitrine");
const fonte = (arquivo: string) =>
  readFileSync(join(DIR_VITRINE, arquivo), "utf8");

describe("262 ProdutoModal — selo e CTA dirigidos pelo MOTIVO", () => {
  const modal = fonte("ProdutoModal.tsx");

  it("o selo central imprime o rótulo do módulo único, não o literal 'Esgotado'", () => {
    expect(modal).toContain("✕ {rotuloIndisponivel}");
    expect(modal).toContain("rotuloNaoCompravel(");
    expect(modal).not.toContain("✕ Esgotado");
  });

  it("o CTA desabilitado sai de `rotuloCtaNaoCompravel`", () => {
    expect(modal).toContain("rotuloCtaNaoCompravel(produto.motivoNaoCompravel)");
    // O literal saiu do `.tsx`: quem o escreve agora é o módulo único.
    expect(modal).not.toContain("Produto esgotado");
  });

  it("o modal ABRE e não adiciona nada: não há CTA de adicionar no ramo indisponível", () => {
    // O bloco de adicionar é guardado por `disponivel`; o de indisponível é o
    // botão `disabled`. Os dois ramos são mutuamente exclusivos na fonte.
    expect(modal).toContain("{!disponivel ? (");
    expect(modal).toContain("disabled");
  });

  it("o rótulo desce pelo tipo do modal, não por campo novo em `ProdutoVitrine`", () => {
    expect(modal).toContain("rotuloIndisponivel?: string;");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A trava que o design pediu por escrito
// ───────────────────────────────────────────────────────────────────────────

describe("262 — nenhum componente de selo de vigência foi criado", () => {
  it("a indisponibilidade é a pílula que as superfícies já imprimem", () => {
    // Montado por partes: um teste que escrevesse o nome por extenso seria o
    // próprio resultado que o `grep -rn` do critério de aceite deve não achar.
    const proibido = ["Selo", "Vigencia"].join("");
    for (const arquivo of [
      "CardProduto.tsx",
      "ItemProdutoLista.tsx",
      "ProdutoModal.tsx",
      "SecaoCatalogo.tsx",
    ]) {
      expect(fonte(arquivo)).not.toContain(proibido);
    }
  });
});
