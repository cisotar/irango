/**
 * [303/RN-02] Testes unitários de `dentroDaJanelaExibicao` (janelaModalSazonal.ts).
 *
 * Esta é a função usada na VITRINE PÚBLICA (page.tsx:316), com assinatura
 * `(modal: { exibicao_inicio, exibicao_fim }, agora)`. É diferente da homônima
 * em `estadoModalSazonal.ts` (painel), que recebe os campos separados.
 *
 * `agora` SEMPRE injetado — nenhum `new Date()` aqui, determinismo total.
 * `environment: node`, sem jsdom.
 */

import { describe, it, expect } from "vitest";
import { dentroDaJanelaExibicao } from "./janelaModalSazonal";

const INICIO = "2026-06-01T00:00:00.000Z";
const FIM = "2026-06-15T00:00:00.000Z";

function modal(
  over: Partial<{ exibicao_inicio: string; exibicao_fim: string }> = {},
) {
  return {
    exibicao_inicio: INICIO,
    exibicao_fim: FIM,
    ...over,
  };
}

describe("dentroDaJanelaExibicao — vitrine (janelaModalSazonal.ts)", () => {
  it("instante dentro da janela retorna true", () => {
    // Meio da janela — o caso nominal.
    const meioTerm = new Date("2026-06-07T12:00:00.000Z");
    expect(dentroDaJanelaExibicao(modal(), meioTerm)).toBe(true);
  });

  it("instante exatamente no início é INCLUSIVO (retorna true)", () => {
    // RN-02: `exibicao_inicio <= agora`, início inclusivo — mesma convenção
    // de `dentroDoPrazo` em vigenciaCardapio.ts.
    expect(dentroDaJanelaExibicao(modal(), new Date(INICIO))).toBe(true);
  });

  it("instante exatamente no fim é EXCLUSIVO (retorna false)", () => {
    // RN-02: `agora < exibicao_fim` — fim exclusivo.
    expect(dentroDaJanelaExibicao(modal(), new Date(FIM))).toBe(false);
  });

  it("instante antes da janela retorna false", () => {
    const antes = new Date("2026-05-31T23:59:59.000Z");
    expect(dentroDaJanelaExibicao(modal(), antes)).toBe(false);
  });

  it("1 ms antes do fim ainda está dentro (exclusividade do fim)", () => {
    // Prova a semântica exata: FIM - 1 ms está dentro, FIM não está.
    const umMsAntesFim = new Date(Date.parse(FIM) - 1);
    expect(dentroDaJanelaExibicao(modal(), umMsAntesFim)).toBe(true);
  });

  it("instante depois da janela retorna false", () => {
    const depois = new Date("2026-07-01T00:00:00.000Z");
    expect(dentroDaJanelaExibicao(modal(), depois)).toBe(false);
  });

  it("janela de exibicao_inicio e exibicao_fim com fuso explícito (-03:00) não afeta veredito", () => {
    // O modal vem do banco como timestamptz — comparação instante × instante;
    // o fuso da loja NÃO muda o resultado (os dois lados são convertidos para
    // milissegundos UTC antes da comparação).
    const inicioComFuso = "2026-06-01T00:00:00.000-03:00"; // UTC 03:00
    const fimComFuso = "2026-06-15T00:00:00.000-03:00"; // UTC 03:00
    // Instante equivalente ao início em UTC.
    const agoraNoInicio = new Date("2026-06-01T03:00:00.000Z");
    expect(
      dentroDaJanelaExibicao(
        { exibicao_inicio: inicioComFuso, exibicao_fim: fimComFuso },
        agoraNoInicio,
      ),
    ).toBe(true);
    // 1 ms antes do início: falso.
    const agoraAntes = new Date("2026-06-01T02:59:59.999Z");
    expect(
      dentroDaJanelaExibicao(
        { exibicao_inicio: inicioComFuso, exibicao_fim: fimComFuso },
        agoraAntes,
      ),
    ).toBe(false);
  });

  it("janela de um dia inteiro (início UTC 00:00, fim UTC 00:00 do dia seguinte)", () => {
    // Caso extremo: janela de exatamente 24 horas.
    const dia = { exibicao_inicio: "2026-10-01T00:00:00.000Z", exibicao_fim: "2026-10-02T00:00:00.000Z" };
    expect(dentroDaJanelaExibicao(dia, new Date("2026-10-01T00:00:00.000Z"))).toBe(true);
    expect(dentroDaJanelaExibicao(dia, new Date("2026-10-01T23:59:59.999Z"))).toBe(true);
    expect(dentroDaJanelaExibicao(dia, new Date("2026-10-02T00:00:00.000Z"))).toBe(false);
  });

  it("não lê o relógio: o comportamento varia apenas via `agora`", () => {
    // Prova determinismo: o mesmo modal, instantes diferentes, resultados opostos.
    const m = modal();
    expect(dentroDaJanelaExibicao(m, new Date("2026-05-01T00:00:00.000Z"))).toBe(false);
    expect(dentroDaJanelaExibicao(m, new Date("2026-06-10T00:00:00.000Z"))).toBe(true);
    expect(dentroDaJanelaExibicao(m, new Date("2026-07-01T00:00:00.000Z"))).toBe(false);
  });
});
