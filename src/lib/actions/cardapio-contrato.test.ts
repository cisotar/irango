import { describe, it, expect } from "vitest";

/**
 * Cobertura pós-GREEN da issue 269 — o módulo NEUTRO `cardapio-contrato.ts`
 * não tinha teste dedicado nenhum: era exercitado só por tabela através das
 * Server Actions do lojista (`cardapio.ts`) e do admin
 * (`admin-cardapios.paridade.test.ts`, que mocka o client inteiro). Este
 * arquivo prova as funções PURAS na ponta — sem I/O, sem mock de banco — para
 * que uma regressão aqui quebre no lugar mais barato de diagnosticar.
 *
 * Foco de segurança (RN-04 + D2): `linhaDoCardapio` é o único ponto que
 * decide se o `prazo_fim` gravado é o do CLIENTE ou o RECALCULADO pelo
 * servidor — um bug aqui vale para os DOIS mundos de escrita ao mesmo tempo,
 * porque cardapio.ts e admin-cardapios.ts chamam a MESMA função.
 */

import {
  linhaDoCardapio,
  resumirPrevia,
  ehErroDeExclusivoOrfao,
  erroDoLote,
  erroDeParseCardapio,
  MSG_GENERICA_LOTE,
  MSG_ORFAO_NO_LOTE,
  MSG_INVALIDO,
  type LinhaDaPrevia,
} from "./cardapio-contrato";
import {
  MSG_SEM_EIXO,
  MSG_PRAZO_ORDEM,
} from "@/lib/validacoes/cardapio";
import type { DadosCardapio } from "@/lib/validacoes/cardapio";

const FUSO_SP = "America/Sao_Paulo"; // UTC-3
const FUSO_MANAUS = "America/Manaus"; // UTC-4

function recorrente(over: Partial<DadosCardapio> = {}): DadosCardapio {
  return {
    nome: "Fim de semana",
    modo: "recorrente",
    dias_semana: [6, 0],
    dias_mes: null,
    hora_inicio: "11:00",
    hora_fim: "15:00",
    prazo_inicio: null,
    prazo_fim: null,
    prazo_preset: null,
    ...over,
  };
}

function prazoFixo(over: Partial<DadosCardapio> = {}): DadosCardapio {
  return {
    nome: "Natal",
    modo: "prazo_fixo",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: "2026-12-20T00:00",
    prazo_fim: null,
    prazo_preset: "customizado",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════ linhaDoCardapio

describe("linhaDoCardapio — modo recorrente: passa direto, sem tocar prazo", () => {
  it("devolve os dados tal qual — nenhuma conversão de fuso acontece", () => {
    const dados = recorrente();
    expect(linhaDoCardapio(dados, FUSO_SP)).toEqual(dados);
  });
});

describe("linhaDoCardapio — guarda defensiva: prazo_fixo sem prazo_inicio", () => {
  it("prazo_inicio null (estado que o schema não deveria produzir) devolve os dados tal qual", () => {
    const dados = prazoFixo({ prazo_inicio: null, prazo_preset: "diario" });
    expect(linhaDoCardapio(dados, FUSO_SP)).toEqual(dados);
  });
});

describe("linhaDoCardapio — preset customizado: o fim é o do CLIENTE", () => {
  it("converte início E fim informados, sem recalcular", () => {
    const dados = prazoFixo({
      prazo_preset: "customizado",
      prazo_inicio: "2026-12-20T00:00",
      prazo_fim: "2026-12-26T00:00",
    });

    const linha = linhaDoCardapio(dados, FUSO_SP);

    // América/São_Paulo é UTC-3: meia-noite local ⇒ 03:00Z.
    expect(linha.prazo_inicio).toBe("2026-12-20T03:00:00.000Z");
    expect(linha.prazo_fim).toBe("2026-12-26T03:00:00.000Z");
  });
});

describe("linhaDoCardapio — RN-04: presets diario/semanal/mensal RECALCULAM e DESCARTAM o fim do cliente", () => {
  it("preset `diario`: prazo_fim vira início + 1 dia, IGNORANDO um prazo_fim forjado no payload", () => {
    const dados = prazoFixo({
      prazo_preset: "diario",
      prazo_inicio: "2026-12-20T00:00",
      // Forjado: se o servidor confiasse nisto, o cardápio duraria um ano.
      prazo_fim: "2027-12-20T00:00",
    });

    const linha = linhaDoCardapio(dados, FUSO_SP);

    expect(linha.prazo_inicio).toBe("2026-12-20T03:00:00.000Z");
    expect(linha.prazo_fim).toBe("2026-12-21T03:00:00.000Z");
    expect(linha.prazo_fim).not.toBe("2027-12-20T03:00:00.000Z");
  });

  it("preset `semanal`: prazo_fim vira início + 7 dias, mesmo com prazo_fim do cliente ausente", () => {
    const dados = prazoFixo({
      prazo_preset: "semanal",
      prazo_inicio: "2026-12-20T00:00",
      prazo_fim: null,
    });

    const linha = linhaDoCardapio(dados, FUSO_SP);

    expect(linha.prazo_fim).toBe("2026-12-27T03:00:00.000Z");
  });

  it("preset `mensal`: clamp de fim de mês (31/01 → 28/02), fórmula de calcularFimDoPreset", () => {
    const dados = prazoFixo({
      prazo_preset: "mensal",
      prazo_inicio: "2026-01-31T00:00",
    });

    const linha = linhaDoCardapio(dados, FUSO_SP);

    // 2026 não é bissexto: 31/01 + 1 mês clampado para 28/02.
    expect(linha.prazo_fim).toBe("2026-02-28T03:00:00.000Z");
  });
});

describe("linhaDoCardapio — o fuso é o da LOJA-ALVO, lido do banco, nunca um offset fixo", () => {
  it("o MESMO horário local produz instantes UTC diferentes conforme o timezone recebido", () => {
    const dados = prazoFixo({
      prazo_preset: "diario",
      prazo_inicio: "2026-12-20T00:00",
    });

    const emSaoPaulo = linhaDoCardapio(dados, FUSO_SP);
    const emManaus = linhaDoCardapio(dados, FUSO_MANAUS);

    expect(emSaoPaulo.prazo_inicio).toBe("2026-12-20T03:00:00.000Z");
    expect(emManaus.prazo_inicio).toBe("2026-12-20T04:00:00.000Z");
    expect(emSaoPaulo.prazo_inicio).not.toBe(emManaus.prazo_inicio);
  });
});

// ═══════════════════════════════════════════════════════════ resumirPrevia

function produtoPrevia(over: Partial<LinhaDaPrevia> = {}): LinhaDaPrevia {
  return { nome: "Produto", visibilidade: "menu", oculto: false, ...over };
}

describe("resumirPrevia — array vazio", () => {
  it("devolve todas as contagens zeradas e nomes vazio", () => {
    expect(resumirPrevia([])).toEqual({
      total: 0,
      nomes: [],
      menu: 0,
      cardapio: 0,
      ocultos: 0,
    });
  });
});

describe("resumirPrevia — contagens", () => {
  it("total é o tamanho do array e as três contagens somam os subconjuntos certos", () => {
    const linhas = [
      produtoPrevia({ nome: "A", visibilidade: "menu", oculto: false }),
      produtoPrevia({ nome: "B", visibilidade: "cardapio", oculto: true }),
      produtoPrevia({ nome: "C", visibilidade: "cardapio", oculto: false }),
      produtoPrevia({ nome: "D", visibilidade: "menu", oculto: true }),
    ];

    const resumo = resumirPrevia(linhas);

    expect(resumo.total).toBe(4);
    expect(resumo.menu).toBe(2);
    expect(resumo.cardapio).toBe(2);
    expect(resumo.ocultos).toBe(2);
  });

  it("mais de 6 produtos: `nomes` trava em 6, mas `total` continua sendo o real", () => {
    const linhas = Array.from({ length: 9 }, (_, i) =>
      produtoPrevia({ nome: `Produto ${i + 1}` }),
    );

    const resumo = resumirPrevia(linhas);

    expect(resumo.total).toBe(9);
    expect(resumo.nomes).toHaveLength(6);
    expect(resumo.nomes).toEqual([
      "Produto 1",
      "Produto 2",
      "Produto 3",
      "Produto 4",
      "Produto 5",
      "Produto 6",
    ]);
  });

  it("exatamente 6 produtos: nenhum é cortado", () => {
    const linhas = Array.from({ length: 6 }, (_, i) =>
      produtoPrevia({ nome: `Produto ${i + 1}` }),
    );

    expect(resumirPrevia(linhas).nomes).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════ ehErroDeExclusivoOrfao

describe("ehErroDeExclusivoOrfao — reconhece só o PAR código + fragmento", () => {
  it("code 23000 + fragmento literal ⇒ true", () => {
    expect(
      ehErroDeExclusivoOrfao({
        code: "23000",
        message: 'produto exclusivo sem cardapio (produto "x", loja "y")',
      }),
    ).toBe(true);
  });

  it("code certo mas mensagem SEM o fragmento ⇒ false (outro erro 23000 qualquer)", () => {
    expect(
      ehErroDeExclusivoOrfao({ code: "23000", message: "outra violação de integridade" }),
    ).toBe(false);
  });

  it("fragmento presente mas code errado ⇒ false (não é o trigger)", () => {
    expect(
      ehErroDeExclusivoOrfao({
        code: "23503",
        message: "produto exclusivo sem cardapio",
      }),
    ).toBe(false);
  });

  it("null, undefined e não-objeto ⇒ false, nunca lança", () => {
    expect(ehErroDeExclusivoOrfao(null)).toBe(false);
    expect(ehErroDeExclusivoOrfao(undefined)).toBe(false);
    expect(ehErroDeExclusivoOrfao("erro string")).toBe(false);
    expect(ehErroDeExclusivoOrfao(42)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════ erroDoLote

describe("erroDoLote — RN-14 vira frase própria; todo o resto é genérico", () => {
  it("erro de produto exclusivo sem cardápio ⇒ MSG_ORFAO_NO_LOTE", () => {
    const erro = {
      code: "23000",
      message: "produto exclusivo sem cardapio",
    };
    expect(erroDoLote(erro)).toBe(MSG_ORFAO_NO_LOTE);
  });

  it("qualquer outro erro (rede, 23514, undefined) ⇒ MSG_GENERICA_LOTE", () => {
    expect(erroDoLote(new Error("timeout"))).toBe(MSG_GENERICA_LOTE);
    expect(erroDoLote({ code: "23514", message: "check falhou" })).toBe(MSG_GENERICA_LOTE);
    expect(erroDoLote(undefined)).toBe(MSG_GENERICA_LOTE);
  });
});

// ═════════════════════════════════════════════════════ erroDeParseCardapio

describe("erroDeParseCardapio — só as frases de vigência de §9.6 são promovidas", () => {
  it("issue com mensagem de vigência ⇒ a frase literal sobrevive", () => {
    expect(erroDeParseCardapio([{ message: MSG_SEM_EIXO }])).toBe(MSG_SEM_EIXO);
    expect(erroDeParseCardapio([{ message: MSG_PRAZO_ORDEM }])).toBe(MSG_PRAZO_ORDEM);
  });

  it("issue de parse qualquer, sem mensagem de vigência ⇒ MSG_INVALIDO genérica", () => {
    expect(erroDeParseCardapio([{ message: "Expected string, received number" }])).toBe(
      MSG_INVALIDO,
    );
  });

  it("array de issues vazio ⇒ MSG_INVALIDO (nunca lança em .find de array vazio)", () => {
    expect(erroDeParseCardapio([])).toBe(MSG_INVALIDO);
  });

  it("mistura: a primeira issue de vigência encontrada vence, mesmo não sendo a primeira do array", () => {
    const issues = [
      { message: "campo obrigatório" },
      { message: MSG_PRAZO_ORDEM },
      { message: "outro erro qualquer" },
    ];
    expect(erroDeParseCardapio(issues)).toBe(MSG_PRAZO_ORDEM);
  });
});
