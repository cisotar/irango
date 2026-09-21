/**
 * [264/RN-12] O cenário 6 do spec, literal: "Cardápio de Inverno" (prazo fixo
 * 01/06/2026 → 01/09/2026) em 20/12/2026, com a Sopa de cebola (`'cardapio'`)
 * e a Coca-Cola 2L (`'menu'`) dentro ⇒ `{ doMenu: 1, sumidos: 1 }`.
 */
import { describe, expect, it } from "vitest";

import { instanteNoFuso } from "./fusoLoja";
import {
  contarProdutosEscondidos,
  diagnosticarSumico,
  listarProdutosEscondidos,
  type ProdutoContado,
} from "./contarProdutosEscondidos";
import type { CardapioVigencia, VinculoVigencia } from "./vigenciaCardapio";

const SP = "America/Sao_Paulo";
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));

const INVERNO: CardapioVigencia = {
  id: "inverno",
  nome: "Cardápio de Inverno",
  ativo: true,
  modo: "prazo_fixo",
  dias_semana: null,
  dias_mes: null,
  hora_inicio: null,
  hora_fim: null,
  prazo_inicio: instanteNoFuso("2026-06-01T00:00", SP),
  prazo_fim: instanteNoFuso("2026-09-01T00:00", SP),
};

/** O MESMO cardápio, guardado pelo lojista em vez de expirado (RN-03). */
const INVERNO_DESLIGADO: CardapioVigencia = {
  ...INVERNO,
  ativo: false,
  prazo_fim: instanteNoFuso("2027-09-01T00:00", SP),
};

const SOPA: ProdutoContado = {
  id: "sopa",
  nome: "Sopa de cebola",
  visibilidade: "cardapio",
};
const COCA: ProdutoContado = {
  id: "coca",
  nome: "Coca-Cola 2L",
  visibilidade: "menu",
};

const DEZEMBRO = emSP("2026-12-20T12:00");
const JULHO = emSP("2026-07-15T12:00");

/**
 * [273] O vínculo SEM dias do item — a forma de 100% das linhas no deploy da
 * 272. A contagem tem de continuar byte a byte a de antes do eixo mudar.
 */
const semDias = (cardapio: CardapioVigencia): VinculoVigencia => ({
  cardapio,
  dias_semana: null,
});

function vinculos(
  cardapio: CardapioVigencia,
): Map<string, VinculoVigencia[]> {
  return new Map([
    ["sopa", [semDias(cardapio)]],
    ["coca", [semDias(cardapio)]],
  ]);
}

describe("264 contarProdutosEscondidos — cenário 6", () => {
  it("cardápio EXPIRADO ⇒ { doMenu: 1, sumidos: 1 }", () => {
    expect(
      contarProdutosEscondidos(
        INVERNO,
        [SOPA, COCA],
        vinculos(INVERNO),
        DEZEMBRO,
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 1 });
  });

  it("DESLIGAR produz exatamente o mesmo par — um predicado só (RN-03/RN-13)", () => {
    expect(
      contarProdutosEscondidos(
        INVERNO_DESLIGADO,
        [SOPA, COCA],
        vinculos(INVERNO_DESLIGADO),
        JULHO,
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 1 });
  });

  it("cardápio EM CURSO não esconde ninguém — só o que fica é contado", () => {
    expect(
      contarProdutosEscondidos(
        INVERNO,
        [SOPA, COCA],
        vinculos(INVERNO),
        JULHO,
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 0 });
  });

  it("cardápio que AINDA VAI abrir não esconde ninguém (RN-13: há volta)", () => {
    expect(
      contarProdutosEscondidos(
        INVERNO,
        [SOPA, COCA],
        vinculos(INVERNO),
        emSP("2026-03-01T12:00"),
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 0 });
  });

  it("exclusivo que também está num cardápio ABERTO não sumiu", () => {
    const verao: CardapioVigencia = {
      ...INVERNO,
      id: "verao",
      nome: "Cardápio de Verão",
      prazo_inicio: instanteNoFuso("2026-12-01T00:00", SP),
      prazo_fim: instanteNoFuso("2027-03-01T00:00", SP),
    };

    expect(
      contarProdutosEscondidos(
        INVERNO,
        [SOPA, COCA],
        new Map([
          ["sopa", [semDias(INVERNO), semDias(verao)]],
          ["coca", [semDias(INVERNO)]],
        ]),
        DEZEMBRO,
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 0 });
  });

  it("produto de OUTRO cardápio não entra em nenhuma das duas contagens", () => {
    const deOutro: ProdutoContado = {
      id: "outro",
      nome: "Pastel",
      visibilidade: "cardapio",
    };
    const mapa = vinculos(INVERNO);
    mapa.set("outro", [
      semDias({ ...INVERNO, id: "feira", nome: "Feira", ativo: false }),
    ]);

    expect(
      contarProdutosEscondidos(INVERNO, [SOPA, COCA, deOutro], mapa, DEZEMBRO, SP),
    ).toEqual({ doMenu: 1, sumidos: 1 });
  });

  it("`visibilidade` desconhecida lê como 'menu' (fail-open de 247/D6)", () => {
    const estranho: ProdutoContado = {
      id: "sopa",
      nome: "Sopa de cebola",
      visibilidade: "temporada-2026",
    };

    expect(
      contarProdutosEscondidos(
        INVERNO,
        [estranho],
        vinculos(INVERNO),
        DEZEMBRO,
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 0 });
  });
});

describe("264 listarProdutosEscondidos — o número e os nomes saem do mesmo lugar", () => {
  it("nomeia exatamente os sumidos, na ordem de entrada", () => {
    const escondidos = listarProdutosEscondidos(
      INVERNO,
      [SOPA, COCA],
      vinculos(INVERNO),
      DEZEMBRO,
      SP,
    );

    expect(escondidos.map((p) => p.nome)).toEqual(["Sopa de cebola"]);
    expect(escondidos).toHaveLength(
      contarProdutosEscondidos(INVERNO, [SOPA, COCA], vinculos(INVERNO), DEZEMBRO, SP)
        .sumidos,
    );
  });
});

describe("264 diagnosticarSumico — o mesmo estado, visto do produto", () => {
  it("exclusivo de cardápio expirado ⇒ nomeia o cardápio e diz que segue ligado", () => {
    expect(diagnosticarSumico(SOPA, [semDias(INVERNO)], DEZEMBRO, SP)).toEqual({
      cardapio: "Cardápio de Inverno",
      ativo: true,
    });
  });

  it("exclusivo de cardápio DESLIGADO ⇒ mesmo diagnóstico, `ativo: false`", () => {
    expect(
      diagnosticarSumico(SOPA, [semDias(INVERNO_DESLIGADO)], JULHO, SP),
    ).toEqual({ cardapio: "Cardápio de Inverno", ativo: false });
  });

  it("produto do MENU nunca sumiu — RN-05 curto-circuita", () => {
    expect(diagnosticarSumico(COCA, [semDias(INVERNO)], DEZEMBRO, SP)).toBeNull();
  });

  it("exclusivo com cardápio em curso não sumiu", () => {
    expect(diagnosticarSumico(SOPA, [semDias(INVERNO)], JULHO, SP)).toBeNull();
  });

  it("é determinístico: com dois cardápios sem volta, sempre o mesmo nome", () => {
    const outro: CardapioVigencia = { ...INVERNO, id: "a", nome: "Aniversário" };
    const lista = [semDias(INVERNO), semDias(outro)];

    expect(diagnosticarSumico(SOPA, lista, DEZEMBRO, SP)?.cardapio).toBe(
      "Aniversário",
    );
    expect(diagnosticarSumico(SOPA, [...lista].reverse(), DEZEMBRO, SP)?.cardapio).toBe(
      "Aniversário",
    );
  });
});
