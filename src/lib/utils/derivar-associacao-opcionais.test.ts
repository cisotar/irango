/**
 * Testes das 5 derivações puras que alimentam `CartaoAssociacaoOpcionais`
 * (issue 217). O caso que MERECE existir aqui é o do grupo associado com ZERO
 * itens: é ele que o mapa da vitrine (`agruparOpcionaisPorCategoria`) descarta e
 * que, aberto desmarcado, seria apagado em silêncio no primeiro toggle.
 */

import { describe, it, expect } from "vitest";

import {
  agruparOpcionaisPorGrupo,
  contarItensPorGrupo,
  selecionadosPorCategoria,
  ordemPorCategoria,
  alcancePorGrupo,
} from "./derivar-associacao-opcionais";
import type { Opcional } from "@/lib/supabase/queries/opcionais";
import type { Associacao } from "@/components/painel/contrato-opcionais";

function opcional(over: Partial<Opcional> = {}): Opcional {
  return {
    id: "o-1",
    loja_id: "loja-1",
    categoria_opcional_id: "co-1",
    nome: "Bacon",
    preco: 500,
    ativo: true,
    ordem: 0,
    criado_em: "2025-01-01T00:00:00Z",
    atualizado_em: "2025-01-01T00:00:00Z",
    ...over,
  };
}

function assoc(over: Partial<Associacao> = {}): Associacao {
  return {
    categoria_id: "cp-1",
    categoria_opcional_id: "co-1",
    ordem: 0,
    ...over,
  };
}

describe("agruparOpcionaisPorGrupo", () => {
  it("agrupa por `categoria_opcional_id` e ordena por `ordem`", () => {
    const mapa = agruparOpcionaisPorGrupo([
      opcional({ id: "b", ordem: 2 }),
      opcional({ id: "a", ordem: 1 }),
      opcional({ id: "z", categoria_opcional_id: "co-2", ordem: 0 }),
    ]);
    expect([...mapa.keys()].sort()).toEqual(["co-1", "co-2"]);
    expect(mapa.get("co-1")?.map((o) => o.id)).toEqual(["a", "b"]);
    expect(mapa.get("co-2")?.map((o) => o.id)).toEqual(["z"]);
  });

  it("desempata por `id` quando a `ordem` empata — sem isso a lista dança entre requisições", () => {
    const mapa = agruparOpcionaisPorGrupo([
      opcional({ id: "c", ordem: 0 }),
      opcional({ id: "a", ordem: 0 }),
      opcional({ id: "b", ordem: 0 }),
    ]);
    expect(mapa.get("co-1")?.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("mantém o item INATIVO na lista — a RPC da 215 exige a permutação completa", () => {
    const mapa = agruparOpcionaisPorGrupo([
      opcional({ id: "a", ordem: 0 }),
      opcional({ id: "b", ordem: 1, ativo: false }),
    ]);
    expect(mapa.get("co-1")?.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("lista vazia devolve mapa vazio", () => {
    expect(agruparOpcionaisPorGrupo([]).size).toBe(0);
  });
});

describe("contarItensPorGrupo", () => {
  it("conta os itens da BIBLIOTECA de cada grupo", () => {
    const porGrupo = agruparOpcionaisPorGrupo([
      opcional({ id: "a" }),
      opcional({ id: "b" }),
      opcional({ id: "c", categoria_opcional_id: "co-2" }),
    ]);
    const total = contarItensPorGrupo(porGrupo);
    expect(total.get("co-1")).toBe(2);
    expect(total.get("co-2")).toBe(1);
  });

  it("grupo sem nenhum item não tem chave — o consumidor cai no default dele", () => {
    expect(contarItensPorGrupo(new Map()).get("co-vazio")).toBeUndefined();
  });
});

describe("selecionadosPorCategoria", () => {
  it("agrupa os ids persistidos por categoria de produto", () => {
    const mapa = selecionadosPorCategoria([
      assoc({ categoria_opcional_id: "co-1" }),
      assoc({ categoria_opcional_id: "co-2" }),
      assoc({ categoria_id: "cp-2", categoria_opcional_id: "co-1" }),
    ]);
    expect([...(mapa.get("cp-1") ?? [])].sort()).toEqual(["co-1", "co-2"]);
    expect([...(mapa.get("cp-2") ?? [])]).toEqual(["co-1"]);
  });

  it("[217] grupo associado com ZERO itens continua MARCADO — o bug silencioso da vitrine", () => {
    // Nenhum `Opcional` referencia `co-vazio`: o mapa da vitrine o descartaria.
    // A verdade é `categoria_produto_opcionais`, e é dela que isto deriva.
    const opcionaisDaLoja = agruparOpcionaisPorGrupo([
      opcional({ id: "a", categoria_opcional_id: "co-1" }),
    ]);
    expect(opcionaisDaLoja.has("co-vazio")).toBe(false);

    const mapa = selecionadosPorCategoria([
      assoc({ categoria_opcional_id: "co-1" }),
      assoc({ categoria_opcional_id: "co-vazio", ordem: 1 }),
    ]);
    expect(mapa.get("cp-1")?.has("co-vazio")).toBe(true);
  });

  it("sem associação nenhuma devolve mapa vazio", () => {
    expect(selecionadosPorCategoria([]).size).toBe(0);
  });
});

describe("ordemPorCategoria", () => {
  it("mapeia `categoria_id → (grupo → ordem)` gravada", () => {
    const mapa = ordemPorCategoria([
      assoc({ categoria_opcional_id: "co-1", ordem: 1 }),
      assoc({ categoria_opcional_id: "co-2", ordem: 0 }),
      assoc({ categoria_id: "cp-2", categoria_opcional_id: "co-1", ordem: 7 }),
    ]);
    expect(mapa.get("cp-1")?.get("co-1")).toBe(1);
    expect(mapa.get("cp-1")?.get("co-2")).toBe(0);
    expect(mapa.get("cp-2")?.get("co-1")).toBe(7);
  });

  it("grupo sem ordem gravada não tem entrada — ausente ≠ ordem 0", () => {
    const mapa = ordemPorCategoria([assoc({ categoria_opcional_id: "co-1" })]);
    expect(mapa.get("cp-1")?.get("co-2")).toBeUndefined();
  });
});

describe("alcancePorGrupo", () => {
  it("lista os NOMES das categorias de produto que usam cada grupo", () => {
    const mapa = alcancePorGrupo(
      [
        assoc({ categoria_id: "cp-1", categoria_opcional_id: "co-1" }),
        assoc({ categoria_id: "cp-2", categoria_opcional_id: "co-1" }),
        assoc({ categoria_id: "cp-2", categoria_opcional_id: "co-2" }),
      ],
      [
        { id: "cp-1", nome: "Pizzas" },
        { id: "cp-2", nome: "Lanches" },
      ],
    );
    expect(mapa.get("co-1")).toEqual(["Pizzas", "Lanches"]);
    expect(mapa.get("co-2")).toEqual(["Lanches"]);
  });

  it("ignora associação cuja categoria de produto não está na lista — alcance com buraco mentiria", () => {
    const mapa = alcancePorGrupo(
      [
        assoc({ categoria_id: "cp-1", categoria_opcional_id: "co-1" }),
        assoc({ categoria_id: "cp-fantasma", categoria_opcional_id: "co-1" }),
      ],
      [{ id: "cp-1", nome: "Pizzas" }],
    );
    expect(mapa.get("co-1")).toEqual(["Pizzas"]);
  });

  it("grupo sem nenhuma associação não aparece", () => {
    const mapa = alcancePorGrupo([], [{ id: "cp-1", nome: "Pizzas" }]);
    expect(mapa.size).toBe(0);
  });
});
