/**
 * Testes unitários das funções puras de `escolhasOpcionais.ts` (issue 210).
 *
 * A regressão de valor mais importante (opcional de grupo FECHADO com qtd > 0
 * continuar no achatamento) já está coberta em `SecaoOpcionais.test.tsx`, ao
 * lado dos testes de markup da sanfona — não repetida aqui. Este arquivo cobre
 * o que falta nas três funções isoladamente: independência entre grupos e
 * bordas de lista vazia, que nenhum teste de render exercitava.
 *
 * Ambiente: vitest `environment: node`, sem jsdom — funções puras, sem React.
 */

import { describe, it, expect } from "vitest";

import {
  achatarOpcionaisEscolhidos,
  contarEscolhidosDoGrupo,
  rotuloGrupoOpcional,
} from "./escolhasOpcionais";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";

const MOLHOS: GrupoOpcional = {
  categoriaOpcionalId: "g-molhos",
  categoriaOpcionalNome: "Molhos",
  ordem: 0,
  opcionais: [
    { id: "o-maionese", nome: "Maionese", preco: 1, ordem: 0 },
    { id: "o-barbecue", nome: "Barbecue", preco: 2, ordem: 1 },
  ],
};

const QUEIJOS: GrupoOpcional = {
  categoriaOpcionalId: "g-queijos",
  categoriaOpcionalNome: "Queijos",
  ordem: 1,
  opcionais: [{ id: "o-cheddar", nome: "Cheddar", preco: 3, ordem: 0 }],
};

const VAZIO: GrupoOpcional = {
  categoriaOpcionalId: "g-vazio",
  categoriaOpcionalNome: "Vazio",
  ordem: 2,
  opcionais: [],
};

describe("achatarOpcionaisEscolhidos", () => {
  it("grupos=[] não quebra e devolve lista vazia", () => {
    expect(achatarOpcionaisEscolhidos([], {})).toEqual([]);
  });

  it("grupo sem opcionais não contribui nada ao achatamento", () => {
    expect(achatarOpcionaisEscolhidos([VAZIO], { "o-maionese": 2 })).toEqual([]);
  });

  it("carrega nome e preço do opcional junto da quantidade (preview de exibição)", () => {
    const escolhidos = achatarOpcionaisEscolhidos([MOLHOS], { "o-barbecue": 3 });
    expect(escolhidos).toEqual([
      { opcionalId: "o-barbecue", nome: "Barbecue", preco: 2, quantidade: 3 },
    ]);
  });

  it("ids de qtdOpcionais que não pertencem a NENHUM grupo são ignorados", () => {
    // Um id órfão no dicionário (ex.: opcional removido do produto) não pode
    // vazar para o carrinho como se fosse um item válido do produto atual.
    const escolhidos = achatarOpcionaisEscolhidos([MOLHOS], {
      "o-maionese": 1,
      "id-fantasma-de-outro-produto": 5,
    });
    expect(escolhidos.map((o) => o.opcionalId)).toEqual(["o-maionese"]);
  });
});

describe("contarEscolhidosDoGrupo", () => {
  it("soma só os opcionais QUE PERTENCEM ao grupo, ignorando ids de outros grupos", () => {
    // Cheddar é de QUEIJOS: contar MOLHOS não pode incluí-lo mesmo estando no
    // mesmo dicionário de quantidades (o Badge de um grupo vazaria a contagem
    // de outro).
    const qtds = { "o-maionese": 2, "o-cheddar": 5 };
    expect(contarEscolhidosDoGrupo(MOLHOS, qtds)).toBe(2);
    expect(contarEscolhidosDoGrupo(QUEIJOS, qtds)).toBe(5);
  });

  it("grupo sem opcionais soma 0", () => {
    expect(contarEscolhidosDoGrupo(VAZIO, { "o-maionese": 2 })).toBe(0);
  });
});

describe("rotuloGrupoOpcional", () => {
  it("negativo (não deveria ocorrer, mas não pode virar plural incorreto) cai no ramo sem sufixo", () => {
    expect(rotuloGrupoOpcional("Molhos", -1)).toBe("Molhos");
  });
});
