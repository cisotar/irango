/**
 * [264/RN-12] A copy do aviso, byte a byte. Sem jsdom, este arquivo é a única
 * trava possível — e a ORDEM que ele afirma é requisito de produto, não estilo.
 */
import { describe, expect, it } from "vitest";

import {
  avisoCardapioEscondendo,
  fraseAgendaDoItem,
  fraseEstaEm,
  avisoNaLinhaDoProduto,
  fraseContinuamVendendo,
  fraseExclusividade,
  fraseSumiram,
  rotuloDevolverAoMenu,
  rotuloReligarOuEstender,
  tituloDevolverAoMenu,
} from "./copiaCardapioPainel";

describe("264 avisoCardapioEscondendo — o texto do design §13.4", () => {
  it("o exemplo do design, literal (4 sumiram, 7 continuam)", () => {
    expect(avisoCardapioEscondendo({ doMenu: 7, sumidos: 4 })).toEqual([
      "4 produtos sumiram da vitrine",
      "Eles são exclusivos deste cardápio.",
      "Outros 7 produtos do menu continuam aparecendo e vendendo normalmente.",
    ]);
  });

  it("o que SUMIU vem antes do que CONTINUA VENDENDO — sempre", () => {
    const linhas = avisoCardapioEscondendo({ doMenu: 7, sumidos: 4 }) ?? [];

    const sumiu = linhas.findIndex((l) => l.includes("sumiram"));
    const continua = linhas.findIndex((l) => l.includes("continuam"));
    expect(sumiu).toBeGreaterThanOrEqual(0);
    expect(sumiu).toBeLessThan(continua);
  });

  it("cenário 6: 1 sumiu, 1 do menu — singular nas três linhas", () => {
    expect(avisoCardapioEscondendo({ doMenu: 1, sumidos: 1 })).toEqual([
      "1 produto sumiu da vitrine",
      "Ele é exclusivo deste cardápio.",
      "Outro produto do menu continua aparecendo e vendendo normalmente.",
    ]);
  });

  it("sem produto do menu, o aviso tem só as duas primeiras linhas", () => {
    expect(avisoCardapioEscondendo({ doMenu: 0, sumidos: 2 })).toEqual([
      "2 produtos sumiram da vitrine",
      "Eles são exclusivos deste cardápio.",
    ]);
  });

  it("nada sumiu ⇒ nenhum aviso (aviso que aparece sempre não é lido nunca)", () => {
    expect(avisoCardapioEscondendo({ doMenu: 9, sumidos: 0 })).toBeNull();
  });

  it("nunca usa vermelho nem fala em erro/falha (§13.4 item 4)", () => {
    const texto = (avisoCardapioEscondendo({ doMenu: 7, sumidos: 4 }) ?? []).join(" ");

    expect(texto.toLowerCase()).not.toContain("erro");
    expect(texto.toLowerCase()).not.toContain("falha");
  });
});

describe("264 as peças da copy, isoladas", () => {
  it("fraseSumiram flexiona no singular exato de 1", () => {
    expect(fraseSumiram(1)).toBe("1 produto sumiu da vitrine");
    expect(fraseSumiram(2)).toBe("2 produtos sumiram da vitrine");
  });

  it("fraseExclusividade concorda com o número", () => {
    expect(fraseExclusividade(1)).toBe("Ele é exclusivo deste cardápio.");
    expect(fraseExclusividade(4)).toBe("Eles são exclusivos deste cardápio.");
  });

  it("fraseContinuamVendendo é null em zero", () => {
    expect(fraseContinuamVendendo(0)).toBeNull();
    expect(fraseContinuamVendendo(-1)).toBeNull();
  });
});

describe("264 as duas saídas a um clique", () => {
  it("desligado oferece religar; expirado (ativo) oferece estender", () => {
    expect(rotuloReligarOuEstender(false)).toBe("Religar o cardápio");
    expect(rotuloReligarOuEstender(true)).toBe("Estender o prazo");
  });

  it("o rótulo de devolver carrega o número", () => {
    expect(rotuloDevolverAoMenu(4)).toBe("Devolver os 4 ao menu");
    expect(rotuloDevolverAoMenu(1)).toBe("Devolver 1 ao menu");
  });

  it("o diálogo pergunta antes — nada é convertido pelo clique do aviso", () => {
    expect(tituloDevolverAoMenu(4)).toBe("Devolver 4 produtos ao menu?");
    expect(tituloDevolverAoMenu(1)).toBe("Devolver 1 produto ao menu?");
  });
});

describe("264 aviso reduzido na linha do produto (§13.4 item 5)", () => {
  it("expirado: o texto literal do design", () => {
    expect(avisoNaLinhaDoProduto("Cardápio de Inverno", true)).toBe(
      "sumiu da vitrine — o cardápio Cardápio de Inverno expirou",
    );
  });

  it("desligado: o mesmo aviso, com o verbo verdadeiro", () => {
    expect(avisoNaLinhaDoProduto("Cardápio de Inverno", false)).toBe(
      "sumiu da vitrine — o cardápio Cardápio de Inverno foi desligado",
    );
  });
});

/**
 * [276] A linha de agenda do produto vinculado. `null` NÃO vira "(todos os
 * dias)" pendurado: vira a frase que explica o estado vazio.
 */
describe("fraseAgendaDoItem (276)", () => {
  it("com dias, prefixa a redação que veio do servidor", () => {
    expect(fraseAgendaDoItem("qua e sáb")).toBe("Aparece: qua e sáb");
    expect(fraseAgendaDoItem("seg a sex")).toBe("Aparece: seg a sex");
  });

  it("sem dias, diz que o item segue o cardápio", () => {
    expect(fraseAgendaDoItem(null)).toBe("Todos os dias do cardápio");
  });
});

/**
 * [278/RN-13] A linha "Está em:" inteira, byte a byte — incluindo a pontuação
 * final, que num `join` dentro do JSX ninguém trava.
 */
describe("fraseEstaEm (278)", () => {
  it("um cardápio com dias", () => {
    expect(
      fraseEstaEm([{ nome: "Especiais do Dia", rotuloDias: "qua e sáb" }]),
    ).toBe("Está em: Especiais do Dia (qua e sáb).");
  });

  it("um cardápio sem dias não ganha sufixo nenhum", () => {
    expect(fraseEstaEm([{ nome: "Cardápio de Inverno", rotuloDias: null }])).toBe(
      "Está em: Cardápio de Inverno.",
    );
  });

  it("vários cardápios, só alguns com dias", () => {
    expect(
      fraseEstaEm([
        { nome: "Especiais do Dia", rotuloDias: "qua e sáb" },
        { nome: "Cardápio de Inverno", rotuloDias: null },
      ]),
    ).toBe("Está em: Especiais do Dia (qua e sáb), Cardápio de Inverno.");
  });

  it("lista vazia devolve string vazia (o caller nem renderiza a linha)", () => {
    expect(fraseEstaEm([])).toBe("");
  });
});
