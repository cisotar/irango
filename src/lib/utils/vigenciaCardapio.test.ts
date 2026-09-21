import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { instanteNoFuso } from "./fusoLoja";
import {
  avaliarVigenciaDoProduto,
  cardapioAberto,
  // [247] RED — normalizadores de D6, AINDA NÃO IMPLEMENTADOS.
  paraCardapioVigencia,
  visibilidadeDe,
  type CardapioVigencia,
  type VinculoVigencia,
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

/**
 * [273] O vínculo SEM dias do item — a forma de 100% das linhas no deploy da
 * 272. É o adaptador de eixo das fixtures de 246/247: o veredito tem de ser
 * byte a byte o de antes do motor passar a ler vínculo.
 */
const semDias = (cardapio: CardapioVigencia) => ({ cardapio, dias_semana: null });

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
  const cardapiosProibidos = new Proxy([] as VinculoVigencia[], {
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
        [semDias(inverno)],
        emSP("2026-12-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("cenário 3 — 'menu' fora da janela do cardápio recorrente, numa terça, continua dentro", () => {
    expect(
      avaliarVigenciaDoProduto(
        { visibilidade: "menu" },
        [semDias(fimDeSemana)],
        emSP("2026-10-13T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });
});

describe("avaliarVigenciaDoProduto — RN-05: UNIÃO entre cardápios (cenário 4 literal)", () => {
  const feijoada = { visibilidade: "cardapio" } as const;
  const dois = [semDias(fimDeSemana), semDias(inverno)];

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
        [semDias(fimDeSemana)],
        emSP("2026-10-10T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("2) recorrente FECHADO (terça, abre sábado) ⇒ aparece MARCADO", () => {
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [semDias(fimDeSemana)],
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
        [semDias(estreiaEmJunho)],
        emSP("2026-05-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });

  it("4a) cenário 6 — prazo fixo EXPIRADO em 20/12/2026 ⇒ a sopa SOME da vitrine", () => {
    expect(
      avaliarVigenciaDoProduto(
        exclusivo,
        [semDias(inverno)],
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
        [semDias(desligado)],
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
        [semDias(desligado), semDias(outroAtivoFechado)],
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

// ═════════════════════════════════════════════════════════════════════════════
// [247/D6] Fase RED — estreitamento de `modo` e `visibilidade`, que chegam como
// `string` dos tipos gerados (o CHECK do Postgres não viaja para o TypeScript).
// As duas direções são OPOSTAS de propósito, e é isso que o teste fixa.
// ═════════════════════════════════════════════════════════════════════════════

/** Row crua como o PostgREST devolve: `modo` é `string`, não a união. */
const rowCrua = (modo: string) => ({
  id: "c0000000-0000-4000-8000-00000000000a",
  nome: "Cardápio",
  ativo: true,
  modo,
  // Todos os eixos NULL = "sem restrição": é justamente a combinação que, se a
  // linha NÃO fosse descartada, produziria um cardápio SEMPRE ABERTO.
  dias_semana: null,
  dias_mes: null,
  hora_inicio: null,
  hora_fim: null,
  prazo_inicio: null,
  prazo_fim: null,
});

describe("247/D6 — paraCardapioVigencia é FAIL-CLOSED no `modo`", () => {
  it("estreita 'recorrente' e 'prazo_fixo' preservando a linha", () => {
    for (const modo of ["recorrente", "prazo_fixo"] as const) {
      const c = paraCardapioVigencia(rowCrua(modo));
      expect(c).not.toBeNull();
      expect(c?.modo).toBe(modo);
      expect(c?.id).toBe("c0000000-0000-4000-8000-00000000000a");
    }
  });

  it("modo FORA do domínio ⇒ null: a linha é DESCARTADA, nunca normalizada", () => {
    // Um fallback para "recorrente" aqui faria esta linha (todos os eixos NULL)
    // virar um cardápio aberto 24/7 — a vitrine venderia a temporada inteira.
    for (const modo of ["sazonal", "", "RECORRENTE", "prazo-fixo", "null"]) {
      expect(paraCardapioVigencia(rowCrua(modo))).toBeNull();
    }
  });

  it("a linha descartada não pode ter virado um cardápio aberto por acidente", () => {
    const c = paraCardapioVigencia(rowCrua("modo_que_nao_existe"));
    // Afirma o DESCARTE, não só "não é recorrente": nenhum objeto sai daqui.
    expect(c).toBeNull();
    expect(c === null ? false : cardapioAberto(c, emSP("2026-10-13T12:00"), SP)).toBe(
      false,
    );
  });
});

describe("247/D6 — visibilidadeDe é FAIL-OPEN em 'menu'", () => {
  it("'cardapio' é o ÚNICO valor que vira 'cardapio'", () => {
    expect(visibilidadeDe({ visibilidade: "cardapio" })).toBe("cardapio");
  });

  it("'menu' continua 'menu'", () => {
    expect(visibilidadeDe({ visibilidade: "menu" })).toBe("menu");
  });

  it("valor DESCONHECIDO cai em 'menu' — produto não some em silêncio", () => {
    // Direção oposta à de `modo`, por decisão: tratar desconhecido como
    // 'cardapio' faria o produto sumir de TODAS as vitrines, sem erro nenhum.
    for (const valor of ["", "exclusivo", "CARDAPIO", "sazonal", "cardapio "]) {
      expect(visibilidadeDe({ visibilidade: valor })).toBe("menu");
    }
  });

  it("o produto do menu por fallback continua comprável fora de qualquer janela", () => {
    // Prova de CONSEQUÊNCIA, não só do valor devolvido: é o comportamento de
    // hoje que o fail-open preserva.
    expect(
      avaliarVigenciaDoProduto(
        { visibilidade: visibilidadeDe({ visibilidade: "valor_de_migration_futura" }) },
        [],
        emSP("2026-10-13T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [273] RED — o eixo do motor passa de CARDÁPIO para VÍNCULO.
//
// Autoridade: specs/vigencia-por-item-do-cardapio.md RN-01 (itemAberto),
// RN-02 (união sobre vínculos) e RN-03 (voltaAAbrir ignora o eixo do item).
//
// ⚠️ SEAM 273 → GREEN. O contrato que este RED impõe:
//   1. `export type VinculoVigencia<C extends CardapioVigencia = CardapioVigencia>
//      = { cardapio: C; dias_semana: number[] | null }`;
//   2. `export function itemAberto(v: VinculoVigencia, agora: Date, tz: string): boolean`
//      = `cardapioAberto(v.cardapio, …)` **E** (`dias_semana` vazio OU contém
//      `diaIndex`), com `diaIndex` de `partesNoFusoCompletas` — nenhum `Intl` novo;
//   3. `avaliarVigenciaDoProduto` troca o 2º parâmetro de `CardapioVigencia[]`
//      para `VinculoVigencia[]`; `some` e o curto-circuito de `'menu'` intactos;
//   4. `voltaAAbrir` passa a receber o vínculo e **IGNORA** `dias_semana` (RN-03).
//
// Import DINÂMICO por caminho em variável: `itemAberto` ainda não existe e o 2º
// parâmetro de `avaliarVigenciaDoProduto` ainda tem o tipo antigo — resolver
// isso estaticamente deixaria `tsc` vermelho e mascararia a asserção.
// ═══════════════════════════════════════════════════════════════════════════

type VinculoVigenciaRED = {
  cardapio: CardapioVigencia;
  dias_semana: number[] | null;
};
type ItemAberto = (v: VinculoVigenciaRED, agora: Date, tz: string) => boolean;
type AvaliarPorVinculo = (
  produto: { visibilidade: "menu" | "cardapio" },
  vinculos: VinculoVigenciaRED[],
  agora: Date,
  timezone: string,
) => { dentroDaJanela: boolean; visivelNaVitrine: boolean };

const MODULO_VIGENCIA = "./vigenciaCardapio";

async function carregarMotor(): Promise<{ itemAberto: ItemAberto }> {
  const mod = (await import(/* @vite-ignore */ MODULO_VIGENCIA)) as Record<string, unknown>;
  const fn = mod.itemAberto;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 273] `itemAberto` ainda não é exportada de " +
        "`src/lib/utils/vigenciaCardapio.ts` — é a fase GREEN da issue 273. " +
        "Contrato: (vinculo: VinculoVigencia, agora: Date, timezone: string) => boolean, " +
        "= cardapioAberto(vinculo.cardapio, agora, tz) E ((vinculo.dias_semana ?? []).length === 0 " +
        "OU vinculo.dias_semana.includes(diaIndex)), com diaIndex de partesNoFusoCompletas.",
    );
  }
  return { itemAberto: fn as ItemAberto };
}

/**
 * `avaliarVigenciaDoProduto` JÁ existe — só o 2º parâmetro muda de eixo. Por
 * isso este loader NÃO lança: os testes de RN-02 têm de ficar vermelhos pela
 * ASSERÇÃO (o veredito errado), não por um símbolo ausente.
 */
async function carregarAvaliar(): Promise<AvaliarPorVinculo> {
  const mod = (await import(/* @vite-ignore */ MODULO_VIGENCIA)) as Record<string, unknown>;
  return mod.avaliarVigenciaDoProduto as AvaliarPorVinculo;
}

/** O cardápio "Especiais do Dia" do pedido literal do dono: aberto os 7 dias. */
const ESPECIAIS_DO_DIA = recorrente({
  id: "cccccccc-0000-4000-8000-000000000001",
  nome: "Especiais do Dia",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
});

/** Cardápio de fim de semana, sem faixa de horas (para isolar o eixo de dia). */
const SO_FIM_DE_SEMANA = recorrente({
  id: "cccccccc-0000-4000-8000-000000000002",
  nome: "Fim de semana",
  dias_semana: [6, 0],
});

const SEGUNDA = emSP("2026-12-21T12:00");
const QUARTA = emSP("2026-12-23T12:00");
const SABADO = emSP("2026-12-26T12:00");
/** Quarta-feira **dia 15** — o caso do `OU` entre os eixos do cardápio. */
const QUARTA_DIA_15 = emSP("2026-07-15T12:00");
/** Quarta-feira dia 22 do mesmo mês: mesmo dia da semana, outro dia do mês. */
const QUARTA_DIA_22 = emSP("2026-07-22T12:00");

const EXCLUSIVO = { visibilidade: "cardapio" as const };

describe("273/RN-01 — itemAberto: filtro DENTRO da janela do cardápio", () => {
  it("cardápio {seg..dom} + item {qua, sáb} ABRE na quarta", async () => {
    const { itemAberto } = await carregarMotor();
    expect(
      itemAberto({ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }, QUARTA, SP),
    ).toBe(true);
  });

  it("o MESMO vínculo NÃO abre na segunda — é o vermelho do loop", async () => {
    const { itemAberto } = await carregarMotor();
    expect(
      itemAberto({ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }, SEGUNDA, SP),
    ).toBe(false);
  });

  it("`dias_semana` NULL e [] são idênticos: herdam a janela do cardápio", async () => {
    const { itemAberto } = await carregarMotor();
    // 100% das linhas no deploy da 272 são NULL: regressão zero.
    expect(itemAberto({ cardapio: ESPECIAIS_DO_DIA, dias_semana: null }, SEGUNDA, SP)).toBe(true);
    expect(itemAberto({ cardapio: ESPECIAIS_DO_DIA, dias_semana: [] }, SEGUNDA, SP)).toBe(true);
    // E herdar a janela é herdar o FECHADO também.
    expect(itemAberto({ cardapio: SO_FIM_DE_SEMANA, dias_semana: null }, SEGUNDA, SP)).toBe(false);
    expect(itemAberto({ cardapio: SO_FIM_DE_SEMANA, dias_semana: [] }, SEGUNDA, SP)).toBe(false);
  });

  it("é INTERSEÇÃO: cardápio {sáb,dom} + item {qua} nunca abre", async () => {
    const { itemAberto } = await carregarMotor();
    const vinculo = { cardapio: SO_FIM_DE_SEMANA, dias_semana: [3] };
    // Na quarta o cardápio está fechado; no sábado o item não é do dia.
    expect(itemAberto(vinculo, QUARTA, SP)).toBe(false);
    expect(itemAberto(vinculo, SABADO, SP)).toBe(false);
    expect(itemAberto(vinculo, SEGUNDA, SP)).toBe(false);
  });

  it("o `OU` entre dias_semana e dias_mes fica DENTRO do cardápio; o `E` do item é por fora", async () => {
    const { itemAberto } = await carregarMotor();
    const cardapio = recorrente({
      id: "cccccccc-0000-4000-8000-000000000003",
      nome: "Fim de semana e dia 15",
      dias_semana: [6, 0],
      dias_mes: [15],
    });
    const vinculo = { cardapio, dias_semana: [3] };

    // Quarta dia 15: o cardápio abre pelo eixo do MÊS, e o item é de quarta.
    expect(itemAberto(vinculo, QUARTA_DIA_15, SP)).toBe(true);
    // Quarta dia 22: mesmo dia da semana, mas nenhum eixo do cardápio casa.
    expect(itemAberto(vinculo, QUARTA_DIA_22, SP)).toBe(false);
    // Sábado dia 18 (2026-07-18): o cardápio abre, mas o item não é do dia.
    expect(itemAberto(vinculo, emSP("2026-07-18T12:00"), SP)).toBe(false);
  });

  it("cardápio INATIVO fecha o item mesmo no dia marcado (RN-03 da spec-mãe)", async () => {
    const { itemAberto } = await carregarMotor();
    expect(
      itemAberto(
        { cardapio: { ...ESPECIAIS_DO_DIA, ativo: false }, dias_semana: [3, 6] },
        QUARTA,
        SP,
      ),
    ).toBe(false);
  });

  it("a faixa de horas continua sendo do CARDÁPIO — o item não ganha horário", async () => {
    const { itemAberto } = await carregarMotor();
    const cardapio = recorrente({
      ...ESPECIAIS_DO_DIA,
      hora_inicio: "11:00:00",
      hora_fim: "15:00:00",
    });
    const vinculo = { cardapio, dias_semana: [3] };
    expect(itemAberto(vinculo, emSP("2026-12-23T12:00"), SP)).toBe(true);
    expect(itemAberto(vinculo, emSP("2026-12-23T16:00"), SP)).toBe(false);
  });
});

// [testar/273] Lacuna encontrada pela auditoria de cobertura, não pelo RED
// original: `partesNoFusoCompletas` (mandato 2) já lê o dia no fuso via Intl,
// então este teste TRAVA a garantia, e falharia se alguém trocasse o cálculo
// de `diaIndex` por `agora.getUTCDay()`/`getDay()` — o bug clássico de vitrine
// que "muda de dia" perto da meia-noite para lojas fora do fuso do servidor.
describe("273/RN-01 — itemAberto: diaIndex vem do fuso da LOJA, nunca do UTC", () => {
  it("domingo 23:30 em SP (já madrugada de SEGUNDA em UTC) não abre item só de segunda", async () => {
    const { itemAberto } = await carregarMotor();
    // 2026-10-11 é domingo (o dia seguinte ao sábado 10/10 usado nos testes de
    // cardapioAberto acima). 23:30 em SP (UTC-3, sem horário de verão) é
    // 2026-10-12T02:30Z — já SEGUNDA em UTC. É a armadilha que o teste prova.
    const domingoTardeEmSP = emSP("2026-10-11T23:30");
    expect(domingoTardeEmSP.getUTCDay()).toBe(1); // 1 = segunda em UTC — a armadilha
    const soSegunda = { cardapio: ESPECIAIS_DO_DIA, dias_semana: [1] };
    expect(itemAberto(soSegunda, domingoTardeEmSP, SP)).toBe(false);
  });

  it("o MESMO instante abre o item marcado para domingo — o dia certo é o de SP", async () => {
    const { itemAberto } = await carregarMotor();
    const domingoTardeEmSP = emSP("2026-10-11T23:30");
    const soDomingo = { cardapio: ESPECIAIS_DO_DIA, dias_semana: [0] };
    expect(itemAberto(soDomingo, domingoTardeEmSP, SP)).toBe(true);
  });
});

// [testar/273] `dias_semana` do embed NÃO é saneado na query (comentário de
// `queries/cardapios.ts:34-38`): a defesa é `itemAberto` nunca casar um índice
// fora de 0..6 contra `diaIndex` (que é sempre 0..6). Prova o FAIL-CLOSED: dado
// corrompido nunca abre o item em dia nenhum — nunca o oposto (fail-open, que
// venderia o item todo santo dia por acidente de dado).
describe("273/RN-01 — itemAberto com dias_semana fora de 0..6 (dado antigo/corrompido)", () => {
  it("só valores inválidos ⇒ NUNCA abre, mesmo com o cardápio aberto todo dia", async () => {
    const { itemAberto } = await carregarMotor();
    const vinculo = { cardapio: ESPECIAIS_DO_DIA, dias_semana: [9, -1] };
    for (const agora of [SEGUNDA, QUARTA, SABADO]) {
      expect(itemAberto(vinculo, agora, SP)).toBe(false);
    }
  });

  it("um valor inválido ao lado de um válido não estraga o dia válido", async () => {
    const { itemAberto } = await carregarMotor();
    const vinculo = { cardapio: ESPECIAIS_DO_DIA, dias_semana: [9, 3] };
    expect(itemAberto(vinculo, QUARTA, SP)).toBe(true);
    expect(itemAberto(vinculo, SEGUNDA, SP)).toBe(false);
  });
});

describe("273/RN-02 — avaliarVigenciaDoProduto: união sobre VÍNCULOS", () => {
  it("quarta: a Feijoada {qua, sáb} do cardápio aberto os 7 dias é comprável", async () => {
    const avaliar = await carregarAvaliar();
    expect(
      avaliar(EXCLUSIVO, [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }], QUARTA, SP),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });

  it("segunda: fora da janela, mas CONTINUA na vitrine, marcada (RN-03)", async () => {
    const avaliar = await carregarAvaliar();
    expect(
      avaliar(EXCLUSIVO, [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }], SEGUNDA, SP),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: true });
  });

  it("vínculo sem dias herda o cardápio — byte a byte o comportamento de hoje", async () => {
    const avaliar = await carregarAvaliar();
    for (const dias of [null, []] as (number[] | null)[]) {
      expect(
        avaliar(EXCLUSIVO, [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: dias }], SEGUNDA, SP),
      ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
    }
  });

  it("interseção vazia: nunca comprável, e AINDA ASSIM visível (lacuna deliberada de RN-03)", async () => {
    const avaliar = await carregarAvaliar();
    // `voltaAAbrir` é propriedade do VÍNCULO e ignora `dias_semana` de propósito:
    // encodar o dia do item aqui criaria a 2ª casa de RN-02 da spec-mãe.
    // O aviso do painel (RN-06) é a issue 276 — não é este predicado.
    for (const agora of [SEGUNDA, QUARTA, SABADO]) {
      expect(avaliar(EXCLUSIVO, [{ cardapio: SO_FIM_DE_SEMANA, dias_semana: [3] }], agora, SP)).toEqual(
        { dentroDaJanela: false, visivelNaVitrine: true },
      );
    }
  });

  it("basta UM vínculo aberto: pôr o produto em mais um cardápio nunca reduz disponibilidade", async () => {
    const avaliar = await carregarAvaliar();
    const r = avaliar(
      EXCLUSIVO,
      [
        { cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }, // fechado na segunda
        { cardapio: ESPECIAIS_DO_DIA, dias_semana: [1] }, // aberto na segunda
      ],
      SEGUNDA,
      SP,
    );
    expect(r.dentroDaJanela).toBe(true);
  });

  it("cardápio INATIVO é ignorado inteiro, com dias de item ou sem", async () => {
    const avaliar = await carregarAvaliar();
    expect(
      avaliar(
        EXCLUSIVO,
        [{ cardapio: { ...ESPECIAIS_DO_DIA, ativo: false }, dias_semana: [3] }],
        QUARTA,
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: false });
  });

  it("produto 'menu' curto-circuita ANTES de olhar vínculo nenhum (RN-02)", async () => {
    const avaliar = await carregarAvaliar();
    expect(
      avaliar(
        { visibilidade: "menu" },
        [{ cardapio: SO_FIM_DE_SEMANA, dias_semana: [3] }],
        SEGUNDA,
        SP,
      ),
    ).toEqual({ dentroDaJanela: true, visivelNaVitrine: true });
  });
});

// [testar/273] Lacuna: o caso 4a (linha ~394) já prova prazo fixo expirado ⇒
// some, mas só com `semDias` (vínculo sem dias do item). Este teste repete o
// MESMO instante com o item marcado {qua} — dia que, isolado, ACONTECE de
// existir toda semana — para provar que `voltaAAbrir` de fato IGNORA
// `dias_semana` do vínculo mesmo quando ele não é vazio (D5, deliberado): se
// alguém "consertasse" `voltaAAbrir` para also-abrir quando o item tem dias
// marcados, este produto pararia de sumir de um cardápio que já encerrou.
describe("273/RN-03 — voltaAAbrir ignora dias_semana do item também no prazo fixo EXPIRADO", () => {
  it("prazo fixo EXPIRADO + item com dias marcados (não vazio) ⇒ some da vitrine do mesmo jeito", async () => {
    const avaliar = await carregarAvaliar();
    expect(
      avaliar(
        EXCLUSIVO,
        [{ cardapio: inverno, dias_semana: [3] }],
        emSP("2026-12-20T12:00"),
        SP,
      ),
    ).toEqual({ dentroDaJanela: false, visivelNaVitrine: false });
  });
});
