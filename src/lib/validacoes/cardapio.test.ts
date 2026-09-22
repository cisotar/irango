import { describe, it, expect } from "vitest";
import {
  schemaCardapio,
  schemaLoteDeProdutos,
  MSG_SEM_EIXO,
  MSG_HORA_PAR,
  MSG_HORA_ORDEM,
  MSG_PRAZO_FIM_AUSENTE,
  MSG_PRAZO_ORDEM,
  ehMensagemDeVigencia,
} from "./cardapio";

/**
 * [255] `schemaCardapio` — a barreira LEGÍVEL dos CHECKs de 20260920128000.
 *
 * Cada recusa aqui tem um CHECK correspondente no banco (RN-01, RN-02, RN-04):
 * o zod existe para que o lojista leia uma frase em vez de um `23514`. O par
 * é deliberado — este arquivo prova a frase, `tests/migrations/` prova o CHECK.
 */

const mensagens = (payload: unknown): string[] => {
  const r = schemaCardapio.safeParse(payload);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("schemaCardapio — modo recorrente (RN-01, RN-02)", () => {
  it("aceita dias da semana e normaliza o eixo: sem duplicata, ordenado", () => {
    const r = schemaCardapio.parse({
      nome: "  Fim de semana  ",
      modo: "recorrente",
      dias_semana: [6, 0, 6],
      hora_inicio: "11:00",
      hora_fim: "15:00",
    });
    expect(r).toEqual({
      nome: "Fim de semana",
      modo: "recorrente",
      dias_semana: [0, 6],
      dias_mes: null,
      hora_inicio: "11:00",
      hora_fim: "15:00",
      // RN-01: os campos do modo OPOSTO saem NULL explícito, para o UPDATE
      // que troca de modo apagar a configuração anterior.
      prazo_inicio: null,
      prazo_fim: null,
      prazo_preset: null,
    });
  });

  it("[RN-02] array vazio vira NULL — 'sem restrição' tem UMA representação", () => {
    const r = schemaCardapio.parse({
      nome: "Dia 1 e 15",
      modo: "recorrente",
      dias_semana: [],
      dias_mes: [1, 15],
    });
    expect(r.dias_semana).toBeNull();
    expect(r.dias_mes).toEqual([1, 15]);
  });

  it("[RN-02] recorrente SEM NENHUM EIXO é recusado com a frase literal do design §9.6", () => {
    expect(
      mensagens({ nome: "Sempre", modo: "recorrente" }),
    ).toContain(MSG_SEM_EIXO);
    // E o array vazio não escapa pelo `is not null`, igual ao CHECK.
    expect(
      mensagens({
        nome: "Sempre",
        modo: "recorrente",
        dias_semana: [],
        dias_mes: [],
        hora_inicio: null,
        hora_fim: null,
      }),
    ).toContain(MSG_SEM_EIXO);
  });

  it("só o horário já é eixo suficiente", () => {
    expect(
      mensagens({
        nome: "Almoço",
        modo: "recorrente",
        hora_inicio: "11:00",
        hora_fim: "15:00",
      }),
    ).toEqual([]);
  });

  it("[cardapios_hora_par] horário é par tudo-ou-nada", () => {
    expect(
      mensagens({ nome: "X", modo: "recorrente", hora_inicio: "11:00" }),
    ).toContain(MSG_HORA_PAR);
    expect(
      mensagens({
        nome: "X",
        modo: "recorrente",
        dias_semana: [1],
        hora_fim: "15:00",
      }),
    ).toContain(MSG_HORA_PAR);
  });

  it("[cardapios_hora_ordem] fim <= início é recusado — janela noturna fora do escopo v1", () => {
    expect(
      mensagens({
        nome: "Madrugada",
        modo: "recorrente",
        hora_inicio: "22:00",
        hora_fim: "02:00",
      }),
    ).toContain(MSG_HORA_ORDEM);
    expect(
      mensagens({
        nome: "Igual",
        modo: "recorrente",
        hora_inicio: "11:00",
        hora_fim: "11:00",
      }),
    ).toContain(MSG_HORA_ORDEM);
  });

  it("[domínio] dia da semana fora de 0..6 e dia do mês fora de 1..31 não passam", () => {
    expect(
      mensagens({ nome: "X", modo: "recorrente", dias_semana: [7] }),
    ).not.toEqual([]);
    expect(
      mensagens({ nome: "X", modo: "recorrente", dias_mes: [0] }),
    ).not.toEqual([]);
    expect(
      mensagens({ nome: "X", modo: "recorrente", dias_mes: [32] }),
    ).not.toEqual([]);
    // Dia 31 é configuração VÁLIDA (§9.6): não bloqueia, a prévia avisa.
    expect(mensagens({ nome: "X", modo: "recorrente", dias_mes: [31] })).toEqual([]);
  });

  it("[RN-01] campo do modo OPOSTO no payload é recusado, não ignorado", () => {
    expect(
      mensagens({
        nome: "X",
        modo: "recorrente",
        dias_semana: [0],
        prazo_inicio: "2026-09-21T11:00",
      }),
    ).not.toEqual([]);
  });

  it("propriedade hostil pendurada no payload (loja_id) não sobrevive ao parse", () => {
    expect(
      mensagens({
        nome: "X",
        modo: "recorrente",
        dias_semana: [0],
        loja_id: "22222222-2222-2222-2222-222222222222",
      }),
    ).not.toEqual([]);
  });
});

describe("schemaCardapio — modo prazo fixo (RN-04)", () => {
  it("preset recalculado pelo servidor não exige fim, e o fim enviado é apenas carregado", () => {
    const r = schemaCardapio.parse({
      nome: "Semana da feijoada",
      modo: "prazo_fixo",
      prazo_inicio: "2026-09-21T11:00",
      prazo_preset: "semanal",
    });
    expect(r).toEqual({
      nome: "Semana da feijoada",
      modo: "prazo_fixo",
      dias_semana: null,
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
      // HORA LOCAL: o schema não conhece `lojas.timezone` e não converte.
      prazo_inicio: "2026-09-21T11:00",
      prazo_fim: null,
      prazo_preset: "semanal",
    });
  });

  it("[customizado] exige o fim e o fim tem de ser depois do início", () => {
    expect(
      mensagens({
        nome: "X",
        modo: "prazo_fixo",
        prazo_inicio: "2026-09-21T11:00",
        prazo_preset: "customizado",
      }),
    ).toContain(MSG_PRAZO_FIM_AUSENTE);

    expect(
      mensagens({
        nome: "X",
        modo: "prazo_fixo",
        prazo_inicio: "2026-09-21T11:00",
        prazo_fim: "2026-09-21T11:00",
        prazo_preset: "customizado",
      }),
    ).toContain(MSG_PRAZO_ORDEM);
  });

  it("ISO absoluto com offset é recusado — o campo é hora LOCAL da loja", () => {
    expect(
      mensagens({
        nome: "X",
        modo: "prazo_fixo",
        prazo_inicio: "2026-09-21T14:00:00.000Z",
        prazo_preset: "diario",
      }),
    ).not.toEqual([]);
  });

  it("modo inexistente e nome vazio são recusados", () => {
    expect(mensagens({ nome: "X", modo: "sempre" })).not.toEqual([]);
    expect(
      mensagens({ nome: "   ", modo: "recorrente", dias_semana: [0] }),
    ).not.toEqual([]);
  });
});

describe("ehMensagemDeVigencia — o que a Server Action promove literal", () => {
  it("reconhece as cinco frases de §9.6 e nada além delas", () => {
    for (const m of [
      MSG_SEM_EIXO,
      MSG_HORA_PAR,
      MSG_HORA_ORDEM,
      MSG_PRAZO_FIM_AUSENTE,
      MSG_PRAZO_ORDEM,
    ]) {
      expect(ehMensagemDeVigencia(m)).toBe(true);
    }
    expect(ehMensagemDeVigencia("Invalid input")).toBe(false);
    expect(
      ehMensagemDeVigencia('duplicate key value violates unique constraint'),
    ).toBe(false);
  });
});

// ══════════════════════════ [274] dias por VÍNCULO — RN-10, RN-11, RN-12 ════
//
// Fase RED da issue 274. Nada aqui existe ainda em `./cardapio`:
//  - `schemaDiasDoVinculo` — a FORMA de `{cardapio_id, produto_id, dias_semana}`
//    (D1: `.strict()`, `z.guid()`, inteiros 0..6, teto 7). O schema NÃO
//    deduplica: `[1,1,3]` é "segunda e quarta" dito duas vezes, não payload
//    mal formado.
//  - `normalizarDiasDoVinculo` — a REPRESENTAÇÃO (D2): dedup, ordem, `[]`→`null`.
//    É a `eixoOuNulo` de hoje, promovida a export nomeada. Não é função nova:
//    o último caso deste bloco exige que `schemaCardapio` continue usando A
//    MESMA função (R3 — renomear não pode fazer a vigência do CARDÁPIO derivar
//    da do VÍNCULO).
//
// Import por caminho em VARIÁVEL: os dois símbolos ainda não existem e um
// import estático quebraria `npx tsc --noEmit` e a coleta do arquivo inteiro,
// afogando o RED dos casos acima em erro de resolução.

const MODULO_VALIDACOES_CARDAPIO = "./cardapio";

type ParseCru = { success: boolean; data?: unknown };
type Validacoes274 = {
  schemaDiasDoVinculo: { safeParse(entrada: unknown): ParseCru };
  normalizarDiasDoVinculo(dias: number[] | null | undefined): number[] | null;
};

async function validacoes274(): Promise<Validacoes274> {
  const m = (await import(/* @vite-ignore */ MODULO_VALIDACOES_CARDAPIO)) as unknown as Partial<Validacoes274>;
  const faltando = (["schemaDiasDoVinculo", "normalizarDiasDoVinculo"] as const).filter(
    (nome) => m[nome] == null,
  );
  if (faltando.length > 0) {
    throw new Error(
      `[RED 274] \`src/lib/validacoes/cardapio.ts\` ainda não exporta: ${faltando.join(", ")}. ` +
        `É a fase GREEN da issue 274 (D1 e D2 do plano).`,
    );
  }
  return m as Validacoes274;
}

const CARD_274 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROD_274 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const vinculo = (over: Record<string, unknown> = {}) => ({
  cardapio_id: CARD_274,
  produto_id: PROD_274,
  dias_semana: [3],
  ...over,
});

describe("[274] schemaDiasDoVinculo — a FORMA do payload (RN-10, D1)", () => {
  it("aceita a forma mínima e devolve os três campos", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    const r = schemaDiasDoVinculo.safeParse(vinculo());
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      cardapio_id: CARD_274,
      produto_id: PROD_274,
      dias_semana: [3],
    });
  });

  it("D1: `[1,1,3]` é ACEITO — repetição é redundância inofensiva, não payload hostil", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    const r = schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: [1, 1, 3] }));
    expect(r.success, "o schema não pode recusar dia repetido; quem deduplica é a normalização").toBe(
      true,
    );
    // E o schema NÃO normaliza: a representação é decidida depois, no servidor.
    expect((r.data as { dias_semana: number[] }).dias_semana).toEqual([1, 1, 3]);
  });

  it("`dias_semana: []` é ACEITO (vira NULL na normalização, não na forma)", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    expect(schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: [] })).success).toBe(true);
  });

  it("RN-10: `loja_id` pendurado no payload é RECUSADO pelo `.strict()`", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    const r = schemaDiasDoVinculo.safeParse(
      vinculo({ loja_id: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(r.success, "`.strict()` é a barreira de RN-10: loja_id nunca vem do cliente").toBe(false);
  });

  it("qualquer outra chave a mais também é recusada (`.strict()` não é sobre `loja_id` só)", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    expect(schemaDiasDoVinculo.safeParse(vinculo({ ativo: true })).success).toBe(false);
  });

  it("os dois ids são `z.guid()`: lixo não vira ida ao banco", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    for (const over of [
      { cardapio_id: "nao-e-uuid" },
      { produto_id: "nao-e-uuid" },
      { cardapio_id: 123 },
      { produto_id: null },
    ]) {
      expect(
        schemaDiasDoVinculo.safeParse(vinculo(over)).success,
        `${JSON.stringify(over)} deveria ser recusado`,
      ).toBe(false);
    }
  });

  it("`dias_semana` é lista de INTEIROS 0..6 — 7, -1, 1.5 e string são recusados", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    for (const dias of [[7], [-1], [1.5], ["1"], [0, 7], null, "1"]) {
      expect(
        schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: dias })).success,
        `${JSON.stringify(dias)} deveria ser recusado`,
      ).toBe(false);
    }
  });

  it("0 e 6 são as BORDAS ACEITAS (domingo e sábado), e os sete dias cabem", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    expect(schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: [0, 6] })).success).toBe(true);
    expect(
      schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: [0, 1, 2, 3, 4, 5, 6] })).success,
    ).toBe(true);
  });

  it("CWE-770: 8 elementos são recusados MESMO normalizando para um só (teto do fio)", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    expect(
      schemaDiasDoVinculo.safeParse(vinculo({ dias_semana: [1, 1, 1, 1, 1, 1, 1, 1] })).success,
      "`.max(7)` é teto de cardinalidade do payload, avaliado ANTES da dedup",
    ).toBe(false);
  });

  it("`dias_semana` ausente é recusado — a action escreve a coluna, não a omite", async () => {
    const { schemaDiasDoVinculo } = await validacoes274();
    expect(
      schemaDiasDoVinculo.safeParse({ cardapio_id: CARD_274, produto_id: PROD_274 }).success,
    ).toBe(false);
  });
});

describe("[274] normalizarDiasDoVinculo — a REPRESENTAÇÃO (RN-11, D2)", () => {
  it("deduplica: `[1,1,3]` → `[1,3]`", async () => {
    const { normalizarDiasDoVinculo } = await validacoes274();
    expect(normalizarDiasDoVinculo([1, 1, 3])).toEqual([1, 3]);
  });

  it("ordena numericamente: `[6,0]` → `[0,6]` e `[3,1]` → `[1,3]`", async () => {
    const { normalizarDiasDoVinculo } = await validacoes274();
    expect(normalizarDiasDoVinculo([6, 0])).toEqual([0, 6]);
    expect(normalizarDiasDoVinculo([3, 1])).toEqual([1, 3]);
    // Ordem LEXICOGRÁFICA daria [0, 10, 6]; o comparador numérico é exigido.
    expect(normalizarDiasDoVinculo([6, 0, 1])).toEqual([0, 1, 6]);
  });

  it("`[]`, `null` e `undefined` têm UMA representação: `null` (nunca `[]`)", async () => {
    const { normalizarDiasDoVinculo } = await validacoes274();
    expect(normalizarDiasDoVinculo([])).toBeNull();
    expect(normalizarDiasDoVinculo(null)).toBeNull();
    expect(normalizarDiasDoVinculo(undefined)).toBeNull();
  });

  it("não muta o array recebido (o parse devolve objeto novo; a normalização não desfaz isso)", async () => {
    const { normalizarDiasDoVinculo } = await validacoes274();
    const entrada = [3, 1, 1];
    expect(normalizarDiasDoVinculo(entrada)).toEqual([1, 3]);
    expect(entrada).toEqual([3, 1, 1]);
  });

  it("R3: `schemaCardapio` continua usando A MESMA função para o eixo do CARDÁPIO", async () => {
    const { normalizarDiasDoVinculo } = await validacoes274();
    const r = schemaCardapio.parse({
      nome: "Fim de semana",
      modo: "recorrente",
      dias_semana: [6, 0, 6],
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
    }) as { dias_semana: number[] | null };
    expect(r.dias_semana).toEqual(normalizarDiasDoVinculo([6, 0, 6]));
  });
});

// ═══════════ [287] dias da semana no LOTE de produtos do cardápio ═══════════
//
// Fase RED da issue 287. Nada aqui existe ainda em `./cardapio`:
//  - `schemaLoteDeProdutosComDias` — o schema DERIVADO de `schemaLoteDeProdutos`
//    com `dias_semana` OPCIONAL, mesmo domínio de `schemaDiasDoVinculo`
//    (inteiros 0..6, teto 7) e `.strict()` preservado.
//
// Por que DERIVADO e não o campo somado ao `schemaLoteDeProdutos` (desvio
// deliberado da letra da issue, mesmo efeito — plano §"Validação (zod)"):
// `schemaLoteDeProdutos` também é o schema de `tirarDeCardapio` /
// `tirarDeCardapioAdmin`. Somar o campo lá faria o DELETE ACEITAR e IGNORAR em
// silêncio um `dias_semana` que ele não usa. Com o derivado, cada caminho de
// escrita recusa exatamente o que não sabe usar — e é isso que o último caso
// deste bloco trava: o schema ORIGINAL continua recusando `dias_semana`.
//
// Import por caminho em VARIÁVEL: o símbolo ainda não existe e um import
// estático quebraria `npx tsc --noEmit` e a coleta do arquivo inteiro.

type Validacoes287 = {
  schemaLoteDeProdutosComDias: { safeParse(entrada: unknown): ParseCru };
};

async function validacoes287(): Promise<Validacoes287> {
  const m = (await import(/* @vite-ignore */ MODULO_VALIDACOES_CARDAPIO)) as unknown as Partial<Validacoes287>;
  if (m.schemaLoteDeProdutosComDias == null) {
    throw new Error(
      "[RED 287] `src/lib/validacoes/cardapio.ts` ainda não exporta `schemaLoteDeProdutosComDias`. " +
        "É a fase GREEN da issue 287: `schemaLoteDeProdutos.extend({ dias_semana: … }).strict()`, " +
        "NUNCA o campo somado ao `schemaLoteDeProdutos` (que também serve `tirarDeCardapio`).",
    );
  }
  return m as Validacoes287;
}

const CARD_287 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P1_287 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2_287 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";

const lote287 = (over: Record<string, unknown> = {}) => ({
  cardapio_id: CARD_287,
  produto_ids: [P1_287, P2_287],
  ...over,
});

describe("[287] schemaLoteDeProdutosComDias — a FORMA do lote COM agenda", () => {
  it("aceita `dias_semana` nas bordas do domínio (0 = domingo, 6 = sábado)", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    const r = schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: [0, 6] }));
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      cardapio_id: CARD_287,
      produto_ids: [P1_287, P2_287],
      dias_semana: [0, 6],
    });
  });

  it("os sete dias cabem, e `[]` é aceito (vira NULL na normalização, não na forma)", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    expect(
      schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: [0, 1, 2, 3, 4, 5, 6] }))
        .success,
    ).toBe(true);
    expect(schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: [] })).success).toBe(
      true,
    );
  });

  it("o campo é OPCIONAL: o payload de HOJE (sem `dias_semana`) continua passando intacto", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    const r = schemaLoteDeProdutosComDias.safeParse(lote287());
    expect(r.success).toBe(true);
    // Sem `dias_semana`, o parse devolve exatamente as duas chaves de hoje —
    // o schema NÃO inventa `dias_semana: null` (quem decide a representação é
    // `normalizarDiasDoVinculo`, no servidor).
    expect(r.data).toEqual({ cardapio_id: CARD_287, produto_ids: [P1_287, P2_287] });
  });

  it("`null` explícito também é aceito (nullish) — é 'todos os dias do cardápio'", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    expect(schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: null })).success).toBe(
      true,
    );
  });

  it("o schema NÃO normaliza: `[3,1,3]` passa como veio — quem deduplica é o servidor", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    const r = schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: [3, 1, 3] }));
    expect(r.success, "repetição é redundância inofensiva, não payload hostil").toBe(true);
    expect((r.data as { dias_semana: number[] }).dias_semana).toEqual([3, 1, 3]);
  });

  it("[domínio] 7, -1, 1.5, string e não-array são recusados", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    for (const dias of [[7], [-1], [1.5], ["3"], [0, 7], "3", 3, {}]) {
      expect(
        schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: dias })).success,
        `${JSON.stringify(dias)} deveria ser recusado`,
      ).toBe(false);
    }
  });

  it("[CWE-770] 8 elementos são recusados MESMO normalizando para um só", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    expect(
      schemaLoteDeProdutosComDias.safeParse(
        lote287({ dias_semana: [1, 1, 1, 1, 1, 1, 1, 1] }),
      ).success,
      "`.max(7)` é teto do PAYLOAD, avaliado ANTES da dedup",
    ).toBe(false);
  });

  it("`.strict()` sobrevive ao `.extend()`: chave desconhecida junto com `dias_semana` é recusada", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    expect(
      schemaLoteDeProdutosComDias.safeParse(
        lote287({ dias_semana: [1], loja_id: "99999999-9999-4999-8999-999999999999" }),
      ).success,
      "`loja_id` é SEMPRE derivado no servidor; `.extend()` não pode afrouxar isso",
    ).toBe(false);
    expect(
      schemaLoteDeProdutosComDias.safeParse(lote287({ dias_semana: [1], ativo: true })).success,
    ).toBe(false);
  });

  it("o resto do contrato de `schemaLoteDeProdutos` é herdado: ids, teto e sem duplicata", async () => {
    const { schemaLoteDeProdutosComDias } = await validacoes287();
    for (const over of [
      { cardapio_id: "nao-e-uuid" },
      { produto_ids: ["nao-e-uuid"] },
      { produto_ids: [] },
      { produto_ids: [P1_287, P1_287] },
    ]) {
      expect(
        schemaLoteDeProdutosComDias.safeParse(lote287({ ...over, dias_semana: [1] })).success,
        `${JSON.stringify(over)} deveria ser recusado`,
      ).toBe(false);
    }
  });

  it("o schema ORIGINAL continua RECUSANDO `dias_semana` — é o que trava o DELETE", async () => {
    // `schemaLoteDeProdutos` serve `tirarDeCardapio`/`tirarDeCardapioAdmin`.
    // Se a fase GREEN somar o campo nele em vez de derivar, o DELETE passa a
    // aceitar e ignorar em silêncio uma agenda que ele não usa. Este é o caso
    // que reprova a implementação "mais fácil".
    expect(
      schemaLoteDeProdutos.safeParse(lote287({ dias_semana: [1] })).success,
      "`dias_semana` tem de continuar sendo chave desconhecida para o schema do DELETE",
    ).toBe(false);
    // E o original continua aceitando o payload de hoje.
    expect(schemaLoteDeProdutos.safeParse(lote287()).success).toBe(true);
  });
});
