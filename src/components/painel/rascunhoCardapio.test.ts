/**
 * [257][258] O rascunho do form de vigência — o módulo puro por trás dos dois
 * modos. `environment: node`, sem jsdom.
 *
 * O que estes testes travam é justamente o que a tela não consegue provar
 * sozinha: que a validação é a MESMA do servidor, que trocar de modo não
 * apaga o digitado, e que o "Termina em" de `31/01 + 1 mês` é `28/02`.
 */

import { describe, it, expect } from "vitest";

import {
  DIAS_DA_SEMANA,
  fimDoPresetExibido,
  fraseDoRascunho,
  payloadDoRascunho,
  rascunhoInicial,
  todosOsDias,
  validarRascunho,
  vigenciaDoRascunho,
  type RascunhoCardapio,
} from "./rascunhoCardapio";
import {
  MSG_SEM_EIXO,
  MSG_HORA_ORDEM,
  MSG_PRAZO_ORDEM,
} from "@/lib/validacoes/cardapio";

const SP = "America/Sao_Paulo";
const MANAUS = "America/Manaus";

function base(over: Partial<RascunhoCardapio> = {}): RascunhoCardapio {
  return {
    ...rascunhoInicial(null, SP, "2026-09-19T13:04"),
    nome: "Feijoada de sábado",
    ...over,
  };
}

describe("payloadDoRascunho", () => {
  it("manda só o modo selecionado — o outro fica no rascunho, não no payload", () => {
    const rascunho = base({
      modo: "recorrente",
      dias_semana: [6],
      fim_data: "2026-12-31",
    });
    expect(payloadDoRascunho(rascunho)).toEqual({
      nome: "Feijoada de sábado",
      modo: "recorrente",
      dias_semana: [6],
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
    });
  });

  it("eixo vazio vira NULL, nunca '[]' — 'sem restrição' tem uma representação só", () => {
    const payload = payloadDoRascunho(base({ dias_semana: [], dias_mes: [1] }));
    expect(payload).toMatchObject({ dias_semana: null, dias_mes: [1] });
  });

  it("sob preset o `prazo_fim` sai NULL: quem calcula o fim é o servidor (RN-04)", () => {
    const payload = payloadDoRascunho(
      base({ modo: "prazo_fixo", prazo_preset: "mensal" }),
    );
    expect(payload).toMatchObject({
      modo: "prazo_fixo",
      prazo_preset: "mensal",
      prazo_fim: null,
    });
  });

  it("só `customizado` manda o fim digitado", () => {
    const payload = payloadDoRascunho(
      base({
        modo: "prazo_fixo",
        prazo_preset: "customizado",
        fim_data: "2026-12-31",
        fim_hora: "23:59",
      }),
    );
    expect(payload).toMatchObject({ prazo_fim: "2026-12-31T23:59" });
  });
});

describe("validarRascunho — o MESMO zod da Server Action", () => {
  it("os três eixos vazios são bloqueados com a frase literal de §9.6", () => {
    const r = validarRascunho(base({ dias_semana: [], dias_mes: [], comHorario: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.dias_semana).toBe(MSG_SEM_EIXO);
  });

  it("um único eixo já basta — os três são opcionais entre si", () => {
    expect(validarRascunho(base({ dias_mes: [1, 15] })).ok).toBe(true);
    expect(validarRascunho(base({ dias_semana: [0, 6] })).ok).toBe(true);
    expect(validarRascunho(base({ comHorario: true })).ok).toBe(true);
  });

  it("janela que cruza a meia-noite é recusada com a frase literal", () => {
    const r = validarRascunho(
      base({ comHorario: true, hora_inicio: "22:00", hora_fim: "02:00" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.hora_fim).toBe(MSG_HORA_ORDEM);
  });

  it("prazo customizado com fim antes do início é recusado", () => {
    const r = validarRascunho(
      base({
        modo: "prazo_fixo",
        prazo_preset: "customizado",
        inicio_data: "2026-09-19",
        inicio_hora: "11:00",
        fim_data: "2026-09-18",
        fim_hora: "11:00",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.prazo_fim).toBe(MSG_PRAZO_ORDEM);
  });

  it("nome vazio é recusado", () => {
    const r = validarRascunho(base({ nome: "  ", dias_semana: [6] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.nome).toBeDefined();
  });
});

describe("fimDoPresetExibido — a MESMA `calcularFimDoPreset` do servidor", () => {
  it("31/01 + 1 mês é 28/02, nunca 03/03", () => {
    const exibido = fimDoPresetExibido(
      base({
        modo: "prazo_fixo",
        prazo_preset: "mensal",
        inicio_data: "2026-01-31",
        inicio_hora: "11:00",
      }),
      SP,
    );
    expect(exibido).toBe("28/02/2026, 11:00");
  });

  it("7 dias é 7 dias", () => {
    const exibido = fimDoPresetExibido(
      base({
        modo: "prazo_fixo",
        prazo_preset: "semanal",
        inicio_data: "2026-09-19",
        inicio_hora: "11:00",
      }),
      SP,
    );
    expect(exibido).toBe("26/09/2026, 11:00");
  });

  it("`customizado` não tem leitura — ali o fim é CAMPO", () => {
    expect(
      fimDoPresetExibido(
        base({ modo: "prazo_fixo", prazo_preset: "customizado" }),
        SP,
      ),
    ).toBeNull();
  });
});

describe("a frase da prévia sai de `descreverVigencia`, não do componente", () => {
  it("os dois eixos de dia coexistindo trazem o 'e também' pronto do módulo", () => {
    expect(fraseDoRascunho(base({ dias_semana: [0, 6], dias_mes: [1, 15] }), SP)).toBe(
      "Aparece todo sábado e domingo, e também todo dia 1 e dia 15.",
    );
  });

  it("dia 31 marcado traz a nota dos meses de 30 dias", () => {
    expect(fraseDoRascunho(base({ dias_mes: [31] }), SP)).toBe(
      "Aparece todo dia 31 — nos meses de 30 dias, não aparece.",
    );
  });

  it("'31/12 23:59' significa instantes diferentes em São Paulo e em Manaus", () => {
    const r = base({
      modo: "prazo_fixo",
      prazo_preset: "customizado",
      inicio_data: "2026-12-31",
      inicio_hora: "23:59",
      fim_data: "2027-01-01",
      fim_hora: "23:59",
    });
    // É por isso que o fuso da loja é NOMEADO na prévia (design §9.4 item 4).
    expect(vigenciaDoRascunho(r, SP).prazo_inicio).not.toBe(
      vigenciaDoRascunho(r, MANAUS).prazo_inicio,
    );
  });
});

describe("rascunhoInicial", () => {
  it("reabre o cardápio salvo com os eixos que ele tem", () => {
    const r = rascunhoInicial(
      {
        id: "c1",
        nome: "Feijoada",
        ativo: true,
        modo: "recorrente",
        dias_semana: [6],
        dias_mes: null,
        hora_inicio: "11:00:00",
        hora_fim: "15:00:00",
        prazo_inicio: null,
        prazo_fim: null,
      },
      SP,
      "2026-09-19T13:04",
    );
    expect(r).toMatchObject({
      nome: "Feijoada",
      modo: "recorrente",
      dias_semana: [6],
      dias_mes: [],
      comHorario: true,
      hora_inicio: "11:00",
      hora_fim: "15:00",
    });
  });

  it("cardápio novo nasce sem nenhum dia marcado — e o zod barra o salvar", () => {
    const r = rascunhoInicial(null, SP, "2026-09-19T13:04");
    expect(r.dias_semana).toEqual([]);
    expect(r.comHorario).toBe(false);
    expect(validarRascunho({ ...r, nome: "Teste" }).ok).toBe(false);
  });
});

/**
 * [275] O atalho "Todos os dias" é um clique na tela, mas a promessa — os 7
 * valores no payload e a prévia lendo "todos os dias" — é pura, e é aqui que
 * ela fica travada sem jsdom.
 */
describe("todosOsDias — o atalho de [275]", () => {
  it("devolve os sete dias, derivados da tabela (nunca um literal à mão)", () => {
    expect(todosOsDias()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(todosOsDias()).toEqual(DIAS_DA_SEMANA.map((d) => d.valor));
  });

  it("no payload, satisfaz o CHECK cardapios_recorrente_tem_eixo", () => {
    const validado = validarRascunho(base({ dias_semana: todosOsDias() }));
    expect(validado.ok).toBe(true);
    if (validado.ok) {
      expect(validado.payload).toMatchObject({ dias_semana: [0, 1, 2, 3, 4, 5, 6] });
    }
  });

  it("a prévia com os 7 marcados lê 'Aparece todos os dias.' (RN-07)", () => {
    expect(fraseDoRascunho(base({ dias_semana: todosOsDias() }), SP)).toBe(
      "Aparece todos os dias.",
    );
  });
});
