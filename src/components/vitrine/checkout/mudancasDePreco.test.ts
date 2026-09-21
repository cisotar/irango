// [238/D11] O que mudou entre o carrinho e o envio, nos dois sentidos.

import { describe, it, expect } from "vitest";

import { detectarMudancasDePreco } from "./mudancasDePreco";
import type { LinhaRevisada } from "@/lib/actions/revisarCarrinho-contrato";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function linha(
  produto_id: string,
  precoEfetivo: number,
  temDesconto = false,
): LinhaRevisada {
  return {
    produto_id,
    quantidade: 1,
    preco: 100,
    precoEfetivo,
    temDesconto,
    compravel: true,
    motivoNaoCompravel: null,
  };
}

describe("[238] detectarMudancasDePreco", () => {
  it("promoção EXPIROU: o preço subiu, e é o caso que exige reconfirmação", () => {
    const r = detectarMudancasDePreco(
      [{ nome: "Feijoada completa", precoExibido: 80 }],
      [linha(P1, 100)],
    );
    expect(r.subiram).toEqual([
      { indice: 0, nome: "Feijoada completa", de: 80, para: 100 },
    ]);
    expect(r.cairam).toEqual([]);
  });

  it("promoção COMEÇOU: o preço caiu, e nada é bloqueado", () => {
    const r = detectarMudancasDePreco(
      [{ nome: "Feijoada completa", precoExibido: 100 }],
      [linha(P1, 80, true)],
    );
    expect(r.cairam).toEqual([
      { indice: 0, nome: "Feijoada completa", de: 100, para: 80 },
    ]);
    expect(r.subiram).toEqual([]);
  });

  it("nada mudou ⇒ nenhuma tela aparece", () => {
    const r = detectarMudancasDePreco(
      [
        { nome: "Feijoada completa", precoExibido: 80 },
        { nome: "Refrigerante", precoExibido: 8 },
      ],
      [linha(P1, 80, true), linha(P2, 8)],
    );
    expect(r).toEqual({ subiram: [], cairam: [] });
  });

  it("pareia POR ÍNDICE: duas linhas do MESMO produto não se fundem", () => {
    const r = detectarMudancasDePreco(
      [
        { nome: "Pizza (sem borda)", precoExibido: 80 },
        { nome: "Pizza (com borda)", precoExibido: 80 },
      ],
      [linha(P1, 100), linha(P1, 80, true)],
    );
    expect(r.subiram).toEqual([
      { indice: 0, nome: "Pizza (sem borda)", de: 80, para: 100 },
    ]);
    expect(r.cairam).toEqual([]);
  });

  // O índice existe para o segundo clique limpar `promocaoExibida` SÓ das
  // linhas que o diálogo mostrou (achado do `auditar`).
  it("a linha mudada carrega o ÍNDICE dela no carrinho", () => {
    const r = detectarMudancasDePreco(
      [
        { nome: "Refrigerante", precoExibido: 8 },
        { nome: "Feijoada completa", precoExibido: 80 },
        { nome: "Pudim", precoExibido: 12 },
      ],
      [linha(P2, 8), linha(P1, 100), linha(P2, 20)],
    );
    expect(r.subiram.map((l) => l.indice)).toEqual([1, 2]);
    expect(r.cairam).toEqual([]);
  });

  it("tamanhos divergentes ⇒ nada é afirmado (nunca nomeia a linha errada)", () => {
    const r = detectarMudancasDePreco(
      [{ nome: "Feijoada completa", precoExibido: 80 }],
      [linha(P1, 100), linha(P2, 8)],
    );
    expect(r).toEqual({ subiram: [], cairam: [] });
  });
});
