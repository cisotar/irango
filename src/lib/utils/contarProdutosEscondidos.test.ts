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

// ═════════════════════════════════════════════════════════════════════════════
// [280/RN-03] Caracterização POR VÍNCULO: com agenda de item, "fora do dia"
// NÃO é "sumiu". O predicado continua sendo um só — `avaliarVigenciaDoProduto`
// (273) —, e estes testes existem para travar que ninguém acrescente um
// segundo critério de dia dentro de `contarProdutosEscondidos.ts`.
// ═════════════════════════════════════════════════════════════════════════════

/** "Especiais do Dia": recorrente, ativo, sem restrição de dia — abre sempre. */
const ESPECIAIS: CardapioVigencia = {
  id: "especiais",
  nome: "Especiais do Dia",
  ativo: true,
  modo: "recorrente",
  dias_semana: null,
  dias_mes: null,
  hora_inicio: null,
  hora_fim: null,
  prazo_inicio: null,
  prazo_fim: null,
};

const comDias = (
  cardapio: CardapioVigencia,
  dias: number[],
): VinculoVigencia => ({ cardapio, dias_semana: dias });

/** Os 7 dias da semana de 18/10/2026 (domingo) a 24/10/2026 (sábado), ao meio-dia. */
const SEMANA = [18, 19, 20, 21, 22, 23, 24].map((d) =>
  emSP(`2026-10-${d}T12:00`),
);

describe("280 — exclusivo com agenda de ITEM nunca é 'escondido' (RN-03)", () => {
  /** Feijoada exclusiva de cardápio, servida só às quartas. */
  const soQuarta = new Map<string, VinculoVigencia[]>([
    ["sopa", [comDias(ESPECIAIS, [3])]],
    ["coca", [comDias(ESPECIAIS, [3])]],
  ]);

  it("em QUALQUER dia da semana ⇒ sumidos: 0 (alterna entre comprável e marcado)", () => {
    for (const agora of SEMANA) {
      expect(
        contarProdutosEscondidos(ESPECIAIS, [SOPA, COCA], soQuarta, agora, SP),
      ).toEqual({ doMenu: 1, sumidos: 0 });
    }
  });

  it("`listarProdutosEscondidos` não nomeia ninguém, nos 7 dias", () => {
    for (const agora of SEMANA) {
      expect(
        listarProdutosEscondidos(ESPECIAIS, [SOPA, COCA], soQuarta, agora, SP),
      ).toEqual([]);
    }
  });

  it("`diagnosticarSumico` ⇒ null: o painel não pinta aviso âmbar por dia", () => {
    for (const agora of SEMANA) {
      expect(
        diagnosticarSumico(SOPA, [comDias(ESPECIAIS, [3])], agora, SP),
      ).toBeNull();
    }
  });

  it("dois cardápios — um expirado, um recorrente com item {qua} ⇒ não sumiu", () => {
    const dois = new Map<string, VinculoVigencia[]>([
      ["sopa", [semDias(INVERNO), comDias(ESPECIAIS, [3])]],
      ["coca", [semDias(INVERNO)]],
    ]);

    // Terça 20/10: nem o Inverno (expirado) nem o item (quarta) estão abertos,
    // e mesmo assim o produto continua na vitrine — marcado, com volta.
    expect(
      contarProdutosEscondidos(INVERNO, [SOPA, COCA], dois, SEMANA[2], SP),
    ).toEqual({ doMenu: 1, sumidos: 0 });
  });
});

describe("280 — o que CONTINUA escondido, apesar da agenda de item", () => {
  it("prazo fixo EXPIRADO com item {qua} segue contado — não há volta", () => {
    const expirado = new Map<string, VinculoVigencia[]>([
      ["sopa", [comDias(INVERNO, [3])]],
      ["coca", [comDias(INVERNO, [3])]],
    ]);

    expect(
      contarProdutosEscondidos(INVERNO, [SOPA, COCA], expirado, DEZEMBRO, SP),
    ).toEqual({ doMenu: 1, sumidos: 1 });
    expect(
      diagnosticarSumico(SOPA, [comDias(INVERNO, [3])], DEZEMBRO, SP),
    ).toEqual({ cardapio: "Cardápio de Inverno", ativo: true });
  });

  it("cardápio DESLIGADO com item {qua} segue contado (RN-03)", () => {
    const desligado = new Map<string, VinculoVigencia[]>([
      ["sopa", [comDias({ ...ESPECIAIS, ativo: false }, [3])]],
      ["coca", [comDias({ ...ESPECIAIS, ativo: false }, [3])]],
    ]);

    // Quarta 21/10 — o dia do item bate, e não muda nada: desligado não abre,
    // não fecha e não restringe; `ativos` o descarta antes.
    expect(
      contarProdutosEscondidos(
        { ...ESPECIAIS, ativo: false },
        [SOPA, COCA],
        desligado,
        SEMANA[3],
        SP,
      ),
    ).toEqual({ doMenu: 1, sumidos: 1 });
  });
});

describe("280/RN-06 — interseção vazia: divergência CONHECIDA e aceita", () => {
  /** Cardápio {sáb,dom} com item {qua}: o item nunca fica comprável. */
  const FIM_DE_SEMANA: CardapioVigencia = {
    ...ESPECIAIS,
    id: "fds",
    nome: "Fim de semana",
    dias_semana: [6, 0],
  };
  const impossivel = new Map<string, VinculoVigencia[]>([
    ["sopa", [comDias(FIM_DE_SEMANA, [3])]],
    ["coca", [comDias(FIM_DE_SEMANA, [3])]],
  ]);

  // ⚠️ NÃO "consertar" baixando isto para `sumidos: 1`. `voltaAAbrir` ignora
  // `dias_semana` do ITEM DE PROPÓSITO (273): encodar o dia ali criaria a
  // segunda casa da regra de dia. A consequência é que este item fica visível
  // e marcado para sempre, sem nunca abrir — registrado na spec §Fora do
  // Escopo e endereçado pelo AVISO do painel, que é a issue [276] e outra
  // pergunta. Este teste trava a decisão, não o acerto.
  it("cardápio {sáb,dom} + item {qua} ⇒ sumidos: 0, nos 7 dias", () => {
    for (const agora of SEMANA) {
      expect(
        contarProdutosEscondidos(
          FIM_DE_SEMANA,
          [SOPA, COCA],
          impossivel,
          agora,
          SP,
        ),
      ).toEqual({ doMenu: 1, sumidos: 0 });
    }
  });

  it("e `diagnosticarSumico` também devolve null — as duas telas concordam", () => {
    expect(
      diagnosticarSumico(SOPA, [comDias(FIM_DE_SEMANA, [3])], SEMANA[0], SP),
    ).toBeNull();
  });
});
