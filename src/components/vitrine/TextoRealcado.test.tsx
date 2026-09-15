/**
 * Issue 200 — projeção do casamento de `partirPorTermo` em nós React.
 *
 * O casamento de string em si já é coberto por `lib/utils/buscarProdutos.test.ts`
 * (acento, caixa, múltiplas ocorrências, combinante solto, termo vazio). Aqui se
 * testa SÓ a projeção em DOM: onde o `<mark>` cai, que ele some quando não há
 * match, e que conteúdo de lojista continua escapado (seguranca.md §15).
 *
 * Ambiente: vitest environment=node, sem jsdom — `renderToStaticMarkup`, o mesmo
 * padrão de `SecaoCatalogo.test.tsx` e `HeaderLoja.test.tsx`.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TextoRealcado } from "./TextoRealcado";

/** Remove só as tags de realce, para provar a invariante de conteúdo. */
function semTagsDeMarca(html: string): string {
  return html.replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "");
}

describe("TextoRealcado (200)", () => {
  it("realça o trecho casado preservando o acento da string original", () => {
    const html = renderToStaticMarkup(
      <TextoRealcado texto="Pão francês" termo="pao" />,
    );

    expect(html).toContain("<mark");
    expect(html).toMatch(/<mark[^>]*>Pão<\/mark>/);
    expect(html).toContain("francês");
  });

  it("sem termo, o HTML é idêntico ao do texto cru — zero <mark>", () => {
    const texto = "Pão francês";
    const cru = renderToStaticMarkup(<>{texto}</>);

    expect(renderToStaticMarkup(<TextoRealcado texto={texto} />)).toBe(cru);
    expect(renderToStaticMarkup(<TextoRealcado texto={texto} termo="" />)).toBe(
      cru,
    );
    expect(
      renderToStaticMarkup(<TextoRealcado texto={texto} termo="   " />),
    ).toBe(cru);
    expect(renderToStaticMarkup(<TextoRealcado texto={texto} />)).not.toContain(
      "<mark",
    );
  });

  it("termo sem match no texto não gera <mark> nem altera o HTML", () => {
    const texto = "Pão francês";

    expect(
      renderToStaticMarkup(<TextoRealcado texto={texto} termo="pizza" />),
    ).toBe(renderToStaticMarkup(<>{texto}</>));
  });

  it("realça todas as ocorrências", () => {
    const html = renderToStaticMarkup(
      <TextoRealcado texto="Pão de queijo com pão" termo="pao" />,
    );

    expect(html.match(/<mark/g)).toHaveLength(2);
  });

  it("texto vazio não quebra e não gera <mark>", () => {
    const html = renderToStaticMarkup(<TextoRealcado texto="" termo="pao" />);

    expect(html).toBe("");
  });

  it("payload de XSS cadastrado pelo lojista sai escapado (nenhuma tag real)", () => {
    const texto = "<img src=x onerror=alert(1)>";
    const html = renderToStaticMarkup(
      <TextoRealcado texto={texto} termo="img" />,
    );

    // O realce parte o texto no meio do payload ("&lt;" | <mark>img</mark> |
    // " src=x ..."), então a prova é estrutural: nenhuma tag real além do
    // <mark>, e o conteúdo sem as tags de realce é exatamente o texto escapado.
    expect(html).toMatch(/<mark[^>]*>img<\/mark>/);
    expect(html).not.toContain("<img");
    expect(semTagsDeMarca(html)).toBe(renderToStaticMarkup(<>{texto}</>));
  });

  it("invariante de conteúdo: remover as tags <mark> devolve o texto escapado", () => {
    const texto = "Pão & queijo <especial>";
    const html = renderToStaticMarkup(
      <TextoRealcado texto={texto} termo="pao" />,
    );

    expect(semTagsDeMarca(html)).toBe(renderToStaticMarkup(<>{texto}</>));
  });

  it("termo malicioso (input do CLIENTE, não do lojista) sai escapado dentro do <mark>", () => {
    // `termo` vem da URL/input de busca — tão não confiável quanto `texto`
    // (docstring do módulo). Aqui o payload está no TERMO, casando um produto
    // legítimo que por coincidência contém o mesmo texto bruto.
    const texto = 'Combo <img src=x onerror=alert(1)>';
    const termo = '<img src=x onerror=alert(1)>';

    const html = renderToStaticMarkup(
      <TextoRealcado texto={texto} termo={termo} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toMatch(/<mark[^>]*>&lt;img src=x onerror=alert\(1\)&gt;<\/mark>/);
    expect(semTagsDeMarca(html)).toBe(renderToStaticMarkup(<>{texto}</>));
  });

  it("termo com metacaractere de regex não vira RegExp nem quebra o casamento (RN-9)", () => {
    // Se `partirPorTermo` algum dia trocasse indexOf por RegExp a partir do
    // termo cru, ".*" casaria QUALQUER produto e "(" lançaria SyntaxError.
    const texto = "Pão (integral) de forma";

    const comParenteses = renderToStaticMarkup(
      <TextoRealcado texto={texto} termo="(integral)" />,
    );
    expect(comParenteses).toMatch(/<mark[^>]*>\(integral\)<\/mark>/);

    expect(() =>
      renderToStaticMarkup(<TextoRealcado texto={texto} termo=".*" />),
    ).not.toThrow();
    // ".*" não é substring literal de "pao (integral) de forma" normalizado →
    // sem match, sem <mark>. Uma RegExp construída do termo casaria tudo.
    expect(
      renderToStaticMarkup(<TextoRealcado texto={texto} termo=".*" />),
    ).toBe(renderToStaticMarkup(<>{texto}</>));
  });
});
