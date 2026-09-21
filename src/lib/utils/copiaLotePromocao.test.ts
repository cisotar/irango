import { describe, it, expect } from "vitest";
import {
  perguntaDias,
  perguntaLote,
  perguntaVisibilidade,
  frasesDeVisibilidade,
  fraseCategoriaEhFoto,
  fraseOcultos,
  fraseEMais,
} from "./copiaLotePromocao";

/**
 * [260] A copy do diálogo de lote (design §10.2). O que este arquivo trava:
 *
 *  1. o NÚMERO dentro do rótulo do botão — nunca "Confirmar";
 *  2. o número do rótulo é o que ENTROU por `total` (do servidor), não o
 *     tamanho de `nomes` (que o servidor corta em 6);
 *  3. as frases de D14 e a de "categoria é foto".
 */

describe("perguntaLote — adicionar", () => {
  it("põe o número dentro do rótulo do botão, nunca 'Confirmar'", () => {
    const copia = perguntaLote({
      acao: "adicionar",
      nomeCardapio: "Almoço executivo",
      nomes: ["Feijoada completa"],
      total: 12,
    });

    expect(copia.rotuloConfirmar).toBe("Adicionar 12 produtos");
    expect(copia.rotuloConfirmar).not.toMatch(/confirmar/i);
  });

  it("nomeia o cardápio no título", () => {
    expect(
      perguntaLote({
        acao: "adicionar",
        nomeCardapio: "Almoço executivo",
        nomes: [],
        total: 3,
      }).titulo,
    ).toBe("Adicionar ao cardápio “Almoço executivo”?");
  });

  it("diz a consequência no corpo, no plural", () => {
    expect(
      perguntaLote({
        acao: "adicionar",
        nomeCardapio: "X",
        nomes: [],
        total: 12,
      }).corpo,
    ).toBe("12 produtos vão passar a seguir a janela deste cardápio:");
  });

  it("concorda no singular", () => {
    const copia = perguntaLote({
      acao: "adicionar",
      nomeCardapio: "X",
      nomes: ["Feijoada"],
      total: 1,
    });
    expect(copia.corpo).toBe(
      "1 produto vai passar a seguir a janela deste cardápio:",
    );
    expect(copia.rotuloConfirmar).toBe("Adicionar 1 produto");
  });

  /**
   * 🔴 A trava de RN-09-a em forma de teste: o servidor corta `nomes` em 6, e
   * um rótulo derivado de `nomes.length` anunciaria "Adicionar 6 produtos"
   * para um lote de 40. O número tem de vir de `total`.
   */
  it("usa `total` no rótulo mesmo quando `nomes` vem cortado em 6", () => {
    const copia = perguntaLote({
      acao: "adicionar",
      nomeCardapio: "X",
      nomes: ["a", "b", "c", "d", "e", "f"],
      total: 40,
    });
    expect(copia.rotuloConfirmar).toBe("Adicionar 40 produtos");
    expect(copia.corpo).toContain("40 produtos");
  });

  it("não promete escrita quando a prévia do servidor veio vazia", () => {
    const copia = perguntaLote({
      acao: "adicionar",
      nomeCardapio: "X",
      nomes: [],
      total: 0,
    });
    expect(copia.corpo).toBe(
      "Nenhum produto desta seleção foi encontrado na sua loja.",
    );
    expect(copia.rotuloConfirmar).toBe("Nada a adicionar");
    expect(copia.rotuloConfirmar).not.toMatch(/\b0 produtos\b/);
  });
});

describe("perguntaLote — remover (a mesma ação ao contrário)", () => {
  it("inverte título, corpo e rótulo sem inventar 'desfazer'", () => {
    const copia = perguntaLote({
      acao: "remover",
      nomeCardapio: "Feijoada de sábado",
      nomes: ["Feijoada completa", "Torresmo"],
      total: 2,
    });

    expect(copia.titulo).toBe("Remover do cardápio “Feijoada de sábado”?");
    expect(copia.corpo).toBe(
      "2 produtos deixam de seguir a janela deste cardápio:",
    );
    expect(copia.rotuloConfirmar).toBe("Remover 2 produtos");
    // Trava 6 do design §10.2: a reversibilidade é a simetria da tela, não uma
    // frase no diálogo.
    expect(`${copia.titulo}${copia.corpo}`).not.toMatch(/desfazer|undo/i);
  });

  it("concorda no singular", () => {
    expect(
      perguntaLote({
        acao: "remover",
        nomeCardapio: "X",
        nomes: [],
        total: 1,
      }).corpo,
    ).toBe("1 produto deixa de seguir a janela deste cardápio:");
  });
});

describe("perguntaVisibilidade — D14 em lote", () => {
  it("marcar exclusivo diz que o produto SOME, e conta no botão", () => {
    const copia = perguntaVisibilidade({
      acao: "exclusivo",
      nomes: ["Sopa de cebola"],
      total: 7,
    });
    expect(copia.titulo).toBe("Marcar como exclusivo de cardápio?");
    expect(copia.corpo).toContain("só quando um cardápio dele estiver aberto");
    expect(copia.corpo).toContain("somem da vitrine");
    expect(copia.rotuloConfirmar).toBe("Marcar 7 produtos como exclusivo");
  });

  it("devolver ao menu diz que o produto continua vendendo", () => {
    const copia = perguntaVisibilidade({
      acao: "menu",
      nomes: [],
      total: 1,
    });
    expect(copia.titulo).toBe("Devolver ao menu?");
    expect(copia.corpo).toContain("aparecer sempre no seu menu");
    expect(copia.rotuloConfirmar).toBe("Devolver 1 produto ao menu");
  });

  it("prévia vazia não promete alteração nenhuma", () => {
    expect(
      perguntaVisibilidade({ acao: "exclusivo", nomes: [], total: 0 })
        .rotuloConfirmar,
    ).toBe("Nada a alterar");
  });
});

describe("frasesDeVisibilidade — os dois números de D14", () => {
  it("diz os dois casos quando os dois existem", () => {
    expect(frasesDeVisibilidade({ menu: 9, cardapio: 3 })).toEqual([
      "9 produtos do menu continuam aparecendo e vendendo fora da janela.",
      "3 produtos de cardápio só aparecem quando este cardápio estiver aberto.",
    ]);
  });

  it("omite o caso que não existe — aviso que dispara sempre vira papel de parede", () => {
    expect(frasesDeVisibilidade({ menu: 4, cardapio: 0 })).toHaveLength(1);
    expect(frasesDeVisibilidade({ menu: 0, cardapio: 0 })).toEqual([]);
  });

  it("concorda no singular nos dois eixos", () => {
    expect(frasesDeVisibilidade({ menu: 1, cardapio: 1 })).toEqual([
      "1 produto do menu continua aparecendo e vendendo fora da janela.",
      "1 produto de cardápio só aparece quando este cardápio estiver aberto.",
    ]);
  });
});

describe("fraseCategoriaEhFoto — RN-10", () => {
  it("afirma a foto e nega a adesão automática", () => {
    expect(fraseCategoriaEhFoto(12, "Pizzas")).toBe(
      "São os 12 produtos de Pizzas de hoje. Produtos criados depois não entram sozinhos.",
    );
  });

  it("concorda no singular", () => {
    expect(fraseCategoriaEhFoto(1, "Pizzas")).toBe(
      "É o único produto de Pizzas de hoje. Produtos criados depois não entram sozinhos.",
    );
  });
});

describe("fraseOcultos", () => {
  it("avisa que o oculto entra no lote e continua oculto", () => {
    expect(fraseOcultos(2)).toBe("2 deles estão ocultos e continuam ocultos.");
    expect(fraseOcultos(1)).toBe("1 deles está oculto e continua oculto.");
  });

  it("cala quando não há oculto", () => {
    expect(fraseOcultos(0)).toBeNull();
    expect(fraseOcultos(-1)).toBeNull();
  });
});

describe("fraseEMais", () => {
  it("conta o resto que a lista não nomeia", () => {
    expect(fraseEMais(12, 3)).toBe("e mais 9");
    expect(fraseEMais(12, 6)).toBe("e mais 6");
  });

  it("cala quando a lista já nomeia tudo", () => {
    expect(fraseEMais(3, 3)).toBeNull();
    expect(fraseEMais(2, 6)).toBeNull();
  });
});

/**
 * [277] A redação da ação nova. A trava do design §10.2 continua valendo: o
 * NÚMERO vai DENTRO do rótulo do botão, e ele é o `total` do SERVIDOR.
 */
describe("perguntaDias (277)", () => {
  const base = { nomeCardapio: "Especiais do Dia", nomes: ["Feijoada"] };

  it("com dias marcados, o número vai dentro do rótulo", () => {
    const copia = perguntaDias({ ...base, total: 12, dias: [3, 6] });
    expect(copia.rotuloConfirmar).toBe("Definir os dias em 12 produtos");
    expect(copia.titulo).toBe("Definir os dias no cardápio “Especiais do Dia”?");
    expect(copia.corpo).toContain("12 produtos passam");
  });

  it("sem nenhum dia marcado, o rótulo é o do gesto inverso", () => {
    const copia = perguntaDias({ ...base, total: 12, dias: [] });
    expect(copia.rotuloConfirmar).toBe("Voltar 12 produtos para todos os dias");
    expect(copia.titulo).toBe(
      "Voltar para todos os dias em “Especiais do Dia”?",
    );
  });

  it("singular e plural nos dois sentidos", () => {
    expect(
      perguntaDias({ ...base, total: 1, dias: [3] }).rotuloConfirmar,
    ).toBe("Definir os dias em 1 produto");
    expect(perguntaDias({ ...base, total: 1, dias: [] }).rotuloConfirmar).toBe(
      "Voltar 1 produto para todos os dias",
    );
  });

  it("total 0 não promete escrita nenhuma", () => {
    const copia = perguntaDias({ ...base, total: 0, dias: [3] });
    expect(copia.rotuloConfirmar).toBe("Nada a alterar");
    expect(copia.corpo).toBe(
      "Nenhum produto desta seleção foi encontrado na sua loja.",
    );
  });
});
