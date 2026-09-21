/**
 * [256] Os cinco estados do badge de cardápio no painel (design §13.3).
 *
 * `environment: node`, sem jsdom: o estado é função pura de `(cardápio, agora,
 * timezone)`, então os rótulos são afirmáveis BYTE A BYTE — que é o ponto de
 * tirá-los do `.tsx`. Um `if` no JSX seria intestável aqui.
 */

import { describe, it, expect } from "vitest";

import { estadoDoCardapio } from "./estadoCardapioPainel";
import type { CardapioVigencia } from "./vigenciaCardapio";

const SP = "America/Sao_Paulo";

function recorrente(over: Partial<CardapioVigencia> = {}): CardapioVigencia {
  return {
    id: "c1",
    nome: "Feijoada",
    ativo: true,
    modo: "recorrente",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ...over,
  };
}

function prazo(inicio: string, fim: string): CardapioVigencia {
  return {
    ...recorrente(),
    modo: "prazo_fixo",
    prazo_inicio: inicio,
    prazo_fim: fim,
  };
}

describe("estadoDoCardapio", () => {
  it("desligado vem antes de tudo — nem dentro da janela ele aparece", () => {
    // Sábado 13:00 em SP, dentro da janela de sábado — mas `ativo: false`.
    const agora = new Date("2026-09-19T16:00:00Z");
    const estado = estadoDoCardapio(
      recorrente({ ativo: false, dias_semana: [6] }),
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Desligado");
    expect(estado.tom).toBe("neutro");
    expect(estado.abertoAgora).toBe(false);
  });

  it("aberto agora usa a MESMA palavra do status da loja, em verde", () => {
    const agora = new Date("2026-09-19T16:00:00Z"); // sábado, 13:00 em SP
    const estado = estadoDoCardapio(recorrente({ dias_semana: [6] }), agora, SP);
    expect(estado.rotulo).toBe("Aberto agora");
    expect(estado.tom).toBe("verde");
    expect(estado.abertoAgora).toBe(true);
  });

  it("fechado com volta diz QUANDO abre, em neutro", () => {
    // Quarta 13:00 em SP; o cardápio só abre sábado às 11:00.
    const agora = new Date("2026-09-16T16:00:00Z");
    const estado = estadoDoCardapio(
      recorrente({ dias_semana: [6], hora_inicio: "11:00", hora_fim: "15:00" }),
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Abre sábado às 11:00");
    expect(estado.tom).toBe("neutro");
    expect(estado.abertoAgora).toBe(false);
  });

  it("prazo fixo terminando em 3 dias é âmbar e leva a data no aria-label", () => {
    const agora = new Date("2026-09-20T02:59:00Z"); // 19/09, 23:59 em SP
    const estado = estadoDoCardapio(
      prazo("2026-09-10T03:00:00Z", "2026-09-24T02:59:00Z"), // fim: 23/09 23:59
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Expira em 4 dias");
    expect(estado.tom).toBe("ambar");
    // Design §13.3 regra 4: rótulo abreviado ⇒ `aria-label` completo.
    expect(estado.rotuloAcessivel).toBe("Expira em 4 dias, em 23/09 às 23:59");
    // Âmbar continua no ar — a frase de efeito de D16 vale.
    expect(estado.abertoAgora).toBe(true);
  });

  it("abaixo de 24h o número de dias some e o horário entra", () => {
    const agora = new Date("2026-09-23T12:00:00Z");
    const estado = estadoDoCardapio(
      prazo("2026-09-10T03:00:00Z", "2026-09-24T02:59:00Z"), // 23/09 23:59 SP
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Expira hoje às 23:59");
    expect(estado.tom).toBe("ambar");
    expect(estado.rotuloAcessivel).toBeNull();
  });

  it("a mais de 7 dias do fim NÃO é âmbar — o alerta não vale o ano inteiro", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    const estado = estadoDoCardapio(
      prazo("2026-09-10T03:00:00Z", "2026-10-24T02:59:00Z"),
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Aberto agora");
    expect(estado.tom).toBe("verde");
  });

  it("prazo encerrado é Expirado, e NEUTRO — o vermelho fica fora", () => {
    const agora = new Date("2026-10-01T12:00:00Z");
    const estado = estadoDoCardapio(
      prazo("2026-09-10T03:00:00Z", "2026-09-24T02:59:00Z"),
      agora,
      SP,
    );
    expect(estado.rotulo).toBe("Expirado");
    expect(estado.tom).toBe("neutro");
    expect(estado.abertoAgora).toBe(false);
  });

  it("nenhum dos cinco estados usa vermelho", () => {
    const agora = new Date("2026-09-19T16:00:00Z");
    const cardapios = [
      recorrente({ ativo: false }),
      recorrente({ dias_semana: [6] }),
      recorrente({ dias_semana: [1] }),
      prazo("2026-09-10T03:00:00Z", "2026-09-24T02:59:00Z"),
      prazo("2026-01-01T03:00:00Z", "2026-01-02T03:00:00Z"),
    ];
    for (const cardapio of cardapios) {
      expect(["verde", "ambar", "neutro"]).toContain(
        estadoDoCardapio(cardapio, agora, SP).tom,
      );
    }
  });
});
