/** `environment: node`, sem jsdom — `renderToStaticMarkup`, padrão do repo. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PrecoProduto } from "./PrecoProduto";

const NBSP = " ";
const COM_DESCONTO = { preco: 100, precoEfetivo: 80, temDesconto: true };
const SEM_DESCONTO = { preco: 80, precoEfetivo: 80, temDesconto: false };

describe("PrecoProduto", () => {
  it("sem desconto, não risca preço nenhum e não duplica leitura", () => {
    const html = renderToStaticMarkup(
      <PrecoProduto produto={SEM_DESCONTO} tamanho="card" />,
    );
    expect(html).toContain(`R$${NBSP}80,00`);
    expect(html).not.toMatch(/<s[ >]/);
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("aria-hidden");
    expect(html).not.toContain("De R$");
  });

  it("sem desconto, ignora `preco` divergente — quem decide é temDesconto", () => {
    const html = renderToStaticMarkup(
      <PrecoProduto
        produto={{ preco: 100, precoEfetivo: 80, temDesconto: false }}
        tamanho="lista"
      />,
    );
    expect(html).not.toContain(`R$${NBSP}100,00`);
    expect(html).not.toMatch(/<s[ >]/);
  });

  it("com desconto, risca o preço de tabela e destaca o efetivo", () => {
    const html = renderToStaticMarkup(
      <PrecoProduto produto={COM_DESCONTO} tamanho="card" />,
    );
    expect(html).toContain(`<s aria-hidden="true"`);
    expect(html).toContain(`R$${NBSP}100,00`);
    expect(html).toContain(`R$${NBSP}80,00`);
  });

  it("com desconto, o par visual é aria-hidden e a verdade é uma frase sr-only", () => {
    const html = renderToStaticMarkup(
      <PrecoProduto produto={COM_DESCONTO} tamanho="modal" />,
    );
    expect(html).toContain(
      `<span class="sr-only">De R$${NBSP}100,00 por R$${NBSP}80,00</span>`,
    );
    // Os dois preços visíveis saem da árvore acessível: `<s>` sozinho não é
    // anunciado, então ouvir os dois números soltos confundiria.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
  });

  it("o tamanho é obrigatório e muda só a escala, nunca o conteúdo", () => {
    const tamanhos = ["card", "lista", "modal"] as const;
    const htmls = tamanhos.map((tamanho) =>
      renderToStaticMarkup(
        <PrecoProduto produto={COM_DESCONTO} tamanho={tamanho} />,
      ),
    );
    for (const html of htmls) {
      expect(html).toContain(`De R$${NBSP}100,00 por R$${NBSP}80,00`);
    }
    expect(new Set(htmls).size).toBe(3);
  });
});
