import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { instanteNoFuso } from "./fusoLoja";
import {
  avaliarVigenciaDoProduto,
  cardapioAberto,
  type CardapioVigencia,
} from "./vigenciaCardapio";

const SP = "America/Sao_Paulo";

/**
 * Instante absoluto a partir do horário LOCAL da loja. Usa o primitivo que já
 * existe (`instanteNoFuso`, issue 222) — o teste não reescreve aritmética de
 * fuso, exatamente como a implementação não deve.
 */
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));

const base: CardapioVigencia = {
  id: "00000000-0000-0000-0000-000000000000",
  nome: "Cardápio",
  ativo: true,
  modo: "recorrente",
  dias_semana: null,
  dias_mes: null,
  hora_inicio: null,
  hora_fim: null,
  prazo_inicio: null,
  prazo_fim: null,
};

const recorrente = (campos: Partial<CardapioVigencia>): CardapioVigencia => ({
  ...base,
  modo: "recorrente",
  ...campos,
});

const prazoFixo = (campos: Partial<CardapioVigencia>): CardapioVigencia => ({
  ...base,
  modo: "prazo_fixo",
  ...campos,
});

// Cenário 1 do spec: "Feijoada", sáb + dom, 11:00–15:00.
// `hora_*` com segundos é o que o Postgres serializa de uma coluna `time`.
const fimDeSemana = recorrente({
  id: "11111111-1111-1111-1111-111111111111",
  nome: "Fim de semana",
  dias_semana: [0, 6],
  dias_mes: null,
  hora_inicio: "11:00:00",
  hora_fim: "15:00:00",
});

// Cenário 2: "Semana do Hambúrguer", prazo fixo 10/10 00:00 → 17/10 00:00 (SP).
const semanaDoHamburguer = prazoFixo({
  id: "22222222-2222-2222-2222-222222222222",
  nome: "Semana do Hambúrguer",
  prazo_inicio: instanteNoFuso("2026-10-10T00:00", SP),
  prazo_fim: instanteNoFuso("2026-10-17T00:00", SP),
});

// Cenário 4 e 6: "Cardápio de Inverno", prazo fixo 01/06/2026 → 01/09/2026 (SP).
const inverno = prazoFixo({
  id: "33333333-3333-3333-3333-333333333333",
  nome: "Cardápio de Inverno",
  prazo_inicio: instanteNoFuso("2026-06-01T00:00", SP),
  prazo_fim: instanteNoFuso("2026-09-01T00:00", SP),
});

describe("cardapioAberto — recorrente (RN-02), cenário 1 literal", () => {
  it("sáb 10/10/2026 10:59 — antes da faixa, fechado", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-10T10:59"), SP)).toBe(
      false,
    );
  });

  it("sáb 10/10/2026 11:00 — início INCLUSIVO, aberto", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-10T11:00"), SP)).toBe(true);
  });

  it("sáb 10/10/2026 14:59 — último minuto, aberto", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-10T14:59"), SP)).toBe(true);
  });

  it("sáb 10/10/2026 15:00 — fim EXCLUSIVO, fechado", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-10T15:00"), SP)).toBe(
      false,
    );
  });

  it("ter 13/10/2026 12:00 — dia fora de dias_semana, fechado", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-13T12:00"), SP)).toBe(
      false,
    );
  });

  it("sáb 17/10/2026 12:00 — recorrente repete para sempre, aberto", () => {
    expect(cardapioAberto(fimDeSemana, emSP("2026-10-17T12:00"), SP)).toBe(true);
  });

  it("aceita hora sem segundos ('11:00'), o mesmo veredito de '11:00:00'", () => {
    const semSegundos = recorrente({
      dias_semana: [0, 6],
      hora_inicio: "11:00",
      hora_fim: "15:00",
    });
    expect(cardapioAberto(semSegundos, emSP("2026-10-10T11:00"), SP)).toBe(true);
    expect(cardapioAberto(semSegundos, emSP("2026-10-10T15:00"), SP)).toBe(
      false,
    );
  });

  it("decide no fuso da LOJA, não no do runtime: 23:00 em Manaus é 00:00 em SP", () => {
    // 2026-10-11T02:00Z = sáb 10/10 22:00 em Manaus (UTC-4) e dom 11/10 23:00
    // em SP (UTC-3). Um cardápio só de sábado 21:00–23:00 abre em Manaus e
    // fecha em SP no MESMO instante.
    const sabadoNoite = recorrente({
      dias_semana: [6],
      hora_inicio: "21:00:00",
      hora_fim: "23:00:00",
    });
    const instante = new Date("2026-10-11T02:00:00Z");
    expect(cardapioAberto(sabadoNoite, instante, "America/Manaus")).toBe(true);
    expect(cardapioAberto(sabadoNoite, instante, SP)).toBe(false);
  });
});

describe("cardapioAberto — RN-02: OU entre dias_semana e dias_mes (regra FECHADA)", () => {
  // O caso que separa OU de E. dias_semana = {sáb,dom} + dias_mes = {1,15}.
  const ouFechado = recorrente({
    nome: "OU fechado",
    dias_semana: [0, 6],
    dias_mes: [1, 15],
    hora_inicio: "11:00:00",
    hora_fim: "15:00:00",
  });

  it("QUARTA-FEIRA, DIA 15 (15/07/2026 12:00) ⇒ ABERTO — a interseção daria fechado", () => {
    expect(cardapioAberto(ouFechado, emSP("2026-07-15T12:00"), SP)).toBe(true);
  });

  it("sáb 10/10/2026 12:00 (dia 10, não está em dias_mes) ⇒ ABERTO pelo outro eixo", () => {
    expect(cardapioAberto(ouFechado, emSP("2026-10-10T12:00"), SP)).toBe(true);
  });

  it("qua 08/07/2026 12:00 — nenhum dos dois eixos casa ⇒ fechado", () => {
    expect(cardapioAberto(ouFechado, emSP("2026-07-08T12:00"), SP)).toBe(false);
  });

  it("qua 15/07/2026 10:00 — dia casa, hora não: E entre diaOk e horaOk ⇒ fechado", () => {
    expect(cardapioAberto(ouFechado, emSP("2026-07-15T10:00"), SP)).toBe(false);
  });
});

describe("cardapioAberto — RN-02: eixo vazio é SEM RESTRIÇÃO, nunca 'nenhum dia'", () => {
  it("só faixa de horário ⇒ abre todo dia nesse horário", () => {
    const soHorario = recorrente({
      dias_semana: null,
      dias_mes: null,
      hora_inicio: "11:00:00",
      hora_fim: "15:00:00",
    });
    expect(cardapioAberto(soHorario, emSP("2026-10-13T12:00"), SP)).toBe(true);
    expect(cardapioAberto(soHorario, emSP("2026-10-14T12:00"), SP)).toBe(true);
    expect(cardapioAberto(soHorario, emSP("2026-10-13T16:00"), SP)).toBe(false);
  });

  it("só dias da semana ⇒ abre o DIA INTEIRO nesses dias", () => {
    const soDiasSemana = recorrente({
      dias_semana: [0, 6],
      hora_inicio: null,
      hora_fim: null,
    });
    expect(cardapioAberto(soDiasSemana, emSP("2026-10-10T03:00"), SP)).toBe(
      true,
    );
    expect(cardapioAberto(soDiasSemana, emSP("2026-10-10T23:59"), SP)).toBe(
      true,
    );
    expect(cardapioAberto(soDiasSemana, emSP("2026-10-13T12:00"), SP)).toBe(
      false,
    );
  });

  it("só dias do mês ⇒ abre o dia inteiro nesses dias do mês", () => {
    const soDiasMes = recorrente({ dias_mes: [15] });
    expect(cardapioAberto(soDiasMes, emSP("2026-07-15T00:00"), SP)).toBe(true);
    expect(cardapioAberto(soDiasMes, emSP("2026-07-14T23:59"), SP)).toBe(false);
  });

  it("array VAZIO é tratado como vazio, igual a NULL (defesa: a Action normaliza, o dado antigo pode não)", () => {
    const vaziosComHorario = recorrente({
      dias_semana: [],
      dias_mes: [],
      hora_inicio: "11:00:00",
      hora_fim: "15:00:00",
    });
    expect(cardapioAberto(vaziosComHorario, emSP("2026-10-13T12:00"), SP)).toBe(
      true,
    );
    expect(cardapioAberto(vaziosComHorario, emSP("2026-10-13T16:00"), SP)).toBe(
      false,
    );
  });

  it("dias_mes = [31] simplesmente não casa em mês de 30 dias", () => {
    const dia31 = recorrente({ dias_mes: [31] });
    expect(cardapioAberto(dia31, emSP("2026-06-30T12:00"), SP)).toBe(false);
    expect(cardapioAberto(dia31, emSP("2026-07-31T12:00"), SP)).toBe(true);
  });
});

describe("cardapioAberto — prazo fixo (RN-04), cenário 2 literal", () => {
  it("sáb 10/10/2026 00:00 — início INCLUSIVO, aberto", () => {
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-10T00:00"), SP)).toBe(
      true,
    );
  });

  it("sex 09/10/2026 23:59 — ainda não começou, fechado", () => {
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-09T23:59"), SP)).toBe(
      false,
    );
  });

  it("sáb 10/10/2026 09:00 e sex 16/10/2026 23:59 — dentro", () => {
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-10T09:00"), SP)).toBe(
      true,
    );
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-16T23:59"), SP)).toBe(
      true,
    );
  });

  it("sáb 17/10/2026 00:00 — fim EXCLUSIVO, fechado", () => {
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-17T00:00"), SP)).toBe(
      false,
    );
  });

  it("sáb 17/10/2026 00:01 — expirado", () => {
    expect(cardapioAberto(semanaDoHamburguer, emSP("2026-10-17T00:01"), SP)).toBe(
      false,
    );
  });

  it("é comparação INSTANTE ↔ INSTANTE: o timezone não muda o veredito", () => {
    const instante = new Date(instanteNoFuso("2026-10-16T23:59", SP));
    expect(cardapioAberto(semanaDoHamburguer, instante, SP)).toBe(true);
    expect(cardapioAberto(semanaDoHamburguer, instante, "UTC")).toBe(true);
    expect(cardapioAberto(semanaDoHamburguer, instante, "Asia/Tokyo")).toBe(
      true,
    );
  });
});

describe("cardapioAberto — RN-03: inativo não participa de nada", () => {
  it("recorrente desligado, dentro da faixa ⇒ fechado", () => {
    const desligado = { ...fimDeSemana, ativo: false };
    expect(cardapioAberto(desligado, emSP("2026-10-10T12:00"), SP)).toBe(false);
  });

  it("prazo fixo desligado, dentro do prazo ⇒ fechado", () => {
    const desligado = { ...semanaDoHamburguer, ativo: false };
    expect(cardapioAberto(desligado, emSP("2026-10-12T12:00"), SP)).toBe(false);
  });
});

describe("avaliarVigenciaDoProduto — RN-05: produto do MENU nem entra na conta (D14)", () => {
  /**
   * Lista que EXPLODE em qualquer acesso. Se a implementação ler a lista antes
   * de curto-circuitar por `visibilidade === 'menu'`, o teste quebra — é o
   * "sem sequer ler a lista de cardápios" do critério de aceite.
   */
  const cardapiosProibidos = new Proxy([] as CardapioVigencia[], {
    get(_alvo, prop) {
      throw new Error(
        `produto do menu não pode ler a lista de cardápios (acessou "${String(prop)}")`,
      );
    },
  });

  it("'menu' ⇒ dentroDaJanela true sem tocar na lista de cardápios", () => {
    expect(
      avaliarVigenciaDoProduto(
        { visibilidade: "menu" },
        cardapiosProibidos,
        emSP("2026-10-13T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("cenário 6 — Coca-Cola 'menu' em cardápio EXPIRADO segue vendendo em 20/12/2026", () => {
    expect(
      avaliarVigenciaDoProduto(
        { visibilidade: "menu" },
        [inverno],
        emSP("2026-12-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("cenário 3 — 'menu' fora da janela do cardápio recorrente, numa terça, continua dentro", () => {
    expect(
      avaliarVigenciaDoProduto(
        { visibilidade: "menu" },
        [fimDeSemana],
        emSP("2026-10-13T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });
});

describe("avaliarVigenciaDoProduto — RN-05: UNIÃO entre cardápios (cenário 4 literal)", () => {
  const feijoada = { visibilidade: "cardapio" } as const;
  const dois = [fimDeSemana, inverno];

  it("qua 15/07/2026 12:00 — 'Fim de semana' fechado + 'Inverno' ABERTO ⇒ comprável (interseção daria não)", () => {
    expect(
      avaliarVigenciaDoProduto(feijoada, dois, emSP("2026-07-15T12:00"), SP),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("ter 13/10/2026 12:00 — os dois fechados, mas o recorrente volta sáb ⇒ não comprável e NÃO some", () => {
    expect(
      avaliarVigenciaDoProduto(feijoada, dois, emSP("2026-10-13T12:00"), SP),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });

  it("sáb 17/10/2026 12:00 — 'Fim de semana' aberto + 'Inverno' expirado ⇒ comprável", () => {
    expect(
      avaliarVigenciaDoProduto(feijoada, dois, emSP("2026-10-17T12:00"), SP),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });
});

describe("avaliarVigenciaDoProduto — RN-13: os quatro desfechos do produto 'cardapio'", () => {
  const exclusivo = { visibilidade: "cardapio" } as const;

  it("1) algum cardápio ABERTO agora ⇒ comprável e visível", () => {
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [fimDeSemana],
        emSP("2026-10-10T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("2) recorrente FECHADO (terça, abre sábado) ⇒ aparece MARCADO", () => {
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [fimDeSemana],
        emSP("2026-10-13T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });

  it("3) prazo fixo que AINDA NÃO COMEÇOU ⇒ aparece marcado, com a data de estreia", () => {
    const estreiaEmJunho = prazoFixo({
      nome: "Temporada 2027",
      prazo_inicio: instanteNoFuso("2027-06-01T00:00", SP),
      prazo_fim: instanteNoFuso("2027-09-01T00:00", SP),
    });
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [estreiaEmJunho],
        emSP("2026-05-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });

  it("4a) cenário 6 — prazo fixo EXPIRADO em 20/12/2026 ⇒ a sopa SOME da vitrine", () => {
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [inverno],
        emSP("2026-12-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: false });
  });

  it("4b) único cardápio DESLIGADO ⇒ some, mesmo no sábado ao meio-dia (RN-03 + RN-13)", () => {
    const desligado = { ...fimDeSemana, ativo: false };
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [desligado],
        emSP("2026-10-10T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: false });
  });

  it("produto 'cardapio' sem nenhum vínculo ⇒ some (some([]) === false)", () => {
    expect(
      avaliarVigenciaDoProduto(exclusivo, [], emSP("2026-10-10T12:00"), SP),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: false });
  });

  it("cardápio inativo não conta como abertura futura, mas um ativo fechado ao lado salva o produto", () => {
    const desligado = { ...fimDeSemana, ativo: false };
    const outroAtivoFechado = recorrente({
      id: "44444444-4444-4444-4444-444444444444",
      nome: "Almoço executivo",
      dias_semana: [1, 2, 3, 4, 5],
      hora_inicio: "11:00:00",
      hora_fim: "15:00:00",
    });
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [desligado, outroAtivoFechado],
        emSP("2026-10-11T18:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });
});

describe("mandato 2 — nenhuma segunda cópia de aritmética de fuso", () => {
  const fonte = readFileSync(
    new URL("./vigenciaCardapio.ts", import.meta.url),
    "utf8",
  );

  it("consome partesNoFuso e paraMinutos de ./fusoLoja", () => {
    expect(fonte).toMatch(/from\s+"\.\/fusoLoja"/);
    expect(fonte).toContain("partesNoFuso");
    expect(fonte).toContain("paraMinutos");
  });

  it("não instancia Intl nem reparte 'HH:MM' por conta própria", () => {
    expect(fonte).not.toContain("Intl.");
    expect(fonte).not.toMatch(/split\(\s*":"\s*\)/);
  });
});
