import { describe, it, expect } from "vitest";

import {
  ESCOLHA_PADRAO,
  MOTIVO_CATEGORIA_SEM_DIAS,
  MOTIVO_SEM_DIA,
  diasDaEscolha,
  escolhaValida,
  type EscolhaDeDias,
} from "./escolhaDeDias";


describe("[288/D3] escolhaDeDias — a regra da escolha, sem jsdom", () => {
  it("o padrão é 'todos os dias do cardápio' — zero clique para o caso comum", () => {
    expect(ESCOLHA_PADRAO).toEqual({ modo: "cardapio" });
    expect(escolhaValida(ESCOLHA_PADRAO)).toBe(true);
    expect(diasDaEscolha(ESCOLHA_PADRAO)).toEqual([]);
  });

  it("'escolher dias' ordena e não muta o array de entrada", () => {
    const dias = [6, 1, 3];
    const escolha: EscolhaDeDias = { modo: "dias", dias };
    expect(diasDaEscolha(escolha)).toEqual([1, 3, 6]);
    expect(dias, "o array recebido foi mutado").toEqual([6, 1, 3]);
  });

  it("'escolher dias' com zero dia é INVÁLIDO — o CTA não promete escrita", () => {
    expect(escolhaValida({ modo: "dias", dias: [] })).toBe(false);
    expect(escolhaValida({ modo: "dias", dias: [0] })).toBe(true);
  });

  it("no modo 'cardapio' a escolha vira `[]` — quem traduz para NULL é o SERVIDOR", () => {
    expect(diasDaEscolha(ESCOLHA_PADRAO)).toEqual([]);
  });

  it("os dois motivos são frases completas, não fragmentos de tooltip", () => {
    expect(MOTIVO_SEM_DIA).toBe("Marque pelo menos um dia para continuar.");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("todos os dias do cardápio");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("marque os produtos um a um");
  });
});
