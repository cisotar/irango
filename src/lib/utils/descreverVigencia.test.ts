import { describe, it, expect } from "vitest";

import {
  descreverVigencia,
  escolherCardapioParaRotulo,
  proximaAbertura,
  rotuloJanelaDestaque,
  rotuloVoltaQuando,
  ROTULO_SEM_VOLTA,
} from "./descreverVigencia";
import { instanteNoFuso, horaLocalNoFuso } from "./fusoLoja";
import { cardapioAberto, type CardapioVigencia } from "./vigenciaCardapio";

/**
 * [254] `descreverVigencia` — as DUAS tabelas de redação do design §9.5/§4.3,
 * linha por linha, mais `proximaAbertura` (RN-07) e a escada determinística.
 *
 * `agora` SEMPRE injetado: nenhuma leitura de relógio, determinismo total.
 */

const SP = "America/Sao_Paulo";
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));
const localSP = (d: Date) => horaLocalNoFuso(d.toISOString(), SP);

function recorrente(over: Partial<CardapioVigencia> = {}): CardapioVigencia {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    nome: "Fim de semana",
    ativo: true,
    modo: "recorrente",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ...over,
  };
}

function prazoFixo(over: Partial<CardapioVigencia> = {}): CardapioVigencia {
  return {
    ...recorrente(),
    id: "c0000000-0000-4000-8000-000000000002",
    nome: "Cardápio de Inverno",
    modo: "prazo_fixo",
    prazo_inicio: instanteNoFuso("2026-09-22T11:00", SP),
    prazo_fim: instanteNoFuso("2026-09-29T11:00", SP),
    ...over,
  };
}

const SAB_DOM = { dias_semana: [6, 0], dias_mes: null };
const SEG_A_SEX = { dias_semana: [1, 2, 3, 4, 5], dias_mes: null };
const DIAS_1_E_15 = { dias_semana: null, dias_mes: [1, 15] };
const DAS_11_AS_15 = { hora_inicio: "11:00", hora_fim: "15:00" };

describe("254 — descreverVigencia: a tabela do painel (design §9.5), literal", () => {
  it("sáb+dom", () => {
    expect(descreverVigencia(recorrente(SAB_DOM), SP)).toBe(
      "Aparece todo sábado e domingo.",
    );
  });

  it("sáb+dom, 11–15", () => {
    expect(descreverVigencia(recorrente({ ...SAB_DOM, ...DAS_11_AS_15 }), SP)).toBe(
      "Aparece todo sábado e domingo, das 11:00 às 15:00.",
    );
  });

  it("seg a sex, 11–15", () => {
    expect(descreverVigencia(recorrente({ ...SEG_A_SEX, ...DAS_11_AS_15 }), SP)).toBe(
      "Aparece de segunda a sexta, das 11:00 às 15:00.",
    );
  });

  it("dias 1 e 15", () => {
    expect(descreverVigencia(recorrente(DIAS_1_E_15), SP)).toBe(
      "Aparece todo dia 1 e dia 15 do mês.",
    );
  });

  it("sáb+dom E dias 1 e 15 — a conjunção 'e também' é obrigatória (RN-02 é OU)", () => {
    const frase = descreverVigencia(
      recorrente({ dias_semana: [6, 0], dias_mes: [1, 15] }),
      SP,
    );
    expect(frase).toBe("Aparece todo sábado e domingo, e também todo dia 1 e dia 15.");
    expect(frase).toContain("e também");
  });

  it("dia 31 — com a nota dos meses de 30 dias", () => {
    expect(descreverVigencia(recorrente({ dias_mes: [31] }), SP)).toBe(
      "Aparece todo dia 31 — nos meses de 30 dias, não aparece.",
    );
  });

  it("só horário", () => {
    expect(descreverVigencia(recorrente(DAS_11_AS_15), SP)).toBe(
      "Aparece todo dia, das 11:00 às 15:00.",
    );
  });

  it("prazo fixo futuro", () => {
    expect(descreverVigencia(prazoFixo(), SP, emSP("2026-09-20T12:00"))).toBe(
      "Aparece de 22/09, 11:00 até 29/09, 11:00.",
    );
  });

  it("prazo fixo em curso", () => {
    const c = prazoFixo({ prazo_inicio: instanteNoFuso("2026-09-18T11:00", SP) });
    expect(descreverVigencia(c, SP, emSP("2026-09-20T12:00"))).toBe(
      "Está aparecendo desde 18/09 e some em 29/09, às 11:00.",
    );
  });

  it("prazo fixo encerrado", () => {
    expect(descreverVigencia(prazoFixo(), SP, emSP("2026-10-05T12:00"))).toBe(
      "Terminou em 29/09. Este cardápio não aparece mais.",
    );
  });

  it("sem `agora` (prévia do form não-salvo) o prazo fixo não afirma nada sobre hoje", () => {
    expect(descreverVigencia(prazoFixo(), SP)).toBe(
      "Aparece de 22/09, 11:00 até 29/09, 11:00.",
    );
  });

  it("`dias_semana` fora de ordem produz a MESMA frase (a ordem é da redação)", () => {
    expect(descreverVigencia(recorrente({ dias_semana: [0, 6] }), SP)).toBe(
      descreverVigencia(recorrente({ dias_semana: [6, 0] }), SP),
    );
  });

  it("o horário SÓ com um dos extremos não vira meia frase", () => {
    expect(descreverVigencia(recorrente({ ...SAB_DOM, hora_inicio: "11:00" }), SP)).toBe(
      "Aparece todo sábado e domingo.",
    );
  });
});

describe("254 — rotuloVoltaQuando: a tabela da vitrine (design §4.3), literal", () => {
  const casos: [string, CardapioVigencia, string][] = [
    ["dias da semana", recorrente(SAB_DOM), "Só aos sábados e domingos"],
    [
      "dias da semana + horário",
      recorrente({ ...SAB_DOM, ...DAS_11_AS_15 }),
      "Sáb e dom, 11:00–15:00",
    ],
    [
      "corrida de dias + horário",
      recorrente({ ...SEG_A_SEX, ...DAS_11_AS_15 }),
      "Seg a sex, 11:00–15:00",
    ],
    ["dias do mês", recorrente(DIAS_1_E_15), "Só nos dias 1 e 15"],
    [
      "semana + mês (os dois eixos SOMAM)",
      recorrente({ dias_semana: [6, 0], dias_mes: [1, 15] }),
      "Sáb, dom, dia 1 e dia 15",
    ],
    ["dia 31", recorrente({ dias_mes: [31] }), "Só no dia 31"],
    ["só horário", recorrente(DAS_11_AS_15), "Só das 11:00 às 15:00"],
    ["prazo fixo ainda não começado", prazoFixo(), "A partir de 22/09"],
  ];

  for (const [nome, cardapio, esperado] of casos) {
    it(`${nome} ⇒ "${esperado}"`, () => {
      expect(rotuloVoltaQuando(cardapio, SP)).toBe(esperado);
    });
  }

  it("NUNCA passa de 32 caracteres — nem na configuração mais longa possível", () => {
    const longos = [
      recorrente({ dias_semana: [0, 1, 3], dias_mes: [1, 15, 28], ...DAS_11_AS_15 }),
      recorrente({ dias_semana: [0, 2, 4, 6], ...DAS_11_AS_15 }),
      recorrente({ dias_semana: [0, 2, 5] }),
      recorrente({ dias_mes: [1, 7, 13, 19, 25, 31], ...DAS_11_AS_15 }),
    ];
    for (const c of longos) {
      const rotulo = rotuloVoltaQuando(c, SP);
      expect(rotulo.length).toBeLessThanOrEqual(32);
      expect(rotulo.length).toBeGreaterThan(0);
    }
    // O corte é da função pura, com reticências visíveis — não do CSS.
    expect(rotuloVoltaQuando(longos[0], SP).endsWith("…")).toBe(true);
  });
});

describe("254 — rotuloJanelaDestaque: o cabeçalho da seção (design §13.1), ≤20", () => {
  it("prazo fixo em curso ⇒ 'Até <dia da semana>'", () => {
    const c = prazoFixo({
      prazo_inicio: instanteNoFuso("2026-09-18T11:00", SP),
      prazo_fim: instanteNoFuso("2026-09-27T23:59", SP), // domingo
    });
    expect(rotuloJanelaDestaque(c, emSP("2026-09-25T12:00"), SP)).toBe("Até domingo");
  });

  it("prazo fixo que termina além da semana ⇒ a data, que não é ambígua", () => {
    const c = prazoFixo({
      prazo_inicio: instanteNoFuso("2026-09-18T11:00", SP),
      prazo_fim: instanteNoFuso("2026-10-31T23:59", SP),
    });
    expect(rotuloJanelaDestaque(c, emSP("2026-09-25T12:00"), SP)).toBe("Até 31/10");
  });

  it("recorrente com horário ⇒ 'Hoje, até as 15:00'; sem horário ⇒ 'Hoje'", () => {
    const agora = emSP("2026-10-17T12:00");
    expect(rotuloJanelaDestaque(recorrente({ ...SAB_DOM, ...DAS_11_AS_15 }), agora, SP)).toBe(
      "Hoje, até as 15:00",
    );
    expect(rotuloJanelaDestaque(recorrente(SAB_DOM), agora, SP)).toBe("Hoje");
  });

  it("nunca passa de 20 caracteres", () => {
    const agora = emSP("2026-10-17T12:00");
    const todos = [
      recorrente({ ...SAB_DOM, ...DAS_11_AS_15 }),
      recorrente(SAB_DOM),
      prazoFixo(),
      prazoFixo({ prazo_fim: instanteNoFuso("2026-09-27T23:59", SP) }),
    ];
    for (const c of todos) {
      expect(rotuloJanelaDestaque(c, agora, SP).length).toBeLessThanOrEqual(20);
    }
  });
});

describe("254 — proximaAbertura (RN-07): o número de 'quando volta'", () => {
  it("recorrente fechado: terça 12:00 ⇒ o sábado seguinte, no hora_inicio", () => {
    const c = recorrente({ ...SAB_DOM, ...DAS_11_AS_15 });
    const volta = proximaAbertura(c, emSP("2026-10-13T12:00"), SP);
    expect(volta).not.toBeNull();
    expect(localSP(volta as Date)).toBe("2026-10-17T11:00");
    // E é MESMO uma abertura: a regra de 246 concorda com a varredura.
    expect(cardapioAberto(c, volta as Date, SP)).toBe(true);
  });

  it("recorrente aberto AGORA ⇒ a abertura é este instante", () => {
    const c = recorrente({ ...SAB_DOM, ...DAS_11_AS_15 });
    const agora = emSP("2026-10-17T12:00");
    expect(proximaAbertura(c, agora, SP)?.getTime()).toBe(agora.getTime());
  });

  it("mesmo dia, antes do hora_inicio ⇒ hoje às 11:00 (não a semana que vem)", () => {
    const c = recorrente({ ...SAB_DOM, ...DAS_11_AS_15 });
    const volta = proximaAbertura(c, emSP("2026-10-17T09:00"), SP);
    expect(localSP(volta as Date)).toBe("2026-10-17T11:00");
  });

  it("dias_mes = [31] a partir de 01/02 ⇒ uma data que EXISTE (nunca 31/02)", () => {
    const c = recorrente({ dias_mes: [31], ...DAS_11_AS_15 });
    const volta = proximaAbertura(c, emSP("2026-02-01T12:00"), SP);
    expect(localSP(volta as Date)).toBe("2026-03-31T11:00");
  });

  it("prazo fixo ainda não começado ⇒ o próprio início", () => {
    const c = prazoFixo();
    expect(proximaAbertura(c, emSP("2026-09-20T12:00"), SP)?.toISOString()).toBe(
      new Date(c.prazo_inicio as string).toISOString(),
    );
  });

  it("prazo fixo EXPIRADO ⇒ null", () => {
    expect(proximaAbertura(prazoFixo(), emSP("2026-10-05T12:00"), SP)).toBeNull();
  });

  it("cardápio inativo ⇒ null (RN-03: desligado não é abertura futura)", () => {
    const c = recorrente({ ...SAB_DOM, ...DAS_11_AS_15, ativo: false });
    expect(proximaAbertura(c, emSP("2026-10-13T12:00"), SP)).toBeNull();
  });

  it("faixa de horário degenerada não abre nunca ⇒ null em 400 dias", () => {
    const c = recorrente({ ...SAB_DOM, hora_inicio: "22:00", hora_fim: "02:00" });
    expect(proximaAbertura(c, emSP("2026-10-13T12:00"), SP)).toBeNull();
  });

  it("recorrente sem eixo de dia, só horário ⇒ hoje mesmo", () => {
    const c = recorrente(DAS_11_AS_15);
    const volta = proximaAbertura(c, emSP("2026-10-13T16:00"), SP);
    expect(localSP(volta as Date)).toBe("2026-10-14T11:00");
  });
});

describe("254 — a escada determinística de RN-07 (a mesma de RN-15)", () => {
  const terca = emSP("2026-10-13T12:00");
  const proxima = (c: CardapioVigencia) => proximaAbertura(c, terca, SP);

  it("vence quem abre MAIS CEDO", () => {
    const sabado = recorrente({ id: "a", nome: "Fim de semana", ...SAB_DOM, ...DAS_11_AS_15 });
    const quarta = recorrente({
      id: "b",
      nome: "Quarta feirinha",
      dias_semana: [3],
      dias_mes: null,
      ...DAS_11_AS_15,
    });
    expect(escolherCardapioParaRotulo([sabado, quarta], proxima)?.id).toBe("b");
    // A ordem da entrada não muda o resultado.
    expect(escolherCardapioParaRotulo([quarta, sabado], proxima)?.id).toBe("b");
  });

  it("`null` vai por último — o expirado nunca rouba a frase de quem volta", () => {
    const expirado = prazoFixo({ id: "a", nome: "Aaa" });
    const volta = recorrente({ id: "z", nome: "Zzz", ...SAB_DOM, ...DAS_11_AS_15 });
    const agora = emSP("2026-10-13T12:00");
    const proximaAgora = (c: CardapioVigencia) => proximaAbertura(c, agora, SP);
    expect(escolherCardapioParaRotulo([expirado, volta], proximaAgora)?.id).toBe("z");
  });

  it("empate no instante ⇒ desempate por nome (pt-BR) e depois por id", () => {
    const base = { ...SAB_DOM, ...DAS_11_AS_15 };
    const acai = recorrente({ id: "id-2", nome: "Açaí", ...base });
    const azul = recorrente({ id: "id-1", nome: "Azul", ...base });
    // "Açaí" < "Azul" em pt-BR (ç colado no c), o que `localeCompare` sabe.
    expect(escolherCardapioParaRotulo([azul, acai], proxima)?.id).toBe("id-2");

    const mesmoNomeA = recorrente({ id: "id-a", nome: "Igual", ...base });
    const mesmoNomeB = recorrente({ id: "id-b", nome: "Igual", ...base });
    expect(escolherCardapioParaRotulo([mesmoNomeB, mesmoNomeA], proxima)?.id).toBe("id-a");
  });

  it("todos sem volta ⇒ null: não há frase verdadeira a escolher (RN-07)", () => {
    const expirado = prazoFixo({ id: "a" });
    const outroExpirado = prazoFixo({
      id: "b",
      prazo_inicio: instanteNoFuso("2026-01-01T00:00", SP),
      prazo_fim: instanteNoFuso("2026-02-01T00:00", SP),
    });
    expect(escolherCardapioParaRotulo([expirado, outroExpirado], proxima)).toBeNull();
  });

  it("cardápio INATIVO não participa da escolha (RN-03)", () => {
    const desligado = recorrente({ id: "off", ativo: false, ...SAB_DOM, ...DAS_11_AS_15 });
    expect(escolherCardapioParaRotulo([desligado], proxima)).toBeNull();
  });

  it("lista vazia ⇒ null, e o caller cai no fallback defensivo", () => {
    expect(escolherCardapioParaRotulo([], proxima)).toBeNull();
    expect(ROTULO_SEM_VOLTA).toBe("Indisponível no momento");
  });
});
