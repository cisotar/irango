// [237] A fronteira carrinho → revisão: só ids e quantidades atravessam.

import { describe, it, expect } from "vitest";

import { assinaturaCarrinho, itensParaRevisao } from "./itensRevisao";
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
