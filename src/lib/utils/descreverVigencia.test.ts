import { describe, it, expect } from "vitest";

import {
  avisoAgendaQueNuncaAbre,
  descreverVigencia,
  escolherVinculoParaRotulo,
  proximaAbertura,
  rotuloJanelaDestaque,
  rotuloLongoDoDia,
  rotuloDiasDoItem,
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

/**
 * [273] O vínculo SEM dias do item — a forma de 100% das linhas no deploy da
 * 272. Com `dias_semana` vazio a frase é a do CARDÁPIO em qualquer instante,
 * então a tabela de 254 continua afirmável byte a byte.
 */
const semDias = (cardapio: CardapioVigencia) => ({ cardapio, dias_semana: null });
/** Terça 13/10/2026, 12:00 — fora da janela de todos os cardápios da tabela. */
const AGORA_254 = new Date(instanteNoFuso("2026-10-13T12:00", SP));

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
      expect(rotuloVoltaQuando(semDias(cardapio), AGORA_254, SP)).toBe(esperado);
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
      const rotulo = rotuloVoltaQuando(semDias(c), AGORA_254, SP);
      expect(rotulo.length).toBeLessThanOrEqual(32);
      expect(rotulo.length).toBeGreaterThan(0);
    }
    // O corte é da função pura, com reticências visíveis — não do CSS.
    expect(rotuloVoltaQuando(semDias(longos[0]), AGORA_254, SP).endsWith("…")).toBe(true);
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
    expect(escolherVinculoParaRotulo([semDias(sabado), semDias(quarta)], proxima)?.cardapio.id).toBe("b");
    // A ordem da entrada não muda o resultado.
    expect(escolherVinculoParaRotulo([semDias(quarta), semDias(sabado)], proxima)?.cardapio.id).toBe("b");
  });

  it("`null` vai por último — o expirado nunca rouba a frase de quem volta", () => {
    const expirado = prazoFixo({ id: "a", nome: "Aaa" });
    const volta = recorrente({ id: "z", nome: "Zzz", ...SAB_DOM, ...DAS_11_AS_15 });
    const agora = emSP("2026-10-13T12:00");
    const proximaAgora = (c: CardapioVigencia) => proximaAbertura(c, agora, SP);
    expect(escolherVinculoParaRotulo([semDias(expirado), semDias(volta)], proximaAgora)?.cardapio.id).toBe("z");
  });

  it("empate no instante ⇒ desempate por nome (pt-BR) e depois por id", () => {
    const base = { ...SAB_DOM, ...DAS_11_AS_15 };
    const acai = recorrente({ id: "id-2", nome: "Açaí", ...base });
    const azul = recorrente({ id: "id-1", nome: "Azul", ...base });
    // "Açaí" < "Azul" em pt-BR (ç colado no c), o que `localeCompare` sabe.
    expect(escolherVinculoParaRotulo([semDias(azul), semDias(acai)], proxima)?.cardapio.id).toBe("id-2");

    const mesmoNomeA = recorrente({ id: "id-a", nome: "Igual", ...base });
    const mesmoNomeB = recorrente({ id: "id-b", nome: "Igual", ...base });
    expect(escolherVinculoParaRotulo([semDias(mesmoNomeB), semDias(mesmoNomeA)], proxima)?.cardapio.id).toBe("id-a");
  });

  it("todos sem volta ⇒ null: não há frase verdadeira a escolher (RN-07)", () => {
    const expirado = prazoFixo({ id: "a" });
    const outroExpirado = prazoFixo({
      id: "b",
      prazo_inicio: instanteNoFuso("2026-01-01T00:00", SP),
      prazo_fim: instanteNoFuso("2026-02-01T00:00", SP),
    });
    expect(escolherVinculoParaRotulo([semDias(expirado), semDias(outroExpirado)], proxima)).toBeNull();
  });

  it("cardápio INATIVO não participa da escolha (RN-03)", () => {
    const desligado = recorrente({ id: "off", ativo: false, ...SAB_DOM, ...DAS_11_AS_15 });
    expect(escolherVinculoParaRotulo([semDias(desligado)], proxima)).toBeNull();
  });

  it("lista vazia ⇒ null, e o caller cai no fallback defensivo", () => {
    expect(escolherVinculoParaRotulo([], proxima)).toBeNull();
    expect(ROTULO_SEM_VOLTA).toBe("Indisponível no momento");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [273] RED — os rótulos passam a ler os dias do ITEM.
//
// Autoridade: specs/vigencia-por-item-do-cardapio.md RN-07 ("Todos os dias"),
// RN-08 (o selo do item + precedência cardápio fechado > item fora do dia) e
// RN-09 (`escolherCardapioParaRotulo` → `escolherVinculoParaRotulo`).
//
// ⚠️ SEAM 273 → GREEN. O contrato que este RED impõe:
//   1. `rotuloVoltaQuando(vinculo: VinculoVigencia, agora: Date, timezone: string)`
//      — `agora` entra porque a PRECEDÊNCIA de RN-08 mora na função pura, não nos
//      callers: cardápio fechado ⇒ frase do CARDÁPIO; cardápio aberto e só o item
//      fora do dia ⇒ frase do ITEM. Teto de 32 caracteres, aplicado aqui;
//   2. a preposição do plural concorda com o PRIMEIRO dia enumerado (ordem
//      seg-first): "Só às quartas e sábados", "Só aos sábados e domingos";
//   3. `descreverDiasDaSemana` com curto-circuito de 7 dias ANTES de
//      `corridaDaSemana`, servindo a prévia longa E o selo curto (RN-07);
//   4. `escolherVinculoParaRotulo(vinculos, proxima)` devolve o VÍNCULO, com a
//      MESMA escada de hoje (`proximaAbertura` do cardápio).
//
// Nenhuma segunda tabela de nome de dia: DIAS_LONGOS/DIAS_PLURAIS/DIAS_CURTOS,
// `corridaDaSemana` e `enumerar` são reusados (mandato 2).
//
// Import DINÂMICO por caminho em variável: `rotuloVoltaQuando` muda de aridade e
// `escolherVinculoParaRotulo` ainda não existe — resolver estaticamente deixaria
// `tsc` vermelho e mascararia a asserção.
// ═══════════════════════════════════════════════════════════════════════════

type VinculoRED = { cardapio: CardapioVigencia; dias_semana: number[] | null };
type RotuloPorVinculo = (v: VinculoRED, agora: Date, timezone: string) => string;
type EscolherVinculo = (
  vinculos: VinculoRED[],
  proxima: (c: CardapioVigencia) => Date | null,
) => VinculoRED | null;

const MODULO_DESCREVER = "./descreverVigencia";

async function carregarRotulo(): Promise<RotuloPorVinculo> {
  const mod = (await import(/* @vite-ignore */ MODULO_DESCREVER)) as Record<string, unknown>;
  return mod.rotuloVoltaQuando as RotuloPorVinculo;
}

async function carregarEscolher(): Promise<EscolherVinculo> {
  const mod = (await import(/* @vite-ignore */ MODULO_DESCREVER)) as Record<string, unknown>;
  const fn = mod.escolherVinculoParaRotulo;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 273] `escolherVinculoParaRotulo` ainda não é exportada de " +
        "`src/lib/utils/descreverVigencia.ts` — é a fase GREEN da issue 273. " +
        "Contrato: <C extends CardapioVigencia>(vinculos: VinculoVigencia<C>[], " +
        "proxima: (cardapio: C) => Date | null) => VinculoVigencia<C> | null, " +
        "com a MESMA escada de `escolherCardapioParaRotulo` (RN-09: rename, não cópia).",
    );
  }
  return fn as EscolherVinculo;
}

/** Os 7 dias marcados — o que o atalho "Todos os dias" do FormVigencia grava. */
const TODOS_OS_DIAS = { dias_semana: [0, 1, 2, 3, 4, 5, 6], dias_mes: null };

/** "Especiais do Dia": aberto a semana inteira, sem faixa de horas. */
const ESPECIAIS = recorrente({
  id: "c0000000-0000-4000-8000-000000000273",
  nome: "Especiais do Dia",
  ...TODOS_OS_DIAS,
});

const SEGUNDA_273 = emSP("2026-12-21T12:00");
const QUARTA_273 = emSP("2026-12-23T12:00");

describe("273/RN-07 — os 7 dias marcados leem 'todos os dias'", () => {
  it("prévia longa do painel ⇒ 'Aparece todos os dias.'", () => {
    // Sem a regra, `corridaDaSemana` diria "de segunda a domingo": verdadeiro,
    // desnecessariamente longo, e não é o que o lojista acabou de clicar.
    expect(descreverVigencia(recorrente(TODOS_OS_DIAS), SP)).toBe("Aparece todos os dias.");
  });

  it("prévia longa com faixa de horas ⇒ a faixa continua anexada", () => {
    expect(descreverVigencia(recorrente({ ...TODOS_OS_DIAS, ...DAS_11_AS_15 }), SP)).toBe(
      "Aparece todos os dias, das 11:00 às 15:00.",
    );
  });

  it("selo curto da vitrine ⇒ 'Todos os dias, 11:00–15:00'", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    const cardapio = recorrente({ ...TODOS_OS_DIAS, ...DAS_11_AS_15 });
    // Cardápio de 7 dias FORA da faixa de horas: fechado, com volta. É o único
    // estado em que este selo é produzido — o caso é real, não hipotético.
    const foraDaFaixa = emSP("2026-12-21T16:00");
    expect(rotuloVoltaQuandoV({ cardapio, dias_semana: null }, foraDaFaixa, SP)).toBe(
      "Todos os dias, 11:00–15:00",
    );
  });

  it("uma casa só: a prévia e o selo não podem divergir sobre os 7 dias", () => {
    // O curto-circuito é de `descreverDiasDaSemana`, antes de `corridaDaSemana`.
    expect(descreverVigencia(recorrente(TODOS_OS_DIAS), SP)).not.toContain("de segunda a domingo");
  });
});

describe("273/RN-08 — o selo do item fora do dia vem dos dias do ITEM", () => {
  it("cardápio ABERTO os 7 dias + item {qua, sáb}, numa segunda ⇒ 'Só às quartas e sábados'", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    // Dizer "Todos os dias" (a janela do CARDÁPIO) num prato que só sai na
    // quarta seria FALSO para o cliente.
    expect(rotuloVoltaQuandoV({ cardapio: ESPECIAIS, dias_semana: [3, 6] }, SEGUNDA_273, SP)).toBe(
      "Só às quartas e sábados",
    );
  });

  it("a preposição concorda com o PRIMEIRO dia enumerado (ordem seg-first)", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    // Primeiro dia feminino ⇒ "às"; primeiro dia masculino ⇒ "aos". Uma regra,
    // as duas redações — nunca "Só aos quartas".
    expect(rotuloVoltaQuandoV({ cardapio: ESPECIAIS, dias_semana: [2, 4] }, SEGUNDA_273, SP)).toBe(
      "Só às terças e quintas",
    );
    expect(rotuloVoltaQuandoV({ cardapio: ESPECIAIS, dias_semana: [6, 0] }, SEGUNDA_273, SP)).toBe(
      "Só aos sábados e domingos",
    );
  });

  it("PRECEDÊNCIA: cardápio FECHADO vence o item fora do dia", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    const fimDeSemana = recorrente({ ...SAB_DOM });
    // Segunda-feira: o cardápio {sáb,dom} está fechado E o item {qua} não é do
    // dia. A frase é a do CARDÁPIO — é a restrição que o cliente não destrava
    // esperando pouco (mesmo argumento de RN-05 da spec-mãe).
    expect(rotuloVoltaQuandoV({ cardapio: fimDeSemana, dias_semana: [3] }, SEGUNDA_273, SP)).toBe(
      "Só aos sábados e domingos",
    );
  });

  it("vínculo SEM dias num cardápio fechado continua lendo a frase do cardápio", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    // Regressão zero: é 100% das linhas no deploy da 272.
    for (const dias of [null, []] as (number[] | null)[]) {
      expect(
        rotuloVoltaQuandoV({ cardapio: recorrente({ ...SAB_DOM }), dias_semana: dias }, SEGUNDA_273, SP),
      ).toBe("Só aos sábados e domingos");
    }
  });

  it("o teto de 32 caracteres é da FUNÇÃO PURA, não do CSS — inclusive no item", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    // 5 dias não-consecutivos: não vira corrida, e a enumeração estoura o teto.
    const rotulo = rotuloVoltaQuandoV(
      { cardapio: ESPECIAIS, dias_semana: [1, 3, 5, 6, 0] },
      QUARTA_273,
      SP,
    );
    expect(rotulo.length).toBeLessThanOrEqual(32);
    expect(rotulo.endsWith("…")).toBe(true);
  });

  // [testar/273] Lacuna: o teste de PRECEDÊNCIA acima (linha ~473) usa um
  // cardápio fechado por DIA (sáb+dom numa segunda) — nele o dia do item
  // TAMBÉM está errado, então não isola qual dos dois eixos decide. Este teste
  // usa um cardápio aberto TODOS os dias (o dia está certo) mas FORA da faixa
  // de HORA, com um item cujo dia bate certinho com hoje — só assim a
  // precedência "cardápio fechado vence" é provada pelo eixo de HORA, e não
  // por uma coincidência de dia errado nos dois lados.
  it("PRECEDÊNCIA: cardápio FECHADO POR HORA vence item cujo dia é hoje", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    const comHorario = recorrente({ ...TODOS_OS_DIAS, ...DAS_11_AS_15 });
    // Quarta às 16:00: o cardápio abre todo dia mas só das 11 às 15 — a essa
    // hora está FECHADO. O item {qua, sáb} bate com HOJE (quarta): se o item
    // decidisse, a frase seria "Só às quartas e sábados" — factualmente
    // enganosa, porque o prato não está fora do dia, está fora do HORÁRIO.
    const quartaFechadaPorHora = emSP("2026-12-23T16:00");
    expect(
      rotuloVoltaQuandoV({ cardapio: comHorario, dias_semana: [3, 6] }, quartaFechadaPorHora, SP),
    ).toBe("Todos os dias, 11:00–15:00");
  });

  // [testar/273] Lacuna: o "Todos os dias" curto-circuito de RN-07 já é
  // provado no CARDÁPIO (linha ~434), mas D3 promete UMA implementação para as
  // DUAS redações (mandato M6) — inclusive quando é o ITEM que tem os 7 dias
  // marcados (ex.: lojista clicou "Todos os dias" na pílula do produto). Sem
  // este teste, alguém poderia duplicar o curto-circuito só no lado do
  // cardápio (`textoDoSelo`) e esquecer `textoDoSeloDoItem` — o bug ficaria
  // invisível porque os dois textos coincidem aqui, só a CASA muda.
  it("item com os 7 dias marcados também lê 'Todos os dias' (mesma casa do cardápio, D3)", async () => {
    const rotuloVoltaQuandoV = await carregarRotulo();
    const comHorario = recorrente({ ...TODOS_OS_DIAS, ...DAS_11_AS_15 });
    // Cardápio ABERTO agora (12:00, dentro da faixa 11-15): só assim a
    // precedência de RN-08 escolhe a frase do ITEM (`textoDoSeloDoItem`), que é
    // a casa onde `descreverDiasDaSemana(semana, "curta")` roda para o item.
    const quartaDentroDaFaixa = emSP("2026-12-23T12:00");
    expect(
      rotuloVoltaQuandoV(
        { cardapio: comHorario, dias_semana: [0, 1, 2, 3, 4, 5, 6] },
        quartaDentroDaFaixa,
        SP,
      ),
    ).toBe("Todos os dias, 11:00–15:00");
  });
});

describe("273/RN-09 — escolherVinculoParaRotulo devolve o VÍNCULO", () => {
  const proximaEm = (agora: Date) => (c: CardapioVigencia) => proximaAbertura(c, agora, SP);

  it("de dois vínculos, ganha o do cardápio que abre mais cedo — e volta o vínculo inteiro", async () => {
    const escolher = await carregarEscolher();
    const agora = emSP("2026-12-21T12:00"); // segunda
    const terca = recorrente({ id: "t", nome: "Terça", dias_semana: [2], dias_mes: null });
    const sabado = recorrente({ id: "s", nome: "Sábado", dias_semana: [6], dias_mes: null });

    const escolhido = escolher(
      [
        { cardapio: sabado, dias_semana: [6] },
        { cardapio: terca, dias_semana: [2] },
      ],
      proximaEm(agora),
    );

    // O vínculo, não o cardápio: é o `dias_semana` do item que o selo lê.
    expect(escolhido?.cardapio.id).toBe("t");
    expect(escolhido?.dias_semana).toEqual([2]);
  });

  it("cardápio INATIVO não participa, e lista vazia ⇒ null (escada idêntica à de hoje)", async () => {
    const escolher = await carregarEscolher();
    const agora = emSP("2026-12-21T12:00");
    const desligado = recorrente({ id: "off", ativo: false, ...SAB_DOM });

    expect(escolher([{ cardapio: desligado, dias_semana: [3] }], proximaEm(agora))).toBeNull();
    expect(escolher([], proximaEm(agora))).toBeNull();
  });
});

/**
 * [275/decisão F] O nome completo do dia é EXPORTADO daqui para o `aria-label`
 * das pílulas. Se algum dia alguém escrever a lista de novo num `.tsx`, estes
 * sete casos continuam passando lá e divergindo aqui — por isso a trava de
 * fonte de `PilulasDeDias.test.tsx` acompanha esta exportação.
 */
describe("rotuloLongoDoDia (275)", () => {
  it("dá o nome completo dos sete dias, 0=dom..6=sáb", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(rotuloLongoDoDia)).toEqual([
      "domingo",
      "segunda",
      "terça",
      "quarta",
      "quinta",
      "sexta",
      "sábado",
    ]);
  });

  it("fora de 0..6 devolve string vazia — dado velho não inventa rótulo", () => {
    expect(rotuloLongoDoDia(-1)).toBe("");
    expect(rotuloLongoDoDia(7)).toBe("");
    expect(rotuloLongoDoDia(1.5)).toBe("");
  });
});

/**
 * [276/RN-06] A matriz do aviso de agenda que nunca abre. O caso que separa um
 * aviso correto de um alarme falso é `dias_mes` não-vazio: o `OU` de RN-02 faz
 * a interseção deixar de ser vazia.
 */
describe("avisoAgendaQueNuncaAbre (276)", () => {
  function cardapio(over: Partial<CardapioVigencia> = {}): CardapioVigencia {
    return {
      id: "c1",
      nome: "Especiais do Dia",
      ativo: true,
      modo: "recorrente",
      dias_semana: [6, 0],
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
      prazo_inicio: null,
      prazo_fim: null,
      ...over,
    };
  }

  it("cardápio {sáb,dom} + item {qua} ⇒ a frase de RN-06, byte a byte", () => {
    expect(
      avisoAgendaQueNuncaAbre({ cardapio: cardapio(), dias_semana: [3] }),
    ).toBe(
      "Este item nunca aparece: o cardápio só abre aos sábados e domingos.",
    );
  });

  it("corrida de dias vira 'de X a Y'", () => {
    expect(
      avisoAgendaQueNuncaAbre({
        cardapio: cardapio({ dias_semana: [1, 2, 3, 4, 5] }),
        dias_semana: [0, 6],
      }),
    ).toBe("Este item nunca aparece: o cardápio só abre de segunda a sexta.");
  });

  it("interseção NÃO vazia ⇒ sem aviso", () => {
    expect(
      avisoAgendaQueNuncaAbre({ cardapio: cardapio(), dias_semana: [3, 6] }),
    ).toBeNull();
  });

  it("dias_mes não-vazio ⇒ sem aviso (o OU de RN-02 abre o cardápio)", () => {
    expect(
      avisoAgendaQueNuncaAbre({
        cardapio: cardapio({ dias_mes: [15] }),
        dias_semana: [3],
      }),
    ).toBeNull();
  });

  it("cardápio inativo ⇒ sem aviso (RN-03: desligado não restringe)", () => {
    expect(
      avisoAgendaQueNuncaAbre({
        cardapio: cardapio({ ativo: false }),
        dias_semana: [3],
      }),
    ).toBeNull();
  });

  it("prazo_fixo ⇒ sem aviso (não tem eixo de dia da semana)", () => {
    expect(
      avisoAgendaQueNuncaAbre({
        cardapio: cardapio({
          modo: "prazo_fixo",
          dias_semana: null,
          prazo_inicio: "2026-09-01T00:00:00Z",
          prazo_fim: "2026-10-01T00:00:00Z",
        }),
        dias_semana: [3],
      }),
    ).toBeNull();
  });

  it("cardápio sem dias, ou item sem dias, ⇒ sem aviso", () => {
    expect(
      avisoAgendaQueNuncaAbre({
        cardapio: cardapio({ dias_semana: null }),
        dias_semana: [3],
      }),
    ).toBeNull();
    expect(
      avisoAgendaQueNuncaAbre({ cardapio: cardapio(), dias_semana: [] }),
    ).toBeNull();
    expect(
      avisoAgendaQueNuncaAbre({ cardapio: cardapio(), dias_semana: null }),
    ).toBeNull();
  });

  it("dias fora de 0..6 são filtrados antes da interseção", () => {
    expect(
      avisoAgendaQueNuncaAbre({ cardapio: cardapio(), dias_semana: [9] }),
    ).toBeNull();
  });
});

/**
 * [278/RN-13] A forma CURTA dos dias do item, para o chip e a linha
 * "Está em:". `null` significa "não anexe nada".
 */
describe("rotuloDiasDoItem (278)", () => {
  it("dois dias viram a lista curta", () => {
    expect(rotuloDiasDoItem([3, 6])).toBe("qua e sáb");
  });

  it("três ou mais consecutivos viram a corrida", () => {
    expect(rotuloDiasDoItem([1, 2, 3, 4, 5])).toBe("seg a sex");
  });

  it("ordem seg-first, não dom-first", () => {
    expect(rotuloDiasDoItem([0, 6])).toBe("sáb e dom");
  });

  it("null, vazio e os 7 dias são indistinguíveis de 'sem restrição'", () => {
    expect(rotuloDiasDoItem(null)).toBeNull();
    expect(rotuloDiasDoItem([])).toBeNull();
    expect(rotuloDiasDoItem([0, 1, 2, 3, 4, 5, 6])).toBeNull();
  });

  it("dado velho fora de 0..6 é filtrado; sobrando vazio, null", () => {
    expect(rotuloDiasDoItem([9, -1])).toBeNull();
    expect(rotuloDiasDoItem([9, 3])).toBe("qua");
  });
});
