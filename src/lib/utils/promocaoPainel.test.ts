/**
 * Contrato de `promocaoPainel` (issue 235). Módulo puro, `environment: node` —
 * é aqui que a regra é travável, já que o projeto não tem jsdom.
 */
import { describe, it, expect } from "vitest";

import {
  projetarPromocaoDoPainel,
  juntarPrazoLocal,
  separarPrazoLocal,
  previaNaVitrine,
} from "./promocaoPainel";
import { instanteNoFuso, horaLocalNoFuso } from "./fusoLoja";
import { formatarMoeda } from "./formatarMoeda";

const SP = "America/Sao_Paulo";

function produto(
  over: Partial<Parameters<typeof projetarPromocaoDoPainel>[0]> = {},
) {
  return {
    preco: 100,
    desconto_ativo: true,
    desconto_tipo: "percentual" as const,
    desconto_valor: 20,
    desconto_inicio: null,
    desconto_fim: null,
    ...over,
  };
}

describe("projetarPromocaoDoPainel", () => {
  const agora = new Date("2026-09-20T15:00:00Z");

  it("sem prazo, o rótulo é só o selo", () => {
    const p = projetarPromocaoDoPainel(produto(), agora, SP);
    expect(p).toEqual({
      vigente: true,
      rotulo: "-20%",
      inicioLocal: null,
      fimLocal: null,
    });
  });

  it("com prazo, o rótulo inclui o fim em dia/mês NO FUSO DA LOJA", () => {
    // 01/10 às 02:00 UTC ainda é 30/09 às 23:00 em São Paulo: o lojista precisa
    // ler o dia dele, não o do UTC.
    const p = projetarPromocaoDoPainel(
      produto({ desconto_fim: "2026-10-01T02:00:00.000Z" }),
      agora,
      SP,
    );
    expect(p.rotulo).toBe("-20% até 30/09");
    expect(p.fimLocal).toBe("2026-09-30T23:00");
  });

  it("desconto fixo vira rótulo em reais", () => {
    const p = projetarPromocaoDoPainel(
      produto({ desconto_tipo: "fixo", desconto_valor: 10 }),
      agora,
      SP,
    );
    expect(p.rotulo).toBe(`-${formatarMoeda(10)}`);
  });

  it("promoção DESLIGADA não é vigente, mas o prazo volta ao form (RN-07)", () => {
    const p = projetarPromocaoDoPainel(
      produto({
        desconto_ativo: false,
        desconto_inicio: "2026-09-19T14:00:00.000Z",
        desconto_fim: "2026-10-01T02:00:00.000Z",
      }),
      agora,
      SP,
    );
    expect(p.vigente).toBe(false);
    expect(p.rotulo).toBeNull();
    expect(p.inicioLocal).toBe("2026-09-19T11:00");
    expect(p.fimLocal).toBe("2026-09-30T23:00");
  });

  it("promoção ligada mas fora da janela não é vigente", () => {
    const p = projetarPromocaoDoPainel(
      produto({ desconto_fim: "2026-09-20T10:00:00.000Z" }),
      agora,
      SP,
    );
    expect(p.vigente).toBe(false);
    expect(p.rotulo).toBeNull();
  });
});

describe("horaLocalNoFuso espelha instanteNoFuso", () => {
  it("ida e volta preserva a hora local digitada", () => {
    for (const local of [
      "2026-09-30T23:59",
      "2026-01-01T00:00",
      "2026-07-04T12:30",
    ]) {
      expect(horaLocalNoFuso(instanteNoFuso(local, SP), SP)).toBe(local);
    }
  });

  it("o mesmo instante lido em dois fusos dá horas locais diferentes", () => {
    const iso = "2026-09-20T15:00:00.000Z";
    expect(horaLocalNoFuso(iso, SP)).toBe("2026-09-20T12:00");
    expect(horaLocalNoFuso(iso, "UTC")).toBe("2026-09-20T15:00");
  });
});

describe("juntarPrazoLocal / separarPrazoLocal", () => {
  it("junta data + hora no formato do schema", () => {
    expect(juntarPrazoLocal("2026-09-30", "23:59")).toBe("2026-09-30T23:59");
  });

  it("prazo pela metade não vira prazo — nenhuma hora é inventada", () => {
    expect(juntarPrazoLocal("2026-09-30", "")).toBeNull();
    expect(juntarPrazoLocal("", "23:59")).toBeNull();
    expect(juntarPrazoLocal("30/09/2026", "23:59")).toBeNull();
  });

  it("separa de volta, e descarta valor fora do formato", () => {
    expect(separarPrazoLocal("2026-09-30T23:59")).toEqual({
      data: "2026-09-30",
      hora: "23:59",
    });
    expect(separarPrazoLocal(null)).toEqual({ data: "", hora: "" });
    expect(separarPrazoLocal("2026-09-30T23:59:00.000Z")).toEqual({
      data: "",
      hora: "",
    });
  });
});

describe("previaNaVitrine", () => {
  it("percentual: de/por com o preço da vitrine", () => {
    expect(
      previaNaVitrine({
        preco: 100,
        ativo: true,
        tipo: "percentual",
        valor: 10,
      }),
    ).toBe(`De ${formatarMoeda(100)} por ${formatarMoeda(90)}`);
  });

  it("desligada: só o preço cheio (nenhuma promoção é inventada)", () => {
    expect(
      previaNaVitrine({
        preco: 100,
        ativo: false,
        tipo: "percentual",
        valor: 10,
      }),
    ).toBe(formatarMoeda(100));
  });

  it("não lê relógio: prévia idêntica antes e depois de qualquer instante", () => {
    const entrada = {
      preco: 100,
      ativo: true,
      tipo: "fixo" as const,
      valor: 25,
    };
    expect(previaNaVitrine(entrada)).toBe(
      `De ${formatarMoeda(100)} por ${formatarMoeda(75)}`,
    );
  });

  it("preço ainda não digitado ⇒ nenhuma prévia (jamais R$ NaN)", () => {
    expect(
      previaNaVitrine({ preco: NaN, ativo: true, tipo: "fixo", valor: 10 }),
    ).toBeNull();
  });
});
