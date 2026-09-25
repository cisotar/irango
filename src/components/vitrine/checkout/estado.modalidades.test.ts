// Spec modalidades-entrega-loja — funções puras do checkout: modalidade
// pré-selecionada e o aviso de endereço fora da área.
import { describe, it, expect } from "vitest";

import { textoForaDaArea, tipoEntregaInicial } from "./estado";

describe("tipoEntregaInicial", () => {
  it.each([
    [true, true, null],
    [true, false, "entrega"],
    [false, true, "retirada"],
    [false, false, null],
  ] as const)("entrega=%s retirada=%s → %s", (entrega, retirada, esperado) => {
    expect(tipoEntregaInicial(entrega, retirada)).toBe(esperado);
  });
});

describe("textoForaDaArea", () => {
  it("retirada + WhatsApp: a frase da spec, inteira", () => {
    expect(textoForaDaArea(true, true)).toBe(
      "Este endereço fica fora da área de entrega. Escolha retirada na loja ou fale com a loja no WhatsApp.",
    );
  });

  it("sem retirada: perde 'Escolha retirada na loja'", () => {
    const t = textoForaDaArea(false, true);
    expect(t).not.toMatch(/retirada/i);
    expect(t).toMatch(/WhatsApp/);
  });

  it("sem WhatsApp: não manda o cliente para um WhatsApp que não existe", () => {
    const t = textoForaDaArea(true, false);
    expect(t).not.toMatch(/WhatsApp/);
    expect(t).toMatch(/Escolha retirada na loja/);
  });

  it("sem retirada e sem WhatsApp: ainda manda o cliente agir", () => {
    const t = textoForaDaArea(false, false);
    expect(t).not.toMatch(/retirada|WhatsApp/i);
    expect(t).toMatch(/Tente outro endereço/);
  });
});
