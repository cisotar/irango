// TDD RED-first — issue 322 (crítica: SIM). Validação zod da frequência de
// exibição (payloads de seleção múltipla, grade e categoria).
//
// Autoridade: specs/frequencia-exibicao.md RN-5, RN-6, RN-8 ·
// plan/tecnico-frequencia-exibicao.md C3 (schemas), D2/D13 (`[]` ≠ NULL),
// D3 (período com pontas independentes e `MSG_PERIODO_ORDEM`).
//
// Escrito a partir do PLANO: `src/lib/validacoes/frequencia.ts` não existe.
// Import por caminho em VARIÁVEL (padrão de `validacoes/cardapio.test.ts`).
//
// `MSG_HORA_PAR`/`MSG_HORA_ORDEM` vêm de `validacoes/cardapio.ts` — o plano manda
// importar, não copiar; o teste afirma que o schema novo usa as MESMAS frases.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MSG_HORA_PAR, MSG_HORA_ORDEM } from "./cardapio";
import { TETO_LOTE } from "./produto";

const MODULO = "./frequencia";
const FONTE = join(process.cwd(), "src", "lib", "validacoes", "frequencia.ts");

/** D3: literal. NÃO é `MSG_PRAZO_ORDEM` ("precisa ser depois"): fim = início vale. */
const MSG_PERIODO_ORDEM_LITERAL = "A data de fim não pode ser antes da de início.";

type Issue = { message: string; path: PropertyKey[] };
type Parse = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Schema = { safeParse(v: unknown): Parse };
type ModuloValidacao = {
  MSG_PERIODO_ORDEM: string;
  normalizarDiasDaFrequencia(dias: number[] | null): number[] | null;
  schemaFrequencia: Schema;
  schemaAplicarFrequencia: Schema;
  schemaGradeDeDias: Schema;
  schemaFrequenciaCategoria: Schema;
};
const EXPORTS = [
  "MSG_PERIODO_ORDEM",
  "normalizarDiasDaFrequencia",
  "schemaFrequencia",
  "schemaAplicarFrequencia",
  "schemaGradeDeDias",
  "schemaFrequenciaCategoria",
] as const;

async function mod(): Promise<ModuloValidacao> {
  let m: Partial<Record<(typeof EXPORTS)[number], unknown>>;
  try {
    m = (await import(/* @vite-ignore */ MODULO)) as typeof m;
  } catch (e) {
    throw new Error(
      `[RED 322] \`src/lib/validacoes/frequencia.ts\` ainda não existe (${(e as Error).message}). ` +
        `É a fase GREEN da issue 322 (C3 do plano técnico).`,
    );
  }
  const faltando = EXPORTS.filter((n) => m[n] == null);
  if (faltando.length > 0) {
    throw new Error(`[RED 322] \`validacoes/frequencia.ts\` ainda não exporta: ${faltando.join(", ")}.`);
  }
  return m as unknown as ModuloValidacao;
}

const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LOJA = "11111111-1111-4111-8111-111111111111";

const FREQ_OK = {
  dias_semana: [1, 2, 3, 4, 5],
  hora_inicio: "11:00",
  hora_fim: "15:00",
  periodo_inicio: "2026-12-01",
  periodo_fim: "2026-12-31",
};
const PERMANENTE = {
  dias_semana: null,
  hora_inicio: null,
  hora_fim: null,
  periodo_inicio: null,
  periodo_fim: null,
};
const f = (over: Record<string, unknown> = {}) => ({ ...FREQ_OK, ...over });

const mensagens = (r: Parse) => (r.error?.issues ?? []).map((i) => i.message);

/** uuid v4 sintético e distinto, para os tetos. */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// ═════════════════════════════════════════════════════════════════════════════
describe("[322/D3] mensagens literais", () => {
  it("MSG_PERIODO_ORDEM é a frase de D3, byte a byte", async () => {
    const { MSG_PERIODO_ORDEM } = await mod();
    expect(MSG_PERIODO_ORDEM).toBe(MSG_PERIODO_ORDEM_LITERAL);
  });

  it("só uma ponta de hora ⇒ MSG_HORA_PAR (importada de validacoes/cardapio)", async () => {
    const { schemaFrequencia } = await mod();
    const r1 = schemaFrequencia.safeParse(f({ hora_fim: null }));
    const r2 = schemaFrequencia.safeParse(f({ hora_inicio: null }));
    expect(r1.success).toBe(false);
    expect(mensagens(r1)).toContain(MSG_HORA_PAR);
    expect(r2.success).toBe(false);
    expect(mensagens(r2)).toContain(MSG_HORA_PAR);
  });

  it("fim <= início ⇒ MSG_HORA_ORDEM (15:00/11:00 e 11:00/11:00)", async () => {
    const { schemaFrequencia } = await mod();
    for (const [ini, fim] of [
      ["15:00", "11:00"],
      ["11:00", "11:00"],
    ]) {
      const r = schemaFrequencia.safeParse(f({ hora_inicio: ini, hora_fim: fim }));
      expect(r.success).toBe(false);
      expect(mensagens(r)).toContain(MSG_HORA_ORDEM);
    }
  });

  it("periodo_fim < periodo_inicio ⇒ MSG_PERIODO_ORDEM", async () => {
    const { schemaFrequencia } = await mod();
    const r = schemaFrequencia.safeParse(
      f({ periodo_inicio: "2026-12-31", periodo_fim: "2026-12-01" }),
    );
    expect(r.success).toBe(false);
    expect(mensagens(r)).toContain(MSG_PERIODO_ORDEM_LITERAL);
  });

  it("período de UM dia (fim = início) e meio-aberto são aceitos", async () => {
    const { schemaFrequencia } = await mod();
    expect(
      schemaFrequencia.safeParse(f({ periodo_inicio: "2026-12-24", periodo_fim: "2026-12-24" }))
        .success,
    ).toBe(true);
    expect(schemaFrequencia.safeParse(f({ periodo_fim: null })).success).toBe(true);
    expect(schemaFrequencia.safeParse(f({ periodo_inicio: null })).success).toBe(true);
  });

  it("`2026-02-30` é recusado (z.iso.date)", async () => {
    const { schemaFrequencia } = await mod();
    expect(schemaFrequencia.safeParse(f({ periodo_inicio: "2026-02-30" })).success).toBe(false);
  });

  it("permanente (5 null explícitos) é aceito e volta igual", async () => {
    const { schemaFrequencia } = await mod();
    const r = schemaFrequencia.safeParse(PERMANENTE);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(PERMANENTE);
  });
});

describe("[322/D2] normalização de dias", () => {
  it("[3,1,1] ⇒ [1,3] (dedup e ordena)", async () => {
    const { schemaFrequencia, normalizarDiasDaFrequencia } = await mod();
    expect(normalizarDiasDaFrequencia([3, 1, 1])).toEqual([1, 3]);
    const r = schemaFrequencia.safeParse(f({ dias_semana: [3, 1, 1] }));
    expect(r.success).toBe(true);
    expect((r.data as { dias_semana: unknown }).dias_semana).toEqual([1, 3]);
  });

  it("7 dias distintos ⇒ null (uma representação para 'todo dia')", async () => {
    const { schemaFrequencia, normalizarDiasDaFrequencia } = await mod();
    expect(normalizarDiasDaFrequencia([6, 5, 4, 3, 2, 1, 0])).toBeNull();
    const r = schemaFrequencia.safeParse(f({ dias_semana: [0, 1, 2, 3, 4, 5, 6] }));
    expect(r.success).toBe(true);
    expect((r.data as { dias_semana: unknown }).dias_semana).toBeNull();
  });

  it("dia 7 e dia -1 recusados", async () => {
    const { schemaFrequencia } = await mod();
    expect(schemaFrequencia.safeParse(f({ dias_semana: [7] })).success).toBe(false);
    expect(schemaFrequencia.safeParse(f({ dias_semana: [-1] })).success).toBe(false);
  });
});

describe("[322/RN-8] `[]` é aceito e continua `[]`; null continua null", () => {
  it("normalizarDiasDaFrequencia([]) ⇒ [] e (null) ⇒ null", async () => {
    const { normalizarDiasDaFrequencia } = await mod();
    const vazio = normalizarDiasDaFrequencia([]);
    expect(vazio).toEqual([]);
    expect(vazio).not.toBeNull();
    expect(normalizarDiasDaFrequencia(null)).toBeNull();
  });

  it("schemaFrequencia com dias_semana [] ⇒ aceito e devolvido []", async () => {
    const { schemaFrequencia } = await mod();
    const r = schemaFrequencia.safeParse(f({ dias_semana: [] }));
    expect(r.success).toBe(true);
    const dias = (r.data as { dias_semana: unknown }).dias_semana;
    expect(dias).toEqual([]);
    expect(dias).not.toBeNull();
  });

  it("schemaFrequencia com dias_semana null ⇒ null", async () => {
    const { schemaFrequencia } = await mod();
    const r = schemaFrequencia.safeParse(f({ dias_semana: null }));
    expect(r.success).toBe(true);
    expect((r.data as { dias_semana: unknown }).dias_semana).toBeNull();
  });

  it("grade com uma linha `[]` é aceita e a linha continua `[]`", async () => {
    const { schemaGradeDeDias } = await mod();
    const r = schemaGradeDeDias.safeParse({
      itens: [
        { produto_id: P1, dias_semana: [] },
        { produto_id: P2, dias_semana: [0, 6] },
      ],
    });
    expect(r.success).toBe(true);
    const itens = (r.data as { itens: { dias_semana: unknown }[] }).itens;
    expect(itens[0].dias_semana).toEqual([]);
    expect(itens[0].dias_semana).not.toBeNull();
    expect(itens[1].dias_semana).toEqual([0, 6]);
  });
});

describe("[322/D13] chaves obrigatórias e `.strict()`", () => {
  it("chave `dias_semana` AUSENTE é recusada (não vira null)", async () => {
    const { schemaFrequencia, schemaGradeDeDias } = await mod();
    const { dias_semana: _omitida, ...semDias } = FREQ_OK;
    void _omitida;
    expect(schemaFrequencia.safeParse(semDias).success).toBe(false);
    expect(schemaGradeDeDias.safeParse({ itens: [{ produto_id: P1 }] }).success).toBe(false);
  });

  it("qualquer uma das 5 chaves ausente é recusada", async () => {
    const { schemaFrequencia } = await mod();
    for (const chave of Object.keys(FREQ_OK)) {
      const copia: Record<string, unknown> = { ...FREQ_OK };
      delete copia[chave];
      expect(schemaFrequencia.safeParse(copia).success, `sem ${chave}`).toBe(false);
    }
  });

  it("chave extra recusada: `loja_id` no corpo, em todos os schemas", async () => {
    const m = await mod();
    expect(m.schemaFrequencia.safeParse({ ...FREQ_OK, loja_id: LOJA }).success).toBe(false);
    expect(
      m.schemaAplicarFrequencia.safeParse({ produto_ids: [P1], frequencia: FREQ_OK, loja_id: LOJA })
        .success,
    ).toBe(false);
    expect(
      m.schemaGradeDeDias.safeParse({ itens: [{ produto_id: P1, dias_semana: [1] }], loja_id: LOJA })
        .success,
    ).toBe(false);
    expect(
      m.schemaGradeDeDias.safeParse({
        itens: [{ produto_id: P1, dias_semana: [1], loja_id: LOJA }],
      }).success,
    ).toBe(false);
    expect(
      m.schemaFrequenciaCategoria.safeParse({ categoria_id: CAT, frequencia: FREQ_OK, loja_id: LOJA })
        .success,
    ).toBe(false);
  });
});

describe("[322] schemaAplicarFrequencia (seleção múltipla)", () => {
  it("forma mínima aceita", async () => {
    const { schemaAplicarFrequencia } = await mod();
    const r = schemaAplicarFrequencia.safeParse({ produto_ids: [P1, P2], frequencia: FREQ_OK });
    expect(r.success).toBe(true);
  });

  it("lista vazia recusada; TETO_LOTE aceito; TETO_LOTE + 1 recusado", async () => {
    const { schemaAplicarFrequencia } = await mod();
    expect(schemaAplicarFrequencia.safeParse({ produto_ids: [], frequencia: FREQ_OK }).success).toBe(
      false,
    );
    const noTeto = Array.from({ length: TETO_LOTE }, (_, i) => uuid(i + 1));
    expect(
      schemaAplicarFrequencia.safeParse({ produto_ids: noTeto, frequencia: FREQ_OK }).success,
    ).toBe(true);
    const acima = Array.from({ length: TETO_LOTE + 1 }, (_, i) => uuid(i + 1));
    expect(
      schemaAplicarFrequencia.safeParse({ produto_ids: acima, frequencia: FREQ_OK }).success,
    ).toBe(false);
  });

  it("id repetido recusado; id não-uuid recusado", async () => {
    const { schemaAplicarFrequencia } = await mod();
    expect(
      schemaAplicarFrequencia.safeParse({ produto_ids: [P1, P1], frequencia: FREQ_OK }).success,
    ).toBe(false);
    expect(
      schemaAplicarFrequencia.safeParse({ produto_ids: ["nao-e-uuid"], frequencia: FREQ_OK })
        .success,
    ).toBe(false);
  });

  it("frequência inválida dentro do lote propaga MSG_HORA_ORDEM", async () => {
    const { schemaAplicarFrequencia } = await mod();
    const r = schemaAplicarFrequencia.safeParse({
      produto_ids: [P1],
      frequencia: f({ hora_inicio: "15:00", hora_fim: "11:00" }),
    });
    expect(r.success).toBe(false);
    expect(mensagens(r)).toContain(MSG_HORA_ORDEM);
  });
});

describe("[322] schemaGradeDeDias", () => {
  it("lista vazia recusada; TETO_LOTE + 1 recusado", async () => {
    const { schemaGradeDeDias } = await mod();
    expect(schemaGradeDeDias.safeParse({ itens: [] }).success).toBe(false);
    const acima = Array.from({ length: TETO_LOTE + 1 }, (_, i) => ({
      produto_id: uuid(i + 1),
      dias_semana: [1],
    }));
    expect(schemaGradeDeDias.safeParse({ itens: acima }).success).toBe(false);
  });

  it("produto_id repetido recusado", async () => {
    const { schemaGradeDeDias } = await mod();
    expect(
      schemaGradeDeDias.safeParse({
        itens: [
          { produto_id: P1, dias_semana: [1] },
          { produto_id: P1, dias_semana: [2] },
        ],
      }).success,
    ).toBe(false);
  });

  it("linha com 7 dias vira null; dia 7 recusado", async () => {
    const { schemaGradeDeDias } = await mod();
    const r = schemaGradeDeDias.safeParse({
      itens: [{ produto_id: P1, dias_semana: [0, 1, 2, 3, 4, 5, 6] }],
    });
    expect(r.success).toBe(true);
    expect((r.data as { itens: { dias_semana: unknown }[] }).itens[0].dias_semana).toBeNull();
    expect(
      schemaGradeDeDias.safeParse({ itens: [{ produto_id: P1, dias_semana: [7] }] }).success,
    ).toBe(false);
  });
});

describe("[322] schemaFrequenciaCategoria", () => {
  it("forma mínima aceita; categoria_id não-uuid recusado", async () => {
    const { schemaFrequenciaCategoria } = await mod();
    expect(
      schemaFrequenciaCategoria.safeParse({ categoria_id: CAT, frequencia: FREQ_OK }).success,
    ).toBe(true);
    expect(
      schemaFrequenciaCategoria.safeParse({ categoria_id: "x", frequencia: FREQ_OK }).success,
    ).toBe(false);
  });

  it("`oculta` não entra pela frequência (strict)", async () => {
    const { schemaFrequenciaCategoria } = await mod();
    expect(
      schemaFrequenciaCategoria.safeParse({
        categoria_id: CAT,
        frequencia: { ...FREQ_OK, oculta: true },
      }).success,
    ).toBe(false);
  });
});

describe("[322/D2] guarda estática", () => {
  it("o fonte NÃO importa `normalizarDiasDoVinculo` (faz [] → null, o oposto de RN-8)", () => {
    if (!existsSync(FONTE)) {
      throw new Error("[RED 322] `src/lib/validacoes/frequencia.ts` ainda não existe.");
    }
    expect(readFileSync(FONTE, "utf8")).not.toMatch(/normalizarDiasDoVinculo/);
  });
});
