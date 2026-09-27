// TDD RED-first — issue 321 (crítica: SIM). Avaliador PURO de frequência de
// exibição: produto ∩ categoria, no fuso da loja.
//
// Autoridade: specs/frequencia-exibicao.md RN-1 (interseção), RN-2 (categoria
// oculta/fora), RN-3 (produto fora ⇒ indisponível), RN-7 (período encerrado
// some), RN-8 (`[]` = nunca, distinto de NULL = todo dia) ·
// plan/tecnico-frequencia-exibicao.md C2 (contrato), D8 (motivos e
// precedência), D12 (RN-7 no TS), D13 (`[]` × NULL).
//
// Escrito a partir do PLANO, nunca do código: `src/lib/utils/frequencia.ts` não
// existe. Import por caminho em VARIÁVEL (padrão de `validacoes/cardapio.test.ts`)
// para o RED ser "módulo/exports ausentes", não erro de resolução que derruba a
// coleta e o `tsc`.
//
// Instantes: sempre escritos com o OFFSET da loja (`-03:00` São Paulo, `-04:00`
// Manaus), nunca calculados pela função sob teste. Nenhum `Intl` aqui.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MODULO_FREQUENCIA = "./frequencia";
const FONTE_FREQUENCIA = join(process.cwd(), "src", "lib", "utils", "frequencia.ts");

// ── Contrato C2, declarado AQUI para o RED não tocar produção ────────────────
type Frequencia = {
  dias_semana: number[] | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
};
type CategoriaFrequencia = Frequencia & { oculta: boolean };
type MotivoIndisponivel = "categoria_oculta" | "encerrado" | "fora_da_frequencia";
type AvaliacaoFrequencia =
  | { disponivel: true; motivo: null }
  | { disponivel: false; motivo: MotivoIndisponivel };
type Combinacao = { vazia: true } | { vazia: false; frequencia: Frequencia };

type ModuloFrequencia = {
  FREQUENCIA_PERMANENTE: Frequencia;
  periodoEncerrado(f: Frequencia, agora: Date, timezone: string): boolean;
  dentroDaFrequencia(f: Frequencia, agora: Date, timezone: string): boolean;
  avaliarFrequencia(
    produto: Frequencia,
    categoria: CategoriaFrequencia | null,
    agora: Date,
    timezone: string,
  ): AvaliacaoFrequencia;
  avaliarFrequenciaNaLoja(
    produto: Frequencia & { categoria_id: string | null },
    categoriasPorId: ReadonlyMap<string, CategoriaFrequencia>,
    agora: Date,
    timezone: string,
  ): AvaliacaoFrequencia;
  categoriaVisivel(c: CategoriaFrequencia, agora: Date, timezone: string): boolean;
  combinarFrequencias(a: Frequencia, b: Frequencia | null): Combinacao;
  frequenciaNuncaAbre(produto: Frequencia, categoria: Frequencia | null): boolean;
};

const EXPORTS = [
  "FREQUENCIA_PERMANENTE",
  "periodoEncerrado",
  "dentroDaFrequencia",
  "avaliarFrequencia",
  "avaliarFrequenciaNaLoja",
  "categoriaVisivel",
  "combinarFrequencias",
  "frequenciaNuncaAbre",
] as const;

async function mod(): Promise<ModuloFrequencia> {
  let m: Partial<Record<(typeof EXPORTS)[number], unknown>>;
  try {
    m = (await import(/* @vite-ignore */ MODULO_FREQUENCIA)) as typeof m;
  } catch (e) {
    throw new Error(
      `[RED 321] \`src/lib/utils/frequencia.ts\` ainda não existe (${(e as Error).message}). ` +
        `É a fase GREEN da issue 321 (C2 do plano técnico).`,
    );
  }
  const faltando = EXPORTS.filter((n) => m[n] == null);
  if (faltando.length > 0) {
    throw new Error(
      `[RED 321] \`src/lib/utils/frequencia.ts\` ainda não exporta: ${faltando.join(", ")}.`,
    );
  }
  return m as unknown as ModuloFrequencia;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SP = "America/Sao_Paulo";
const MANAUS = "America/Manaus";

/** Instante LOCAL em São Paulo (UTC-3, sem horário de verão desde 2019). */
const sp = (dataHora: string) => new Date(`${dataHora}:00-03:00`);

const PERMANENTE: Frequencia = {
  dias_semana: null,
  hora_inicio: null,
  hora_fim: null,
  periodo_inicio: null,
  periodo_fim: null,
};
const freq = (over: Partial<Frequencia> = {}): Frequencia => ({ ...PERMANENTE, ...over });
const cat = (over: Partial<CategoriaFrequencia> = {}): CategoriaFrequencia => ({
  ...PERMANENTE,
  oculta: false,
  ...over,
});

const DISPONIVEL = { disponivel: true, motivo: null } as const;
const FORA = { disponivel: false, motivo: "fora_da_frequencia" } as const;
const ENCERRADO = { disponivel: false, motivo: "encerrado" } as const;
const OCULTA = { disponivel: false, motivo: "categoria_oculta" } as const;

/** Semana de dom 04/10/2026 a sáb 10/10/2026 (conferido no calendário). */
const SEMANA = [
  "2026-10-04", // dom (0)
  "2026-10-05", // seg (1)
  "2026-10-06", // ter (2)
  "2026-10-07", // qua (3)
  "2026-10-08", // qui (4)
  "2026-10-09", // sex (5)
  "2026-10-10", // sáb (6)
] as const;
const HORARIOS_AMOSTRA = ["03:00", "12:00", "22:30"] as const;
const SEMANA_X_HORARIOS = SEMANA.flatMap((d) => HORARIOS_AMOSTRA.map((h) => sp(`${d}T${h}`)));

/** Sáb 03/10/2026 — base dos casos de hora. */
const SABADO = "2026-10-03";

// ═════════════════════════════════════════════════════════════════════════════
describe("[321] contrato do módulo", () => {
  it("exporta o avaliador e FREQUENCIA_PERMANENTE com os 5 eixos null", async () => {
    const { FREQUENCIA_PERMANENTE } = await mod();
    expect(FREQUENCIA_PERMANENTE).toEqual(PERMANENTE);
  });

  it("guarda estática: o fonte não usa `Intl` (fuso vem de fusoLoja.ts)", () => {
    if (!existsSync(FONTE_FREQUENCIA)) {
      throw new Error("[RED 321] `src/lib/utils/frequencia.ts` ainda não existe.");
    }
    const fonte = readFileSync(FONTE_FREQUENCIA, "utf8");
    expect(fonte).not.toMatch(/\bIntl\b/);
  });
});

describe("[321/S3] permanente", () => {
  it("5 eixos null, sem categoria ⇒ disponível em qualquer instante", async () => {
    const { avaliarFrequencia } = await mod();
    for (const agora of SEMANA_X_HORARIOS) {
      expect(avaliarFrequencia(PERMANENTE, null, agora, SP)).toEqual(DISPONIVEL);
    }
  });

  it("S5: ignora `visibilidade` — produto 'cardapio' permanente é disponível", async () => {
    const { avaliarFrequencia } = await mod();
    const legado = { ...PERMANENTE, visibilidade: "cardapio" } as Frequencia;
    expect(avaliarFrequencia(legado, null, sp(`${SABADO}T12:00`), SP)).toEqual(DISPONIVEL);
  });
});

describe("[321] eixo dia da semana", () => {
  it("item só sáb: sábado ✓, sexta ✗ (fora_da_frequencia)", async () => {
    const { avaliarFrequencia } = await mod();
    const soSabado = freq({ dias_semana: [6] });
    expect(avaliarFrequencia(soSabado, null, sp("2026-10-10T12:00"), SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(soSabado, null, sp("2026-10-09T12:00"), SP)).toEqual(FORA);
  });
});

describe("[321/S2] faixa de horário: início INCLUSIVO, fim EXCLUSIVO", () => {
  const casos: [string, (typeof DISPONIVEL) | (typeof FORA)][] = [
    ["10:59", FORA],
    ["11:00", DISPONIVEL],
    ["14:59", DISPONIVEL],
    ["15:00", FORA],
  ];

  for (const formato of [
    { ini: "11:00", fim: "15:00" },
    { ini: "11:00:00", fim: "15:00:00" }, // `time` do PG volta com segundos
  ]) {
    for (const [hora, esperado] of casos) {
      it(`${formato.ini}–${formato.fim} às ${hora} ⇒ ${esperado.disponivel ? "✓" : "✗"}`, async () => {
        const { avaliarFrequencia } = await mod();
        const f = freq({ hora_inicio: formato.ini, hora_fim: formato.fim });
        expect(avaliarFrequencia(f, null, sp(`${SABADO}T${hora}`), SP)).toEqual(esperado);
      });
    }
  }
});

describe("[321/S1 + RN-7] período de datas, inclusivo nas duas pontas", () => {
  const DEZEMBRO = freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });

  it("30/11 23:59 local ⇒ fora_da_frequencia (antes do início NÃO é encerrado)", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(DEZEMBRO, null, sp("2026-11-30T23:59"), SP)).toEqual(FORA);
  });

  it("01/12 00:00 local ⇒ disponível", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(DEZEMBRO, null, sp("2026-12-01T00:00"), SP)).toEqual(DISPONIVEL);
  });

  it("31/12 23:59 local ⇒ disponível", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(DEZEMBRO, null, sp("2026-12-31T23:59"), SP)).toEqual(DISPONIVEL);
  });

  it("RN-7: 01/01 00:00 local ⇒ encerrado", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(DEZEMBRO, null, sp("2027-01-01T00:00"), SP)).toEqual(ENCERRADO);
  });

  it("RN-7: 15/01 ⇒ encerrado", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(DEZEMBRO, null, sp("2027-01-15T12:00"), SP)).toEqual(ENCERRADO);
  });

  it("período de UM dia (fim = início) vale o dia inteiro", async () => {
    const { avaliarFrequencia } = await mod();
    const umDia = freq({ periodo_inicio: "2026-12-24", periodo_fim: "2026-12-24" });
    expect(avaliarFrequencia(umDia, null, sp("2026-12-24T00:00"), SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(umDia, null, sp("2026-12-24T23:59"), SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(umDia, null, sp("2026-12-25T00:00"), SP)).toEqual(ENCERRADO);
  });

  it("meio-aberto só início: antes ✗ fora, depois ✓ para sempre", async () => {
    const { avaliarFrequencia } = await mod();
    const desde = freq({ periodo_inicio: "2026-12-01" });
    expect(avaliarFrequencia(desde, null, sp("2026-11-30T12:00"), SP)).toEqual(FORA);
    expect(avaliarFrequencia(desde, null, sp("2030-06-15T12:00"), SP)).toEqual(DISPONIVEL);
  });

  it("meio-aberto só fim (RN-7): antes ✓, depois ⇒ encerrado", async () => {
    const { avaliarFrequencia } = await mod();
    const ate = freq({ periodo_fim: "2026-12-31" });
    expect(avaliarFrequencia(ate, null, sp("2026-11-15T12:00"), SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(ate, null, sp("2027-01-01T00:00"), SP)).toEqual(ENCERRADO);
  });
});

describe("[321] fuso da loja na virada do dia", () => {
  // 2026-10-03T03:30Z = sáb 00:30 em São Paulo e sex 23:30 em Manaus.
  const VIRADA = new Date("2026-10-03T03:30:00.000Z");

  it("item só sáb: São Paulo ✓, Manaus ✗", async () => {
    const { avaliarFrequencia } = await mod();
    const soSabado = freq({ dias_semana: [6] });
    expect(avaliarFrequencia(soSabado, null, VIRADA, SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(soSabado, null, VIRADA, MANAUS)).toEqual(FORA);
  });

  it("periodo_inicio 2026-10-03: São Paulo ✓, Manaus ✗ (ainda é dia 02)", async () => {
    const { avaliarFrequencia } = await mod();
    const desde = freq({ periodo_inicio: "2026-10-03" });
    expect(avaliarFrequencia(desde, null, VIRADA, SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequencia(desde, null, VIRADA, MANAUS)).toEqual(FORA);
  });

  it("RN-7: periodo_fim 2026-12-31 às 2027-01-01T03:30Z: SP encerrado, Manaus disponível", async () => {
    const { avaliarFrequencia } = await mod();
    const agora = new Date("2027-01-01T03:30:00.000Z");
    const ate = freq({ periodo_fim: "2026-12-31" });
    expect(avaliarFrequencia(ate, null, agora, SP)).toEqual(ENCERRADO);
    expect(avaliarFrequencia(ate, null, agora, MANAUS)).toEqual(DISPONIVEL);
  });
});

describe("[321/RN-1] interseção produto ∩ categoria", () => {
  const CAT_SEG_SEX = cat({ dias_semana: [1, 2, 3, 4, 5] });
  const ITEM_SABADO = freq({ dias_semana: [6] });

  it("categoria seg–sex + item só sáb ⇒ indisponível nos 7 dias × 3 horários", async () => {
    const { avaliarFrequencia } = await mod();
    for (const agora of SEMANA_X_HORARIOS) {
      expect(avaliarFrequencia(ITEM_SABADO, CAT_SEG_SEX, agora, SP)).toEqual(FORA);
    }
  });

  it("…e frequenciaNuncaAbre(item, categoria) = true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(frequenciaNuncaAbre(ITEM_SABADO, CAT_SEG_SEX)).toBe(true);
  });

  it("categoria fora (item permanente) ⇒ fora_da_frequencia", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(PERMANENTE, CAT_SEG_SEX, sp("2026-10-10T12:00"), SP)).toEqual(FORA);
    expect(avaliarFrequencia(PERMANENTE, CAT_SEG_SEX, sp("2026-10-07T12:00"), SP)).toEqual(
      DISPONIVEL,
    );
  });

  it("os dois dentro ⇒ disponível", async () => {
    const { avaliarFrequencia } = await mod();
    const item = freq({ dias_semana: [3], hora_inicio: "11:00", hora_fim: "15:00" });
    expect(avaliarFrequencia(item, CAT_SEG_SEX, sp("2026-10-07T12:00"), SP)).toEqual(DISPONIVEL);
  });
});

describe("[321/RN-2 + D8] categoria oculta e precedência", () => {
  it("categoria oculta ⇒ categoria_oculta MESMO dentro da janela", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(PERMANENTE, cat({ oculta: true }), sp(`${SABADO}T12:00`), SP)).toEqual(
      OCULTA,
    );
  });

  it("categoria oculta E encerrada ⇒ categoria_oculta (oculta vence)", async () => {
    const { avaliarFrequencia } = await mod();
    const c = cat({ oculta: true, periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
    expect(avaliarFrequencia(PERMANENTE, c, sp("2027-01-15T12:00"), SP)).toEqual(OCULTA);
  });

  it("produto `[]` E encerrado ⇒ encerrado (RN-7 vence RN-8)", async () => {
    const { avaliarFrequencia } = await mod();
    const p = freq({ dias_semana: [], periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
    expect(avaliarFrequencia(p, null, sp("2027-01-15T12:00"), SP)).toEqual(ENCERRADO);
  });

  it("categoria encerrada + produto dentro da janela ⇒ encerrado", async () => {
    const { avaliarFrequencia } = await mod();
    const natal = cat({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
    expect(avaliarFrequencia(PERMANENTE, natal, sp("2027-01-15T12:00"), SP)).toEqual(ENCERRADO);
  });
});

describe("[321/RN-7] categoriaVisivel", () => {
  it("categoria encerrada (produto sem período) ⇒ categoriaVisivel false e item encerrado", async () => {
    const { categoriaVisivel, avaliarFrequencia } = await mod();
    const natal = cat({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
    expect(categoriaVisivel(natal, sp("2027-01-15T12:00"), SP)).toBe(false);
    expect(avaliarFrequencia(PERMANENTE, natal, sp("2027-01-15T12:00"), SP)).toEqual(ENCERRADO);
  });

  it("categoria com início futuro ⇒ visível, item fora_da_frequencia", async () => {
    const { categoriaVisivel, avaliarFrequencia } = await mod();
    const natal = cat({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" });
    expect(categoriaVisivel(natal, sp("2026-11-20T12:00"), SP)).toBe(true);
    expect(avaliarFrequencia(PERMANENTE, natal, sp("2026-11-20T12:00"), SP)).toEqual(FORA);
  });

  it("categoria oculta ⇒ invisível; categoria `[]` (RN-8) ⇒ visível", async () => {
    const { categoriaVisivel } = await mod();
    expect(categoriaVisivel(cat({ oculta: true }), sp(`${SABADO}T12:00`), SP)).toBe(false);
    expect(categoriaVisivel(cat({ dias_semana: [] }), sp(`${SABADO}T12:00`), SP)).toBe(true);
    expect(categoriaVisivel(cat(), sp(`${SABADO}T12:00`), SP)).toBe(true);
  });
});

describe("[321/RN-8] `dias_semana = []` é NUNCA; NULL é todo dia", () => {
  it("produto `[]` ⇒ fora_da_frequencia nos 7 dias × 3 horários", async () => {
    const { avaliarFrequencia } = await mod();
    for (const agora of SEMANA_X_HORARIOS) {
      expect(avaliarFrequencia(freq({ dias_semana: [] }), null, agora, SP)).toEqual(FORA);
    }
  });

  it("contraprova: `null` e `[0..6]` ⇒ disponível nos mesmos instantes", async () => {
    const { avaliarFrequencia } = await mod();
    for (const agora of SEMANA_X_HORARIOS) {
      expect(avaliarFrequencia(freq({ dias_semana: null }), null, agora, SP)).toEqual(DISPONIVEL);
      expect(
        avaliarFrequencia(freq({ dias_semana: [0, 1, 2, 3, 4, 5, 6] }), null, agora, SP),
      ).toEqual(DISPONIVEL);
    }
  });

  it("categoria `[]` ⇒ todo item fora_da_frequencia", async () => {
    const { avaliarFrequencia } = await mod();
    for (const agora of SEMANA_X_HORARIOS) {
      expect(avaliarFrequencia(PERMANENTE, cat({ dias_semana: [] }), agora, SP)).toEqual(FORA);
    }
  });
});

describe("[321] fail-closed para estados que os CHECKs tornam impossíveis", () => {
  const agora = sp(`${SABADO}T12:00`);

  it("hora sem par ⇒ indisponível", async () => {
    const { avaliarFrequencia } = await mod();
    expect(avaliarFrequencia(freq({ hora_inicio: "11:00" }), null, agora, SP).disponivel).toBe(false);
    expect(avaliarFrequencia(freq({ hora_fim: "15:00" }), null, agora, SP).disponivel).toBe(false);
  });

  it('hora "xx" ⇒ indisponível', async () => {
    const { avaliarFrequencia } = await mod();
    const f = freq({ hora_inicio: "xx", hora_fim: "15:00" });
    expect(avaliarFrequencia(f, null, agora, SP).disponivel).toBe(false);
  });

  it('período "31/12/2026" (fora de YYYY-MM-DD) ⇒ indisponível', async () => {
    const { avaliarFrequencia } = await mod();
    expect(
      avaliarFrequencia(freq({ periodo_inicio: "31/12/2026" }), null, agora, SP).disponivel,
    ).toBe(false);
    expect(
      avaliarFrequencia(freq({ periodo_fim: "31/12/2026" }), null, agora, SP).disponivel,
    ).toBe(false);
  });

  it("periodoEncerrado com periodo_fim malformado ⇒ true; com null ⇒ false", async () => {
    const { periodoEncerrado } = await mod();
    expect(periodoEncerrado(freq({ periodo_fim: "31/12/2026" }), agora, SP)).toBe(true);
    expect(periodoEncerrado(freq({ periodo_fim: null }), agora, SP)).toBe(false);
  });
});

describe("[321] dentroDaFrequencia e periodoEncerrado (sem categoria)", () => {
  it("dentroDaFrequencia respeita os três eixos juntos (AND)", async () => {
    const { dentroDaFrequencia } = await mod();
    const f = freq({
      dias_semana: [6],
      hora_inicio: "11:00",
      hora_fim: "15:00",
      periodo_inicio: "2026-10-01",
      periodo_fim: "2026-10-31",
    });
    expect(dentroDaFrequencia(f, sp("2026-10-10T12:00"), SP)).toBe(true);
    expect(dentroDaFrequencia(f, sp("2026-10-10T16:00"), SP)).toBe(false); // hora
    expect(dentroDaFrequencia(f, sp("2026-10-09T12:00"), SP)).toBe(false); // dia
    expect(dentroDaFrequencia(f, sp("2026-11-07T12:00"), SP)).toBe(false); // período
  });

  it("periodoEncerrado: só depois de periodo_fim no dia civil da loja", async () => {
    const { periodoEncerrado } = await mod();
    const ate = freq({ periodo_fim: "2026-12-31" });
    expect(periodoEncerrado(ate, sp("2026-12-31T23:59"), SP)).toBe(false);
    expect(periodoEncerrado(ate, sp("2027-01-01T00:00"), SP)).toBe(true);
    expect(periodoEncerrado(freq({ periodo_inicio: "2027-01-01" }), sp("2026-12-01T12:00"), SP)).toBe(
      false,
    );
  });
});

describe("[321] avaliarFrequenciaNaLoja resolve a categoria pelo mapa", () => {
  const CAT = "cccccccc-0000-4000-8000-000000000321";
  const agora = sp(`${SABADO}T12:00`);

  it("categoria_id null ⇒ só o produto decide", async () => {
    const { avaliarFrequenciaNaLoja } = await mod();
    const vazio = new Map<string, CategoriaFrequencia>();
    expect(avaliarFrequenciaNaLoja({ ...PERMANENTE, categoria_id: null }, vazio, agora, SP)).toEqual(
      DISPONIVEL,
    );
    expect(
      avaliarFrequenciaNaLoja({ ...freq({ dias_semana: [1] }), categoria_id: null }, vazio, agora, SP),
    ).toEqual(FORA);
  });

  it("id ausente do mapa ⇒ categoria_oculta (fail-closed)", async () => {
    const { avaliarFrequenciaNaLoja } = await mod();
    expect(
      avaliarFrequenciaNaLoja(
        { ...PERMANENTE, categoria_id: CAT },
        new Map<string, CategoriaFrequencia>(),
        agora,
        SP,
      ),
    ).toEqual(OCULTA);
  });

  it("id presente ⇒ aplica a categoria (oculta e fora)", async () => {
    const { avaliarFrequenciaNaLoja } = await mod();
    const p = { ...PERMANENTE, categoria_id: CAT };
    expect(avaliarFrequenciaNaLoja(p, new Map([[CAT, cat()]]), agora, SP)).toEqual(DISPONIVEL);
    expect(avaliarFrequenciaNaLoja(p, new Map([[CAT, cat({ oculta: true })]]), agora, SP)).toEqual(
      OCULTA,
    );
    expect(
      avaliarFrequenciaNaLoja(p, new Map([[CAT, cat({ dias_semana: [1] })]]), agora, SP),
    ).toEqual(FORA);
  });
});

describe("[321] combinarFrequencias — retorno discriminado `{ vazia }`", () => {
  it("dias disjuntos ⇒ exatamente { vazia: true }", async () => {
    const { combinarFrequencias } = await mod();
    expect(combinarFrequencias(freq({ dias_semana: [6] }), freq({ dias_semana: [1, 2] }))).toEqual({
      vazia: true,
    });
  });

  it("b null ⇒ { vazia: false, frequencia: a }", async () => {
    const { combinarFrequencias } = await mod();
    const a = freq({ dias_semana: [2, 4], hora_inicio: "11:00", hora_fim: "15:00" });
    expect(combinarFrequencias(a, null)).toEqual({ vazia: false, frequencia: a });
  });

  it("sobreposição: dias ∩, maior início de hora, menor fim; período ∩", async () => {
    const { combinarFrequencias } = await mod();
    const r = combinarFrequencias(
      freq({
        dias_semana: [5, 6],
        hora_inicio: "11:00",
        hora_fim: "15:00",
        periodo_inicio: "2026-12-01",
        periodo_fim: "2026-12-31",
      }),
      freq({
        dias_semana: [1, 2, 3, 4, 5],
        hora_inicio: "14:00",
        hora_fim: "18:00",
        periodo_inicio: "2026-12-10",
        periodo_fim: "2027-01-10",
      }),
    );
    expect(r.vazia).toBe(false);
    if (r.vazia) return;
    expect(r.frequencia.dias_semana).toEqual([5]);
    expect(r.frequencia.hora_inicio?.slice(0, 5)).toBe("14:00");
    expect(r.frequencia.hora_fim?.slice(0, 5)).toBe("15:00");
    expect(r.frequencia.periodo_inicio).toBe("2026-12-10");
    expect(r.frequencia.periodo_fim).toBe("2026-12-31");
  });

  it("NULL × subconjunto ⇒ o subconjunto; NULL × NULL ⇒ NULL (não [])", async () => {
    const { combinarFrequencias } = await mod();
    const r1 = combinarFrequencias(freq(), freq({ dias_semana: [0, 6] }));
    expect(r1).toEqual({ vazia: false, frequencia: freq({ dias_semana: [0, 6] }) });
    const r2 = combinarFrequencias(freq(), freq());
    expect(r2).toEqual({ vazia: false, frequencia: PERMANENTE });
  });
});

describe("[321/RN-1 + RN-8] frequenciaNuncaAbre (preview do painel)", () => {
  it("dias disjuntos ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(frequenciaNuncaAbre(freq({ dias_semana: [6] }), freq({ dias_semana: [1, 2, 3] }))).toBe(
      true,
    );
  });

  it("sáb–dom × seg–sex ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(
      frequenciaNuncaAbre(freq({ dias_semana: [0, 6] }), freq({ dias_semana: [1, 2, 3, 4, 5] })),
    ).toBe(true);
  });

  it("horas disjuntas ⇒ true; horas encostadas (fim exclusivo) ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    const almoco = freq({ hora_inicio: "11:00", hora_fim: "15:00" });
    expect(frequenciaNuncaAbre(almoco, freq({ hora_inicio: "18:00", hora_fim: "22:00" }))).toBe(true);
    expect(frequenciaNuncaAbre(almoco, freq({ hora_inicio: "15:00", hora_fim: "18:00" }))).toBe(true);
  });

  it("períodos disjuntos ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(
      frequenciaNuncaAbre(
        freq({ periodo_inicio: "2026-12-01", periodo_fim: "2026-12-31" }),
        freq({ periodo_inicio: "2027-01-01", periodo_fim: "2027-01-31" }),
      ),
    ).toBe(true);
  });

  it("`[]` de qualquer lado ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(frequenciaNuncaAbre(freq({ dias_semana: [] }), null)).toBe(true);
    expect(frequenciaNuncaAbre(freq({ dias_semana: [] }), freq())).toBe(true);
    expect(frequenciaNuncaAbre(freq(), freq({ dias_semana: [] }))).toBe(true);
  });

  it("período fechado ≤ 7 dias sem nenhum dia marcado dentro ⇒ true", async () => {
    const { frequenciaNuncaAbre } = await mod();
    // seg 07/12/2026 a ter 08/12/2026, item só sáb.
    const p = freq({ dias_semana: [6], periodo_inicio: "2026-12-07", periodo_fim: "2026-12-08" });
    expect(frequenciaNuncaAbre(p, null)).toBe(true);
  });

  it("contraprova: 7 dias contêm um sábado ⇒ false", async () => {
    const { frequenciaNuncaAbre } = await mod();
    const p = freq({ dias_semana: [6], periodo_inicio: "2026-12-07", periodo_fim: "2026-12-13" });
    expect(frequenciaNuncaAbre(p, null)).toBe(false);
  });

  it("sobreposição ⇒ false; NULL × NULL ⇒ false; sem categoria ⇒ false", async () => {
    const { frequenciaNuncaAbre } = await mod();
    expect(
      frequenciaNuncaAbre(freq({ dias_semana: [5, 6] }), freq({ dias_semana: [1, 2, 3, 4, 5] })),
    ).toBe(false);
    expect(
      frequenciaNuncaAbre(
        freq({ hora_inicio: "11:00", hora_fim: "15:00" }),
        freq({ hora_inicio: "14:00", hora_fim: "18:00" }),
      ),
    ).toBe(false);
    expect(frequenciaNuncaAbre(freq(), freq())).toBe(false);
    expect(frequenciaNuncaAbre(freq(), null)).toBe(false);
  });
});
