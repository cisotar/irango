// [237] A fronteira carrinho → revisão: só ids e quantidades atravessam.

import { describe, it, expect } from "vitest";

import {
  assinaturaCarrinho,
  ATRASO_REVISAO_MS,
  chaveRevisao,
  itensParaRevisao,
  revisaoFrescaDe,
} from "./itensRevisao";
import type { ItemCarrinho } from "@/types/dominio";

const P1 = "11111111-1111-4111-8111-111111111111";
const O1 = "22222222-2222-4222-8222-222222222222";

const ITEM: ItemCarrinho = {
  produtoId: P1,
  nome: "Feijoada completa",
  preco: 80,
  quantidade: 2,
  temDesconto: true,
  observacao: "sem cebola",
  opcionais: [
    { opcionalId: O1, nome: "Borda", preco: 10, quantidade: 1 },
    { opcionalId: "33333333-3333-4333-8333-333333333333", nome: "X", preco: 5, quantidade: 0 },
  ],
};

describe("itensParaRevisao", () => {
  it("NENHUM preço, nome ou flag de exibição atravessa", () => {
    const [linha] = itensParaRevisao([ITEM]);
    expect(linha).toEqual({
      produto_id: P1,
      quantidade: 2,
      opcionais: [{ opcional_id: O1, quantidade: 1 }],
    });
    expect(JSON.stringify(linha)).not.toContain("preco");
    expect(JSON.stringify(linha)).not.toContain("temDesconto");
  });

  it("opcional com quantidade 0 não é enviado; sem opcionais, a chave some", () => {
    const [linha] = itensParaRevisao([
      { produtoId: P1, nome: "X", preco: 1, quantidade: 1 },
    ]);
    expect("opcionais" in linha).toBe(false);
  });

  it("preserva a ORDEM — é ela que pareia com as linhas revisadas", () => {
    const outro: ItemCarrinho = { ...ITEM, produtoId: O1, opcionais: [] };
    expect(itensParaRevisao([ITEM, outro]).map((l) => l.produto_id)).toEqual([
      P1,
      O1,
    ]);
  });
});

describe("assinaturaCarrinho", () => {
  it("muda com a quantidade e ignora o que não é enviado (preço/observação)", () => {
    const a = assinaturaCarrinho([ITEM]);
    expect(assinaturaCarrinho([{ ...ITEM, preco: 999, observacao: "z" }])).toBe(a);
    expect(assinaturaCarrinho([{ ...ITEM, quantidade: 3 }])).not.toBe(a);
  });
});

describe("[auditar 5] chaveRevisao — o código de cupom entra na dedupe", () => {
  it("mesmo carrinho, cupom diferente ⇒ chaves diferentes", () => {
    expect(chaveRevisao([ITEM], "PIZZA10")).not.toBe(chaveRevisao([ITEM]));
  });

  // Antes: `validarCupom(codigo)` revisava, `aplicarCupom` mudava a dep do
  // efeito e uma SEGUNDA chamada idêntica saía logo atrás.
  it("aplicar o cupom recém-validado NÃO produz uma chave nova", () => {
    const daValidacao = chaveRevisao([ITEM], "PIZZA10");
    const doEfeitoDepoisDeAplicar = chaveRevisao([ITEM], "PIZZA10");
    expect(doEfeitoDepoisDeAplicar).toBe(daValidacao);
  });

  it("null e string vazia são a mesma ausência de cupom", () => {
    expect(chaveRevisao([ITEM], null)).toBe(chaveRevisao([ITEM], ""));
  });
});

describe("[auditar 1/2] revisaoFrescaDe — número do servidor só com carrinho de agora", () => {
  const dados = { subtotal: 160 };

  it("chave igual ⇒ fresca (é o subtotal que vai para a tela)", () => {
    const chave = chaveRevisao([ITEM]);
    expect(revisaoFrescaDe({ chave, dados }, chave)).toBe(dados);
  });

  it("carrinho mudou depois da resposta ⇒ NÃO é fresca", () => {
    const chave = chaveRevisao([ITEM]);
    const agora = chaveRevisao([{ ...ITEM, quantidade: 3 }]);
    expect(revisaoFrescaDe({ chave, dados }, agora)).toBeNull();
  });

  it("nunca houve resposta ⇒ null", () => {
    expect(revisaoFrescaDe(null, chaveRevisao([ITEM]))).toBeNull();
  });
});

describe("[auditar 3] o debounce da revisão automática existe e é curto", () => {
  it("meio segundo: colapsa a rajada do `+` sem parecer travado", () => {
    expect(ATRASO_REVISAO_MS).toBe(500);
  });
});
