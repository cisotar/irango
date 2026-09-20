// Testes do helper `LinhaItemPedido` (239 / RN-14, D7).
//
// O gatilho é UM só: `preco_original`. NULL ⇒ `null` ⇒ nenhuma superfície
// renderiza nada. Não-NULL ⇒ par UNITÁRIO, com `/un.` quando quantidade > 1.
// Nenhum total de linha sai daqui — isso é `totalDaLinha` (RN-20).

import { describe, it, expect } from "vitest";

import { parDePor, textoDePor } from "./linhaItemPedido";

// O Intl usa U+00A0 entre "R$" e o número; normalizamos para asserção legível.
const norm = (s: string) => s.replace(/\u00a0/g, " ");

describe("parDePor — o gatilho é preco_original", () => {
  it("preco_original null ⇒ null (nada é renderizado)", () => {
    expect(
      parDePor({ preco: 80, preco_original: null, quantidade: 1 }),
    ).toBeNull();
    expect(
      textoDePor({ preco: 80, preco_original: null, quantidade: 3 }),
    ).toBeNull();
  });

  it("com desconto e quantidade 1 ⇒ par unitário SEM sufixo", () => {
    const par = parDePor({ preco: 80, preco_original: 100, quantidade: 1 });
    expect(par && { ...par, de: norm(par.de), por: norm(par.por) }).toEqual({
      teve: true,
      de: "R$ 100,00",
      por: "R$ 80,00",
      sufixo: "",
    });
  });

  it("com desconto e quantidade > 1 ⇒ o par continua UNITÁRIO e ganha /un.", () => {
    // 2× Pizza de tabela R$ 50,00 por R$ 40,00: o par NÃO vira R$ 100,00/R$ 80,00.
    const par = parDePor({ preco: 40, preco_original: 50, quantidade: 2 });
    expect(par && { ...par, de: norm(par.de), por: norm(par.por) }).toEqual({
      teve: true,
      de: "R$ 50,00",
      por: "R$ 40,00",
      sufixo: "/un.",
    });
  });
});

describe("textoDePor — a frase de texto plano (WhatsApp e térmica)", () => {
  it("quantidade 1: só 'de R$ 100,00' (o 'por' é o total da linha ao lado)", () => {
    expect(
      norm(textoDePor({ preco: 80, preco_original: 100, quantidade: 1 }) ?? ""),
    ).toBe("de R$ 100,00");
  });

  it("quantidade > 1: 'de X por Y/un.' — o preço pago não aparece em outro lugar", () => {
    expect(
      norm(textoDePor({ preco: 40, preco_original: 50, quantidade: 2 }) ?? ""),
    ).toBe("de R$ 50,00 por R$ 40,00/un.");
  });

  it("nunca usa ~tachado~ nem qualquer marcação do WhatsApp", () => {
    const texto =
      textoDePor({ preco: 40, preco_original: 50, quantidade: 2 }) ?? "";
    expect(texto).not.toContain("~");
    expect(texto).not.toContain("*");
    expect(texto).not.toContain("_");
  });
});
