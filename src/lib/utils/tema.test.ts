import { describe, it, expect } from "vitest";

import { montarTemaInicial, TEMA_PADRAO } from "./tema";

/**
 * Cobertura do helper de tema (issue 152). Prova a sanitização defensiva do
 * jsonb `tema` — ausente/inválido cai em `TEMA_PADRAO`, cores hex válidas passam.
 */
describe("montarTemaInicial", () => {
  it("jsonb ausente (null/undefined) → TEMA_PADRAO integral", () => {
    expect(montarTemaInicial(null)).toEqual(TEMA_PADRAO);
    expect(montarTemaInicial(undefined)).toEqual(TEMA_PADRAO);
    expect(montarTemaInicial({})).toEqual(TEMA_PADRAO);
  });

  it("cores hex válidas #RRGGBB atravessam", () => {
    const tema = { primaria: "#123456", fundo: "#abcdef", destaque: "#000000" };
    expect(montarTemaInicial(tema)).toEqual(tema);
  });

  it("cor inválida (formato errado/não-string) cai no fallback por chave", () => {
    const resultado = montarTemaInicial({
      primaria: "vermelho", // não-hex
      fundo: "#fff", // hex de 3 dígitos (não bate na regex de 6)
      destaque: 12345, // não-string
    });
    expect(resultado).toEqual(TEMA_PADRAO);
  });

  it("mistura válida + inválida → cada chave resolve isolada", () => {
    const resultado = montarTemaInicial({ primaria: "#00ff00", fundo: "nope" });
    expect(resultado.primaria).toBe("#00ff00");
    expect(resultado.fundo).toBe(TEMA_PADRAO.fundo);
    expect(resultado.destaque).toBe(TEMA_PADRAO.destaque);
  });
});
