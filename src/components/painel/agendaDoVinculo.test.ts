/**
 * [276] As funções puras da agenda do vínculo. `environment: node`, sem jsdom:
 * é aqui que "a action é chamada com três chaves e nada mais" fica travado.
 */

import { describe, it, expect } from "vitest";

import {
  alternarDiaDoVinculo,
  payloadDeDias,
  payloadsDeDiasEmLote,
  podeDefinirDias,
} from "./agendaDoVinculo";
import { schemaDiasDoVinculo } from "@/lib/validacoes/cardapio";

const CARDAPIO = "11111111-1111-4111-8111-111111111111";
const PRODUTO = "22222222-2222-4222-8222-222222222222";

describe("alternarDiaDoVinculo", () => {
  it("marca um dia mantendo a lista ordenada", () => {
    expect(alternarDiaDoVinculo([6], 3)).toEqual([3, 6]);
  });

  it("desmarca um dia já marcado", () => {
    expect(alternarDiaDoVinculo([3, 6], 3)).toEqual([6]);
  });

  it("null é 'todos os dias do cardápio' e vira uma lista de um", () => {
    expect(alternarDiaDoVinculo(null, 0)).toEqual([0]);
  });

  it("desmarcar o último dia devolve lista vazia (o servidor grava NULL)", () => {
    expect(alternarDiaDoVinculo([3], 3)).toEqual([]);
  });

  it("não muta a lista de entrada", () => {
    const original = [3];
    alternarDiaDoVinculo(original, 6);
    expect(original).toEqual([3]);
  });
});

describe("payloadDeDias", () => {
  it("produz EXATAMENTE as três chaves da action", () => {
    const payload = payloadDeDias(CARDAPIO, PRODUTO, [6, 3]);
    expect(Object.keys(payload).sort()).toEqual([
      "cardapio_id",
      "dias_semana",
      "produto_id",
    ]);
    expect(payload).toEqual({
      cardapio_id: CARDAPIO,
      produto_id: PRODUTO,
      dias_semana: [3, 6],
    });
  });

  it("o payload passa no MESMO schema .strict() que a Server Action roda", () => {
    expect(schemaDiasDoVinculo.safeParse(payloadDeDias(CARDAPIO, PRODUTO, [])).success).toBe(
      true,
    );
    expect(
      schemaDiasDoVinculo.safeParse(payloadDeDias(CARDAPIO, PRODUTO, [0, 6])).success,
    ).toBe(true);
  });

  it("nenhum loja_id pendurado: o .strict() recusaria (RN-10)", () => {
    const comLoja = {
      ...payloadDeDias(CARDAPIO, PRODUTO, [3]),
      loja_id: "33333333-3333-4333-8333-333333333333",
    };
    expect(schemaDiasDoVinculo.safeParse(comLoja).success).toBe(false);
  });
});

describe("podeDefinirDias (277 / decisão B)", () => {
  const produtos = [
    { id: "a", noCardapio: true },
    { id: "b", noCardapio: true },
    { id: "c", noCardapio: false },
  ];

  it("seleção inteira vinculada ⇒ habilitado", () => {
    expect(podeDefinirDias(produtos, ["a", "b"])).toBe(true);
  });

  it("um produto fora do cardápio na seleção ⇒ desabilitado", () => {
    expect(podeDefinirDias(produtos, ["a", "c"])).toBe(false);
  });

  it("seleção vazia ⇒ desabilitado", () => {
    expect(podeDefinirDias(produtos, [])).toBe(false);
  });

  it("id que não existe na lista renderizada ⇒ desabilitado", () => {
    expect(podeDefinirDias(produtos, ["z"])).toBe(false);
  });
});

describe("payloadsDeDiasEmLote (277)", () => {
  it("N produtos ⇒ N payloads, cada um escopado pela tripla", () => {
    const payloads = payloadsDeDiasEmLote(CARDAPIO, ["p1", "p2", "p3"], [3, 6]);
    expect(payloads).toHaveLength(3);
    expect(payloads.map((x) => x.produto_id)).toEqual(["p1", "p2", "p3"]);
    for (const payload of payloads) {
      expect(payload.cardapio_id).toBe(CARDAPIO);
      expect(payload.dias_semana).toEqual([3, 6]);
      expect(Object.keys(payload)).toHaveLength(3);
    }
  });

  it("nenhuma pílula marcada ⇒ [] em cada payload (o servidor grava NULL)", () => {
    expect(payloadsDeDiasEmLote(CARDAPIO, ["p1"], [])).toEqual([
      { cardapio_id: CARDAPIO, produto_id: "p1", dias_semana: [] },
    ]);
  });

  it("seleção vazia ⇒ nenhuma escrita", () => {
    expect(payloadsDeDiasEmLote(CARDAPIO, [], [3])).toEqual([]);
  });
});
