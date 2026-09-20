// [237/238 · correções do `auditar`] A prova de que o diálogo de reconfirmação
// NUNCA abre com dado velho nem com lista vazia.
//
// Sem jsdom, a decisão vive em módulo puro exatamente para poder ser afirmada
// aqui — e o `travasCheckoutPromocao.test.ts` trava que é este módulo (e não um
// `.finally()`) quem o `CheckoutWizard` consulta.

import { describe, it, expect } from "vitest";

import {
  chaveMudancas,
  decidirReconfirmacao,
  CHAVE_SEM_MUDANCA,
  MSG_REVISAO_FALHOU,
  MSG_REVISAO_SEM_MUDANCA,
} from "./reconfirmacaoPreco";
import { textosRevisao } from "@/lib/utils/copiaRevisaoPreco";

const SUBIU = { nome: "Feijoada completa", de: 80, para: 100 };

describe("[auditar 1] a revisão FALHOU ⇒ nenhum diálogo, nenhum CTA de envio", () => {
  it("rate limit/rede/loja suspensa ⇒ `falhou`, mesmo com aumentos conhecidos", () => {
    // `subiram` aqui seria o resultado ANTIGO: é justamente o dado velho que
    // não pode virar tela.
    expect(decidirReconfirmacao({ ok: false, subiram: [SUBIU] })).toBe("falhou");
    expect(decidirReconfirmacao({ ok: false, subiram: [] })).toBe("falhou");
  });

  it("o toast da falha é genérico — nada de detalhe interno (§14)", () => {
    expect(MSG_REVISAO_FALHOU).toBe(
      "Não foi possível revisar os preços. Tente novamente.",
    );
    expect(MSG_REVISAO_FALHOU).not.toMatch(/R\$|rate|limit|SQL|supabase/i);
  });
});

describe("[auditar 1] lista vazia não é copy: `textosRevisao` não é alcançável com 0 itens", () => {
  it("revisão fresca sem aumento ⇒ `seguir`, nunca `abrir`", () => {
    expect(decidirReconfirmacao({ ok: true, subiram: [] })).toBe("seguir");
    expect(MSG_REVISAO_SEM_MUDANCA).not.toMatch(/0 itens/);
  });

  it("a frase impossível SÓ existiria com a lista vazia — e ela nunca abre", () => {
    // Documenta o que a trava evita: este é o texto que o cliente via antes.
    const impossivel = textosRevisao({ direcao: "subiu", itens: [], novoTotal: 0 });
    expect(impossivel.corpo).toContain("0 itens");
    expect(decidirReconfirmacao({ ok: true, subiram: [] })).not.toBe("abrir");
  });

  it("revisão fresca COM aumento ⇒ abre", () => {
    expect(decidirReconfirmacao({ ok: true, subiram: [SUBIU] })).toBe("abrir");
  });
});

describe("[auditar 1] a rodada de aumentos tem chave própria", () => {
  it("nada subiu ⇒ chave vazia, que o efeito usa para NÃO abrir", () => {
    expect(chaveMudancas([])).toBe(CHAVE_SEM_MUDANCA);
  });

  it("mesma rodada ⇒ mesma chave (fechar o diálogo não o reabre)", () => {
    expect(chaveMudancas([SUBIU])).toBe(chaveMudancas([{ ...SUBIU }]));
  });

  it("preço novo ⇒ chave nova (um aumento posterior volta a pedir consentimento)", () => {
    expect(chaveMudancas([SUBIU])).not.toBe(
      chaveMudancas([{ ...SUBIU, para: 120 }]),
    );
  });
});
