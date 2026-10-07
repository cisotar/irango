import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) das issues 354 + 357 — `src/lib/validacoes/vendas.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.5 e §8.6; RN-V08, V18.
 *
 * Contrato:
 *   schemaCicloVendas = z.object({ dia_inicio_ciclo: z.int().min(1).max(28) }).strict()
 *   MSG_CICLO_INVALIDO = "Escolha um dia entre 1 e 28."
 *   FILTROS_PADRAO / RANKING_PADRAO
 *   lerParamsVendas(searchParams) → { filtros, ranking, avisoFiltros, avisoRanking } (nunca lança;
 *     cada grupo cai no padrão independente; valor array é inválido; personalizado exige dias
 *     válidos, de <= ate e até 366 dias; de/ate com outro preset são ignorados sem aviso)
 *   hrefVendas(base, filtros, ranking | null) → omite padrões, ordem
 *     periodo, de, ate, entrega, concluidos, ranking, ordem; sem parâmetro → base.
 *
 * RED: o módulo ainda não existe; import dinâmico por caso.
 */

type Filtros = {
  periodo: "hoje" | "semana" | "mes" | "mes_anterior" | "ano" | "personalizado";
  de: string | null;
  ate: string | null;
  entrega: "entrega" | "retirada" | "ambos";
  concluidos: boolean;
};
type Ranking = { periodo: "semana" | "mes" | "ano" | "tudo"; ordem: "pedidos" | "total" | "ultimo" };
type Lido = { filtros: Filtros; ranking: Ranking; avisoFiltros: boolean; avisoRanking: boolean };
type SafeParse = { success: boolean };
type Mod = {
  schemaCicloVendas: { safeParse: (v: unknown) => SafeParse };
  MSG_CICLO_INVALIDO: string;
  FILTROS_PADRAO: Filtros;
  RANKING_PADRAO: Ranking;
  lerParamsVendas: (sp: Record<string, string | string[] | undefined>) => Lido;
  hrefVendas: (base: string, filtros: Filtros, ranking: Ranking | null) => string;
};

async function carregar(): Promise<Mod> {
  return (await import("./vendas")) as unknown as Mod;
}

const BASE = "/painel/vendas";
const PADRAO_F: Filtros = { periodo: "mes", de: null, ate: null, entrega: "ambos", concluidos: false };
const PADRAO_R: Ranking = { periodo: "mes", ordem: "pedidos" };

/** Converte o href em Record de searchParams (como o Next entrega à page). */
function parse(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://teste.local").searchParams.entries());
}

describe("schemaCicloVendas (354)", () => {
  it("{ dia_inicio_ciclo: 5 } é aceito; mensagem padrão do ciclo", async () => {
    const { schemaCicloVendas, MSG_CICLO_INVALIDO } = await carregar();
    expect(schemaCicloVendas.safeParse({ dia_inicio_ciclo: 5 }).success).toBe(true);
    expect(MSG_CICLO_INVALIDO).toBe("Escolha um dia entre 1 e 28.");
  });

  it.each([
    ["0", { dia_inicio_ciclo: 0 }],
    ["29", { dia_inicio_ciclo: 29 }],
    ["5.5", { dia_inicio_ciclo: 5.5 }],
    ['"5"', { dia_inicio_ciclo: "5" }],
    ["null", { dia_inicio_ciclo: null }],
    ["{}", {}],
    ["chave extra loja_id", { dia_inicio_ciclo: 5, loja_id: "x" }],
  ])("recusa %s", async (_rotulo, payload) => {
    const { schemaCicloVendas } = await carregar();
    expect(schemaCicloVendas.safeParse(payload).success).toBe(false);
  });
});

describe("lerParamsVendas (357)", () => {
  it("{} → padrões, sem avisos", async () => {
    const { lerParamsVendas, FILTROS_PADRAO, RANKING_PADRAO } = await carregar();
    expect(FILTROS_PADRAO).toEqual(PADRAO_F);
    expect(RANKING_PADRAO).toEqual(PADRAO_R);
    expect(lerParamsVendas({})).toEqual({
      filtros: PADRAO_F,
      ranking: PADRAO_R,
      avisoFiltros: false,
      avisoRanking: false,
    });
  });

  it("periodo=semana → semana; periodo=xyz → mes + avisoFiltros", async () => {
    const { lerParamsVendas } = await carregar();
    const ok = lerParamsVendas({ periodo: "semana" });
    expect(ok.filtros.periodo).toBe("semana");
    expect(ok.avisoFiltros).toBe(false);
    const ruim = lerParamsVendas({ periodo: "xyz" });
    expect(ruim.filtros.periodo).toBe("mes");
    expect(ruim.avisoFiltros).toBe(true);
  });

  it("personalizado de 2026-01-01 a 2027-01-01 (366 dias) é aceito", async () => {
    const { lerParamsVendas } = await carregar();
    const r = lerParamsVendas({ periodo: "personalizado", de: "2026-01-01", ate: "2027-01-01" });
    expect(r.filtros).toMatchObject({ periodo: "personalizado", de: "2026-01-01", ate: "2027-01-01" });
    expect(r.avisoFiltros).toBe(false);
  });

  it.each([
    ["367 dias", { de: "2026-01-01", ate: "2027-01-02" }],
    ["de > ate", { de: "2026-02-10", ate: "2026-02-01" }],
    ["dia inexistente", { de: "2026-02-30", ate: "2026-03-10" }],
    ["sem ate", { de: "2026-01-01" }],
  ])("personalizado inválido (%s) → mes + avisoFiltros", async (_r, datas) => {
    const { lerParamsVendas } = await carregar();
    const r = lerParamsVendas({ periodo: "personalizado", ...datas });
    expect(r.filtros).toMatchObject({ periodo: "mes", de: null, ate: null });
    expect(r.avisoFiltros).toBe(true);
  });

  it("de/ate com outro preset são ignorados sem aviso", async () => {
    const { lerParamsVendas } = await carregar();
    const r = lerParamsVendas({ periodo: "semana", de: "2026-01-01", ate: "2026-01-31" });
    expect(r.filtros).toMatchObject({ periodo: "semana", de: null, ate: null });
    expect(r.avisoFiltros).toBe(false);
  });

  it("entrega=retirada ok; entrega=x → ambos + aviso; entrega como array → aviso", async () => {
    const { lerParamsVendas } = await carregar();
    const ok = lerParamsVendas({ entrega: "retirada" });
    expect([ok.filtros.entrega, ok.avisoFiltros]).toEqual(["retirada", false]);
    const x = lerParamsVendas({ entrega: "x" });
    expect([x.filtros.entrega, x.avisoFiltros]).toEqual(["ambos", true]);
    const arr = lerParamsVendas({ entrega: ["a", "b"] });
    expect([arr.filtros.entrega, arr.avisoFiltros]).toEqual(["ambos", true]);
  });

  it("concluidos=1 → true; ausente → false sem aviso; concluidos=true → false + aviso", async () => {
    const { lerParamsVendas } = await carregar();
    expect(lerParamsVendas({ concluidos: "1" }).filtros.concluidos).toBe(true);
    const ausente = lerParamsVendas({});
    expect([ausente.filtros.concluidos, ausente.avisoFiltros]).toEqual([false, false]);
    const t = lerParamsVendas({ concluidos: "true" });
    expect([t.filtros.concluidos, t.avisoFiltros]).toEqual([false, true]);
  });

  it("ranking=tudo&ordem=ultimo ok; ranking=dia → ranking padrão + avisoRanking, sem avisoFiltros", async () => {
    const { lerParamsVendas } = await carregar();
    const ok = lerParamsVendas({ ranking: "tudo", ordem: "ultimo" });
    expect(ok.ranking).toEqual({ periodo: "tudo", ordem: "ultimo" });
    expect(ok.avisoRanking).toBe(false);
    const ruim = lerParamsVendas({ ranking: "dia" });
    expect(ruim.ranking.periodo).toBe("mes");
    expect(ruim.avisoRanking).toBe(true);
    expect(ruim.avisoFiltros).toBe(false);
  });

  it("nunca lança, mesmo com lixo em todos os parâmetros", async () => {
    const { lerParamsVendas } = await carregar();
    expect(() =>
      lerParamsVendas({ periodo: ["x"], de: "x", ate: undefined, entrega: "", concluidos: ["1"], ranking: "", ordem: "z" }),
    ).not.toThrow();
  });
});

describe("hrefVendas (357, RN-V18)", () => {
  it("só padrões → base sem query", async () => {
    const { hrefVendas } = await carregar();
    expect(hrefVendas(BASE, PADRAO_F, PADRAO_R)).toBe("/painel/vendas");
  });

  it("ordem dos parâmetros: periodo, de, ate, entrega, concluidos, ranking, ordem", async () => {
    const { hrefVendas } = await carregar();
    expect(
      hrefVendas(
        BASE,
        { periodo: "personalizado", de: "2026-01-01", ate: "2026-01-31", entrega: "entrega", concluidos: true },
        { periodo: "tudo", ordem: "total" },
      ),
    ).toBe(
      "/painel/vendas?periodo=personalizado&de=2026-01-01&ate=2026-01-31&entrega=entrega&concluidos=1&ranking=tudo&ordem=total",
    );
  });

  it("ranking null (admin) → nenhum parâmetro de ranking", async () => {
    const { hrefVendas } = await carregar();
    expect(hrefVendas("/admin/assinantes/x/vendas", { ...PADRAO_F, periodo: "semana" }, null)).toBe(
      "/admin/assinantes/x/vendas?periodo=semana",
    );
  });

  const COMBINACOES: [Filtros, Ranking][] = [
    [{ ...PADRAO_F, periodo: "semana" }, PADRAO_R],
    [
      { periodo: "personalizado", de: "2026-01-01", ate: "2026-01-31", entrega: "entrega", concluidos: true },
      { periodo: "tudo", ordem: "total" },
    ],
    [{ ...PADRAO_F, periodo: "hoje", entrega: "retirada" }, { periodo: "ano", ordem: "ultimo" }],
    [{ ...PADRAO_F, periodo: "mes_anterior" }, { periodo: "semana", ordem: "pedidos" }],
    [{ ...PADRAO_F, periodo: "ano", concluidos: true }, PADRAO_R],
    [PADRAO_F, { periodo: "mes", ordem: "total" }],
  ];

  it.each(COMBINACOES.map((c, i) => [i + 1, ...c] as const))(
    "round-trip %i: lerParamsVendas(parse(hrefVendas(f, r))) devolve f e r",
    async (_i, f, r) => {
      const { hrefVendas, lerParamsVendas } = await carregar();
      const lido = lerParamsVendas(parse(hrefVendas(BASE, f, r)));
      expect(lido).toEqual({ filtros: f, ranking: r, avisoFiltros: false, avisoRanking: false });
    },
  );

  it("RN-V18: mudar só o ranking não altera os filtros, e vice-versa", async () => {
    const { hrefVendas, lerParamsVendas } = await carregar();
    const f: Filtros = { ...PADRAO_F, periodo: "semana", entrega: "entrega" };
    const r1: Ranking = { periodo: "tudo", ordem: "total" };
    const r2: Ranking = { periodo: "ano", ordem: "ultimo" };
    expect(lerParamsVendas(parse(hrefVendas(BASE, f, r1))).filtros).toEqual(f);
    expect(lerParamsVendas(parse(hrefVendas(BASE, f, r2))).filtros).toEqual(f);
    const f2: Filtros = { ...PADRAO_F, periodo: "ano", concluidos: true };
    expect(lerParamsVendas(parse(hrefVendas(BASE, f, r1))).ranking).toEqual(r1);
    expect(lerParamsVendas(parse(hrefVendas(BASE, f2, r1))).ranking).toEqual(r1);
  });
});
