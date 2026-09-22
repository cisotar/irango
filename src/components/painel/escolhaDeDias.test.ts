import { describe, it, expect } from "vitest";

import {
  ESCOLHA_PADRAO,
  MOTIVO_CATEGORIA_SEM_DIAS,
  MOTIVO_SEM_DIA,
  diasDaEscolha,
  escolhaValida,
  payloadDeAdicao,
  type EscolhaDeDias,
} from "./escolhaDeDias";

const CARDAPIO = "c1";

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

  it("payloadDeAdicao devolve EXATAMENTE três chaves — nem loja_id, nem nome", () => {
    const payload = payloadDeAdicao(CARDAPIO, ["p1", "p2"], {
      modo: "dias",
      dias: [3, 1],
    });
    expect(payload).toEqual({
      cardapio_id: CARDAPIO,
      produto_ids: ["p1", "p2"],
      dias_semana: [1, 3],
    });
    expect(Object.keys(payload)).toHaveLength(3);
  });

  it("no modo 'cardapio' o payload leva `[]` — quem traduz para NULL é o SERVIDOR", () => {
    expect(payloadDeAdicao(CARDAPIO, ["p1"], ESCOLHA_PADRAO)).toEqual({
      cardapio_id: CARDAPIO,
      produto_ids: ["p1"],
      dias_semana: [],
    });
  });

  it("os dois motivos são frases completas, não fragmentos de tooltip", () => {
    expect(MOTIVO_SEM_DIA).toBe("Marque pelo menos um dia para continuar.");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("todos os dias do cardápio");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("marque os produtos um a um");
  });
});
