// [238/D11] A copy da reconfirmação de preço, nos DOIS sentidos.
//
// O teste que importa não é o texto bonito: é o que o texto NÃO pode conter.
// A promoção acabou porque o lojista marcou uma data — nem culpa do cliente,
// nem defeito do sistema.

import { describe, it, expect } from "vitest";

import {
  descricaoMudanca,
  textosRevisao,
  ROTULO_NOVO_TOTAL,
  ROTULO_VOLTAR,
  type MudancaItem,
} from "./copiaRevisaoPreco";

const FEIJOADA: MudancaItem = {
  nome: "Feijoada completa",
  de: 80,
  para: 100,
};
const FEIJOADA_BARATEOU: MudancaItem = {
  nome: "Feijoada completa",
  de: 100,
  para: 80,
};

/** As palavras proibidas em QUALQUER string dos dois sentidos. */
const PROIBIDAS = ["erro", "falha", "desculpe", "não foi possível"];

describe("[238/D11] preço SUBIU — segundo clique sobre o número novo", () => {
  const t = textosRevisao({
    direcao: "subiu",
    itens: [FEIJOADA],
    novoTotal: 150,
  });

  it("título e corpo nomeiam o item, sem culpar ninguém", () => {
    expect(t.titulo).toBe("O preço de um item mudou");
    expect(t.corpo).toBe("A promoção da Feijoada completa terminou.");
  });

  it("o NÚMERO vai dentro do rótulo do CTA", () => {
    expect(t.rotuloCta).toBe("Confirmar e enviar — R$ 150,00");
  });

  it("mais de um item: a frase conta, não lista", () => {
    const varios = textosRevisao({
      direcao: "subiu",
      itens: [FEIJOADA, { nome: "Pizza", de: 40, para: 50 }],
      novoTotal: 200,
    });
    expect(varios.corpo).toBe(
      "As promoções de 2 itens do seu pedido terminaram.",
    );
  });

  it("o par de/para vai por extenso para o leitor de tela", () => {
    expect(descricaoMudanca(FEIJOADA)).toBe(
      "Feijoada completa: de R$ 80,00 por R$ 100,00",
    );
  });
});

describe("[238/D11] preço CAIU — só avisa, sem botão", () => {
  const t = textosRevisao({
    direcao: "caiu",
    itens: [FEIJOADA_BARATEOU],
    novoTotal: 130,
  });

  it("é boa notícia, e traz o de/para e o novo total", () => {
    expect(t.titulo).toBe("Boa notícia: a Feijoada completa entrou em promoção.");
    expect(t.corpo).toBe(
      "De R$ 100,00 por R$ 80,00. Novo total estimado: R$ 130,00.",
    );
  });

  it("SEM CTA: o pedido segue, nada é pedido ao cliente", () => {
    expect(t.rotuloCta).toBeNull();
  });
});

describe("[238] 🔴 nenhuma linguagem de erro, nos dois sentidos", () => {
  it("nenhuma string contém erro/falha/desculpe/não foi possível", () => {
    const todas = (["subiu", "caiu"] as const).flatMap((direcao) => {
      const t = textosRevisao({ direcao, itens: [FEIJOADA], novoTotal: 150 });
      return [t.titulo, t.corpo, t.rotuloCta ?? ""];
    });
    todas.push(
      ROTULO_NOVO_TOTAL,
      ROTULO_VOLTAR,
      descricaoMudanca(FEIJOADA),
      textosRevisao({
        direcao: "subiu",
        itens: [FEIJOADA, FEIJOADA_BARATEOU],
        novoTotal: 1,
      }).corpo,
    );
    for (const s of todas) {
      for (const palavra of PROIBIDAS) {
        expect(s.toLowerCase()).not.toContain(palavra);
      }
    }
  });
});
