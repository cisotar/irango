import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) da issue 357 — `src/lib/utils/agregarVendas.ts` (puro).
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.4 e §8.6; RN-V11, V12, V13.
 *
 * Contrato:
 *   preencherDias(linhas, {deDia, ateDia}) → um registro por dia, ausentes zerados; lança se
 *     alguma linha está fora do intervalo.
 *   somarLinhas(linhas) → TotaisVendas, arredondando a cada soma.
 *   barrasDiarias(linhas) → rotulo "05/out"; agruparPorSemana → chave = segunda ISO,
 *     rotulo "28/set a 04/out"; agruparPorCiclo(linhas, dia) → rotulo do ciclo inteiro.
 *   agruparItensPorCategoria(linhasSQL) → categoria NULL vira "Sem categoria", por último;
 *     ordem do SQL preservada; totais da categoria = colunas de janela do SQL.
 *
 * RED: o módulo ainda não existe; import dinâmico por caso. Dados fictícios.
 */

type Totais = {
  pedidos: number;
  bruto: number;
  descontos: number;
  liquido: number;
  frete: number;
  freteACombinar: number;
};
type LinhaDiaria = Totais & { dia: string };
type Barra = Totais & { chave: string; rotulo: string };
type LinhaItemCategoria = {
  categoria_id: string | null;
  categoria_nome: string | null;
  item_nome: string;
  quantidade: number;
  valor_bruto: number;
  categoria_quantidade: number;
  categoria_valor_bruto: number;
};
type Categoria = {
  categoriaId: string | null;
  nome: string;
  quantidade: number;
  valorBruto: number;
  itens: { nome: string; quantidade: number; valorBruto: number }[];
};
type Mod = {
  ROTULO_SEM_CATEGORIA: string;
  preencherDias: (l: LinhaDiaria[], i: { deDia: string; ateDia: string }) => LinhaDiaria[];
  somarLinhas: (l: readonly Totais[]) => Totais;
  barrasDiarias: (l: LinhaDiaria[]) => Barra[];
  agruparPorSemana: (l: LinhaDiaria[]) => Barra[];
  agruparPorCiclo: (l: LinhaDiaria[], diaInicioCiclo: number) => Barra[];
  agruparItensPorCategoria: (l: LinhaItemCategoria[]) => Categoria[];
};

async function carregar(): Promise<Mod> {
  return (await import("./agregarVendas")) as unknown as Mod;
}

const ZERO: Totais = { pedidos: 0, bruto: 0, descontos: 0, liquido: 0, frete: 0, freteACombinar: 0 };
const METRICAS = ["pedidos", "bruto", "descontos", "liquido", "frete", "freteACombinar"] as const;

const linha = (dia: string, over: Partial<Totais> = {}): LinhaDiaria => ({ dia, ...ZERO, ...over });

/** 14 dias (2026-09-28..2026-10-11) com centavos que a soma ingênua em float erra. */
function fixture14Dias(): LinhaDiaria[] {
  const brutos = [10.1, 0.2, 33.33, 0.07];
  const descontos = [0.1, 0, 1.11, 0.03];
  const fretes = [0.3, 0.07, 5.55, 0];
  const out: LinhaDiaria[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10);
    const bruto = brutos[i % 4];
    const desconto = descontos[i % 4];
    out.push(
      linha(d, {
        pedidos: (i % 3) + 1,
        bruto,
        descontos: desconto,
        liquido: Math.round((bruto - desconto) * 100) / 100,
        frete: fretes[i % 4],
        freteACombinar: i % 2,
      }),
    );
  }
  return out;
}

describe("preencherDias", () => {
  it("2026-09-28..2026-10-11 com 3 linhas → 14 linhas em ordem, ausentes zeradas", async () => {
    const { preencherDias } = await carregar();
    const tres = [
      linha("2026-09-30", { pedidos: 1, bruto: 10, liquido: 10 }),
      linha("2026-10-04", { pedidos: 2, bruto: 20.5, liquido: 20.5 }),
      linha("2026-10-11", { pedidos: 1, bruto: 7, liquido: 7, frete: 3 }),
    ];
    const r = preencherDias(tres, { deDia: "2026-09-28", ateDia: "2026-10-11" });
    expect(r).toHaveLength(14);
    expect(r[0]).toEqual(linha("2026-09-28"));
    expect(r[2]).toEqual(tres[0]);
    expect(r[6]).toEqual(tres[1]);
    expect(r[13]).toEqual(tres[2]);
    expect(r[7]).toEqual(linha("2026-10-05"));
    expect(r.map((x) => x.dia)).toEqual([...r.map((x) => x.dia)].sort());
  });

  it("linha fora do intervalo → lança", async () => {
    const { preencherDias } = await carregar();
    expect(() =>
      preencherDias([linha("2026-10-12", { bruto: 1 })], { deDia: "2026-09-28", ateDia: "2026-10-11" }),
    ).toThrow();
  });
});

describe("rollups", () => {
  it("barrasDiarias: chave = dia, rótulo '05/out'", async () => {
    const { barrasDiarias } = await carregar();
    const [b] = barrasDiarias([linha("2026-10-05", { bruto: 12, liquido: 12, pedidos: 1 })]);
    expect(b).toMatchObject({ chave: "2026-10-05", rotulo: "05/out", bruto: 12, pedidos: 1 });
  });

  it("RN-V11 semana ISO: 2026-10-04 → balde 2026-09-28 ('28/set a 04/out'); 2026-10-05 → 2026-10-05", async () => {
    const { agruparPorSemana } = await carregar();
    const barras = agruparPorSemana([
      linha("2026-10-04", { pedidos: 1, bruto: 10, liquido: 10 }),
      linha("2026-10-05", { pedidos: 2, bruto: 30, liquido: 30 }),
    ]);
    expect(barras.map((b) => [b.chave, b.rotulo, b.bruto])).toEqual([
      ["2026-09-28", "28/set a 04/out", 10],
      ["2026-10-05", "05/out a 11/out", 30],
    ]);
  });

  it("ciclo dia 5: 2026-10-04 → balde 2026-09-05 ('05/set a 04/out'); 2026-10-05 → 2026-10-05 ('05/out a 04/nov')", async () => {
    const { agruparPorCiclo } = await carregar();
    const barras = agruparPorCiclo(
      [linha("2026-10-04", { pedidos: 1, bruto: 10, liquido: 10 }), linha("2026-10-05", { pedidos: 1, bruto: 5, liquido: 5 })],
      5,
    );
    expect(barras.map((b) => [b.chave, b.rotulo, b.bruto])).toEqual([
      ["2026-09-05", "05/set a 04/out", 10],
      ["2026-10-05", "05/out a 04/nov", 5],
    ]);
  });

  it("RN-V12: Σ diário = Σ semanal = Σ ciclo = somarLinhas(diárias), exato, em todas as métricas", async () => {
    const { somarLinhas, barrasDiarias, agruparPorSemana, agruparPorCiclo } = await carregar();
    const dias = fixture14Dias();
    const total = somarLinhas(dias);
    // Âncora concreta: 3 × (10.1 + 0.2 + 33.33 + 0.07) + 10.1 + 0.2 = 141.4 (a soma ingênua em float não dá isso).
    expect(total.bruto).toBe(141.4);
    const diario = somarLinhas(barrasDiarias(dias));
    const semanal = somarLinhas(agruparPorSemana(dias));
    const ciclo = somarLinhas(agruparPorCiclo(dias, 5));
    for (const m of METRICAS) {
      expect(diario[m], `diário ${m}`).toBe(total[m]);
      expect(semanal[m], `semanal ${m}`).toBe(total[m]);
      expect(ciclo[m], `ciclo ${m}`).toBe(total[m]);
    }
  });
});

describe("agruparItensPorCategoria", () => {
  const CAT_B = "cccccccc-0000-4000-8000-000000000001";
  const CAT_L = "cccccccc-0000-4000-8000-000000000002";
  const sql: LinhaItemCategoria[] = [
    // Ordem do SQL (não é ordem alfabética nem por quantidade): preservar.
    { categoria_id: CAT_L, categoria_nome: "Lanches", item_nome: "X-Burger", quantidade: 2, valor_bruto: 43, categoria_quantidade: 3, categoria_valor_bruto: 55 },
    { categoria_id: CAT_L, categoria_nome: "Lanches", item_nome: "X-Salada", quantidade: 1, valor_bruto: 12, categoria_quantidade: 3, categoria_valor_bruto: 55 },
    { categoria_id: CAT_B, categoria_nome: "Bebidas", item_nome: "Coca", quantidade: 4, valor_bruto: 24, categoria_quantidade: 4, categoria_valor_bruto: 24 },
    { categoria_id: null, categoria_nome: null, item_nome: "Avulso", quantidade: 1, valor_bruto: 90, categoria_quantidade: 1, categoria_valor_bruto: 90 },
  ];

  it("ROTULO_SEM_CATEGORIA = 'Sem categoria'", async () => {
    const { ROTULO_SEM_CATEGORIA } = await carregar();
    expect(ROTULO_SEM_CATEGORIA).toBe("Sem categoria");
  });

  it("agrupa preservando a ordem do SQL; NULL vira 'Sem categoria' por último; totais = colunas de janela", async () => {
    const { agruparItensPorCategoria } = await carregar();
    expect(agruparItensPorCategoria(sql)).toEqual([
      {
        categoriaId: CAT_L,
        nome: "Lanches",
        quantidade: 3,
        valorBruto: 55,
        itens: [
          { nome: "X-Burger", quantidade: 2, valorBruto: 43 },
          { nome: "X-Salada", quantidade: 1, valorBruto: 12 },
        ],
      },
      { categoriaId: CAT_B, nome: "Bebidas", quantidade: 4, valorBruto: 24, itens: [{ nome: "Coca", quantidade: 4, valorBruto: 24 }] },
      { categoriaId: null, nome: "Sem categoria", quantidade: 1, valorBruto: 90, itens: [{ nome: "Avulso", quantidade: 1, valorBruto: 90 }] },
    ]);
  });

  it("vazio → []", async () => {
    const { agruparItensPorCategoria } = await carregar();
    expect(agruparItensPorCategoria([])).toEqual([]);
  });
});
