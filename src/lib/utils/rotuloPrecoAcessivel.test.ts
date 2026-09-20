import { describe, it, expect } from "vitest";

import { rotuloPrecoAcessivel } from "./rotuloPrecoAcessivel";

// `R$` + U+00A0 (espaço não separável) é o que o Intl pt-BR emite. As asserções
// são byte a byte de propósito: a frase é o que o cliente cego ouve, e um
// espaço comum aqui seria uma segunda formatação de moeda entrando pela porta
// dos fundos.
const NBSP = " ";

describe("rotuloPrecoAcessivel", () => {
  it("com desconto, anuncia de/por com os dois preços formatados", () => {
    expect(
      rotuloPrecoAcessivel({ preco: 100, precoEfetivo: 80, temDesconto: true }),
    ).toBe(`De R$${NBSP}100,00 por R$${NBSP}80,00`);
  });

  it("sem desconto, anuncia só o preço efetivo — não inventa 'de/por'", () => {
    expect(
      rotuloPrecoAcessivel({ preco: 80, precoEfetivo: 80, temDesconto: false }),
    ).toBe(`R$${NBSP}80,00`);
  });

  it("sem desconto, ignora `preco` mesmo se divergir de `precoEfetivo`", () => {
    // `temDesconto` é a decisão do servidor; o componente não a reinterpreta.
    expect(
      rotuloPrecoAcessivel({ preco: 100, precoEfetivo: 80, temDesconto: false }),
    ).toBe(`R$${NBSP}80,00`);
  });

  it("formata milhar e centavos pelo mesmo formatador do projeto", () => {
    expect(
      rotuloPrecoAcessivel({
        preco: 1234.56,
        precoEfetivo: 999.9,
        temDesconto: true,
      }),
    ).toBe(`De R$${NBSP}1.234,56 por R$${NBSP}999,90`);
  });
});
