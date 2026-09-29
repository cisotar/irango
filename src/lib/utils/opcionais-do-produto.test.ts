/**
 * Fase RED (TDD) da issue 331 — a REGRA PURA da exceção produto×grupo
 * (plan/loop-ocultar-opcionais-por-produto.md, "Desenho", camada 1; fatia F4).
 *
 *   visiveis(produto) = grupos(categoria do produto, na ordem da categoria)
 *                       − ocultos(produto)
 *
 * É a ÚNICA cópia da regra. Quem a consome:
 *  - `criarPedido` e `revisarCarrinhoAction` → `idsPermitidosDoProduto`
 *    (autoridade de valor, §10);
 *  - vitrine (card e modal) e painel → `gruposVisiveisDoProduto` (preview);
 *  - hook do painel → `estaOculto` / `agruparOcultosPorProduto`.
 *
 * Semântica SUBTRATIVA: uma linha só consegue esconder, nunca libera nada. Uma
 * linha órfã (grupo que não está mais na categoria, D3) é inerte.
 *
 * O último bloco é o CASO-ESPELHO preview ↔ servidor: para a mesma entrada, o
 * conjunto que a vitrine mostra é exatamente o que o pedido aceita.
 *
 * Nenhum código de produção aqui: o módulo é um STUB (`throw "TODO: GREEN"`).
 */

import { describe, it, expect } from "vitest";

import {
  agruparOcultosPorProduto,
  estaOculto,
  gruposVisiveisDoProduto,
  idsPermitidosDoProduto,
  type OcultoOpcional,
} from "./opcionais-do-produto";

const P = "prod-p";
const Q = "prod-q"; // outro produto da MESMA categoria
const A = "grupo-a";
const B = "grupo-b";
const C = "grupo-c";
const X = "grupo-x"; // grupo que NÃO está na categoria atual (D3)

type Grupo = { categoriaOpcionalId: string; categoriaOpcionalNome: string; ordem: number };
const grupo = (id: string, ordem: number): Grupo => ({
  categoriaOpcionalId: id,
  categoriaOpcionalNome: id.toUpperCase(),
  ordem,
});
const GRUPOS_ABC: readonly Grupo[] = [grupo(A, 0), grupo(B, 1), grupo(C, 2)];

const LINHAS: OcultoOpcional[] = [
  { produto_id: P, categoria_opcional_id: B },
  { produto_id: P, categoria_opcional_id: X },
];

describe("agruparOcultosPorProduto — linhas do banco → produto → grupos", () => {
  it("agrupa por produto; produto sem linha não ganha chave", () => {
    const mapa = agruparOcultosPorProduto(LINHAS);
    expect(Object.keys(mapa)).toEqual([P]);
    expect([...mapa[P]].sort()).toEqual([B, X].sort());
    expect(mapa[Q]).toBeUndefined();
  });

  it("lista vazia → mapa vazio", () => {
    expect(agruparOcultosPorProduto([])).toEqual({});
  });
});

describe("estaOculto — a pergunta de uma pílula", () => {
  const ocultos = { [P]: [B] };

  it("par presente → true", () => {
    expect(estaOculto(ocultos, P, B)).toBe(true);
  });

  it("mesmo grupo em OUTRO produto → false (a exceção é por produto)", () => {
    expect(estaOculto(ocultos, Q, B)).toBe(false);
  });

  it("outro grupo no mesmo produto → false", () => {
    expect(estaOculto(ocultos, P, A)).toBe(false);
  });

  it("mapa vazio → false (default é exibir)", () => {
    expect(estaOculto({}, P, B)).toBe(false);
  });
});

describe("idsPermitidosDoProduto — a allowlist do pedido (autoridade, §10)", () => {
  it("categoria A,B,C com B oculto no produto → {A, C}", () => {
    expect(idsPermitidosDoProduto([A, B, C], [B])).toEqual(new Set([A, C]));
  });

  it("produto sem ocultação (undefined) → todos os grupos da categoria", () => {
    expect(idsPermitidosDoProduto([A, B, C], undefined)).toEqual(new Set([A, B, C]));
  });

  it("(D3) oculto de grupo que NÃO está na categoria atual é inerte — nunca libera nem remove nada", () => {
    expect(idsPermitidosDoProduto([A, B, C], [X])).toEqual(new Set([A, B, C]));
  });

  it("subtrativa: produto sem categoria (lista vazia) continua sem nenhum grupo, com ou sem ocultos", () => {
    expect(idsPermitidosDoProduto([], [A, X])).toEqual(new Set());
  });

  it("todos ocultos → conjunto vazio", () => {
    expect(idsPermitidosDoProduto([A, B, C], [A, B, C])).toEqual(new Set());
  });

  it("não muta a entrada", () => {
    const daCategoria = new Set([A, B, C]);
    const ocultos = new Set([B]);
    idsPermitidosDoProduto(daCategoria, ocultos);
    expect(daCategoria).toEqual(new Set([A, B, C]));
    expect(ocultos).toEqual(new Set([B]));
  });
});

describe("gruposVisiveisDoProduto — vitrine e painel (preview)", () => {
  it("categoria A,B,C com B oculto no produto P → P recebe A,C, na ordem", () => {
    const r = gruposVisiveisDoProduto(GRUPOS_ABC, [B]);
    expect(r.map((g) => g.categoriaOpcionalId)).toEqual([A, C]);
  });

  it("outro produto da categoria (sem ocultos) recebe A,B,C", () => {
    const r = gruposVisiveisDoProduto(GRUPOS_ABC, undefined);
    expect(r.map((g) => g.categoriaOpcionalId)).toEqual([A, B, C]);
  });

  it("é um FILTRO: preserva a ordem de entrada (a ordem da categoria), nunca reordena", () => {
    // Entrada propositalmente fora de `ordem`: quem ordena é a query
    // (`categoria_produto_opcionais.ordem`, 208). A util não re-sorteia.
    const embaralhado = [grupo(C, 2), grupo(A, 0), grupo(B, 1)];
    const r = gruposVisiveisDoProduto(embaralhado, [B]);
    expect(r.map((g) => g.categoriaOpcionalId)).toEqual([C, A]);
  });

  it("devolve os MESMOS objetos de grupo (sem clonar os itens/preços)", () => {
    const r = gruposVisiveisDoProduto(GRUPOS_ABC, [B]);
    expect(r[0]).toBe(GRUPOS_ABC[0]);
    expect(r[1]).toBe(GRUPOS_ABC[2]);
  });

  it("não muta a lista da categoria (ela é compartilhada por todos os produtos)", () => {
    const copia = [...GRUPOS_ABC];
    gruposVisiveisDoProduto(GRUPOS_ABC, [A, B]);
    expect(GRUPOS_ABC).toEqual(copia);
    expect(GRUPOS_ABC).toHaveLength(3);
  });

  it("(D3) oculto de grupo fora da categoria não tira nada", () => {
    const r = gruposVisiveisDoProduto(GRUPOS_ABC, [X]);
    expect(r.map((g) => g.categoriaOpcionalId)).toEqual([A, B, C]);
  });

  it("todos ocultos → lista vazia", () => {
    expect(gruposVisiveisDoProduto(GRUPOS_ABC, [A, B, C])).toEqual([]);
  });
});

describe("caso-espelho preview ↔ servidor (anti-drift)", () => {
  // Mesma entrada nas duas pontas: o que a vitrine MOSTRA é exatamente o que o
  // pedido ACEITA. Divergência aqui = cliente vê um adicional que o servidor
  // recusa (ou o contrário).
  const cenarios: Array<[string, readonly string[] | undefined]> = [
    ["sem ocultos", undefined],
    ["B oculto", [B]],
    ["órfão X (D3)", [X]],
    ["A e C ocultos + órfão", [A, C, X]],
    ["todos", [A, B, C]],
  ];
  for (const [rotulo, ocultos] of cenarios) {
    it(`${rotulo}: ids de gruposVisiveisDoProduto === idsPermitidosDoProduto`, () => {
      const vitrine = new Set(
        gruposVisiveisDoProduto(GRUPOS_ABC, ocultos).map((g) => g.categoriaOpcionalId),
      );
      const servidor = idsPermitidosDoProduto(
        GRUPOS_ABC.map((g) => g.categoriaOpcionalId),
        ocultos,
      );
      expect(vitrine).toEqual(servidor);
    });
  }

  it("a partir das LINHAS do banco: agrupar → estaOculto concorda com a allowlist", () => {
    const mapa = agruparOcultosPorProduto(LINHAS);
    const permitidos = idsPermitidosDoProduto([A, B, C], mapa[P]);
    for (const g of [A, B, C]) {
      expect(permitidos.has(g)).toBe(!estaOculto(mapa, P, g));
    }
  });
});
