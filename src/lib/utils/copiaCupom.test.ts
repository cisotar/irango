// [237] As TRÊS redações de RN-10-e, afirmadas BYTE A BYTE.
//
// Literais escritas à mão de propósito (com ` `, o espaço que o Intl
// pt-BR usa entre "R$" e o número): montar a expectativa com `formatarMoeda`
// faria o teste concordar com qualquer reescrita futura da frase. A autoridade
// da redação é a spec (RN-10-e); aqui ela vira travamento.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  detalhamentoCupom,
  fraseCupom,
  rotuloLinhaCupom,
  valorLinhaCupom,
  ROTULO_DETALHAMENTO,
} from "./copiaCupom";
import type { EstadoCupom } from "@/lib/actions/revisarCarrinho-contrato";

// Os números canônicos de RN-10-a/RN-10-d — os mesmos do spec.
const CHEIO: EstadoCupom = { estado: "cheio", codigo: "PROMO10", desconto: 14 };
const PARCIAL: EstadoCupom = {
  estado: "parcial",
  codigo: "PROMO10",
  desconto: 6,
  baseElegivel: 60,
  baseProdutos: 50,
  baseOpcionais: 10,
};
const ZERO: EstadoCupom = { estado: "zero", codigo: "PROMO10" };

describe("[237/RN-10-e] estado A — desconto cheio", () => {
  it("linha `Cupom PROMO10` · `− R$ 14,00`", () => {
    expect(rotuloLinhaCupom(CHEIO)).toBe("Cupom PROMO10");
    expect(valorLinhaCupom(CHEIO)).toBe("− R$ 14,00");
  });

  it("SEM frase: nada a explicar quando nada está em promoção", () => {
    expect(fraseCupom(CHEIO)).toBeNull();
  });

  it("SEM disclosure: não há parcelas a somar", () => {
    expect(detalhamentoCupom(CHEIO)).toBeNull();
  });
});

describe("[237/RN-10-e] estado B — desconto parcial", () => {
  it("linha `Cupom PROMO10` · `− R$ 6,00`", () => {
    expect(rotuloLinhaCupom(PARCIAL)).toBe("Cupom PROMO10");
    expect(valorLinhaCupom(PARCIAL)).toBe("− R$ 6,00");
  });

  it("frase literal de RN-10-e, com `adicionais incluídos`", () => {
    expect(fraseCupom(PARCIAL)).toBe(
      "Não acumula com promoção: o desconto valeu sobre R$ 60,00 do " +
        "pedido — o que não está em promoção, adicionais incluídos.",
    );
  });

  it("disclosure: as três parcelas do servidor, sem nenhuma soma no cliente", () => {
    expect(ROTULO_DETALHAMENTO).toBe("Como calculamos");
    expect(detalhamentoCupom(PARCIAL)).toEqual([
      { rotulo: "Itens fora da promoção", valor: "R$ 50,00" },
      { rotulo: "+ Adicionais", valor: "R$ 10,00" },
      { rotulo: "= O cupom valeu sobre", valor: "R$ 60,00" },
    ]);
  });
});

describe("[237/RN-10-e] estado C — desconto zero", () => {
  it("rótulo diz que o cupom foi APLICADO — a linha não tem valor", () => {
    expect(rotuloLinhaCupom(ZERO)).toBe("Cupom PROMO10 aplicado");
    expect(valorLinhaCupom(ZERO)).toBeNull();
  });

  it("frase literal de RN-10-e", () => {
    expect(fraseCupom(ZERO)).toBe(
      "Cupom PROMO10 aplicado. Sem desconto neste pedido: não há nada fora " +
        "da promoção para descontar — cupom não acumula com promoção.",
    );
  });

  it("SEM disclosure: não há números para somar", () => {
    expect(detalhamentoCupom(ZERO)).toBeNull();
  });

  it("`R$ 0,00` NUNCA sai deste módulo no estado C", () => {
    const saidas = [
      rotuloLinhaCupom(ZERO),
      valorLinhaCupom(ZERO) ?? "",
      fraseCupom(ZERO) ?? "",
    ];
    for (const s of saidas) expect(s).not.toContain("0,00");
  });
});

describe('[237] "base elegível" é vocabulário PROIBIDO na vitrine', () => {
  it("nenhuma string devolvida ao cliente contém a expressão", () => {
    const todas = [CHEIO, PARCIAL, ZERO].flatMap((e) => [
      rotuloLinhaCupom(e),
      valorLinhaCupom(e) ?? "",
      fraseCupom(e) ?? "",
      ...(detalhamentoCupom(e) ?? []).flatMap((l) => [l.rotulo, l.valor]),
    ]);
    for (const s of todas) {
      expect(s.toLowerCase()).not.toContain("base elegível");
      expect(s.toLowerCase()).not.toContain("baseelegivel");
    }
  });
});

describe("[237/M5] o módulo é PURO", () => {
  it("não importa React nem toca no DOM", () => {
    const fonte = readFileSync(
      new URL("./copiaCupom.ts", import.meta.url),
      "utf8",
    );
    expect(fonte).not.toMatch(/from "react"/);
    expect(fonte).not.toMatch(/\bdocument\.|\bwindow\./);
  });
});
