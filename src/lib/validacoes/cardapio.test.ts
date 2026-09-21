import { describe, it, expect } from "vitest";
import {
  schemaCardapio,
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
