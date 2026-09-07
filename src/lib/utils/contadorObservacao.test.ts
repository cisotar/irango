import { describe, expect, it } from "vitest";

import { LIMITE_OBSERVACAO } from "@/lib/constants/pedido";
import {
  ajudaObservacao,
  derivarContadorObservacao,
} from "./contadorObservacao";

const texto = (n: number) => "a".repeat(n);
const MARGEM = Math.round(LIMITE_OBSERVACAO * 0.1);

describe("derivarContadorObservacao", () => {
  it("campo vazio: nada usado, nada a anunciar, sem alerta", () => {
    const c = derivarContadorObservacao("");
    expect(c.usados).toBe(0);
    expect(c.restantes).toBe(LIMITE_OBSERVACAO);
    expect(c.proximoDoLimite).toBe(false);
    expect(c.noLimite).toBe(false);
    expect(c.aviso).toBe("");
  });

  it("conta unidades UTF-16, igual ao .length do textarea", () => {
    // Emoji astral = 2 unidades; o maxLength do navegador conta do mesmo jeito.
    const c = derivarContadorObservacao("🍔");
    expect(c.usados).toBe(2);
    expect(c.restantes).toBe(LIMITE_OBSERVACAO - 2);
  });

  it("um caractere antes da margem ainda não alerta", () => {
    const c = derivarContadorObservacao(texto(LIMITE_OBSERVACAO - MARGEM - 1));
    expect(c.restantes).toBe(MARGEM + 1);
    expect(c.proximoDoLimite).toBe(false);
    expect(c.aviso).toBe("");
  });

  it("na margem exata entra em alerta", () => {
    const c = derivarContadorObservacao(texto(LIMITE_OBSERVACAO - MARGEM));
    expect(c.restantes).toBe(MARGEM);
    expect(c.proximoDoLimite).toBe(true);
    expect(c.noLimite).toBe(false);
    expect(c.aviso).toBe(`Menos de ${MARGEM} caracteres restantes.`);
  });

  it("o aviso NÃO muda a cada tecla dentro da faixa de alerta", () => {
    // Regressão de acessibilidade: uma live region que muda por tecla vira
    // metralhadora no leitor de tela. Toda a faixa compartilha a mesma string.
    const avisos = new Set<string>();
    for (let n = LIMITE_OBSERVACAO - MARGEM; n < LIMITE_OBSERVACAO; n++) {
      avisos.add(derivarContadorObservacao(texto(n)).aviso);
    }
    expect(avisos.size).toBe(1);
  });

  it("no teto anuncia limite atingido", () => {
    const c = derivarContadorObservacao(texto(LIMITE_OBSERVACAO));
    expect(c.restantes).toBe(0);
    expect(c.proximoDoLimite).toBe(true);
    expect(c.noLimite).toBe(true);
    expect(c.aviso).toBe(`Limite de ${LIMITE_OBSERVACAO} caracteres atingido.`);
  });

  it("rascunho legado acima do teto degrada sem quebrar", () => {
    // sessionStorage do checkout pode ter texto de quando o teto era 500:
    // maxLength não trunca valor existente.
    const c = derivarContadorObservacao(texto(LIMITE_OBSERVACAO + 300));
    expect(c.restantes).toBe(-300);
    expect(c.noLimite).toBe(true);
    expect(c.proximoDoLimite).toBe(true);
    expect(c.aviso).toBe(`Limite de ${LIMITE_OBSERVACAO} caracteres atingido.`);
  });

  it("nada está preso ao valor 200 — os limiares seguem o teto informado", () => {
    const c = derivarContadorObservacao(texto(45), 50);
    expect(c.margemAlerta).toBe(5);
    expect(c.restantes).toBe(5);
    expect(c.proximoDoLimite).toBe(true);
    expect(c.aviso).toBe("Menos de 5 caracteres restantes.");
  });
});

describe("ajudaObservacao", () => {
  it("deriva o teto da constante", () => {
    expect(ajudaObservacao()).toBe(
      `Opcional. Até ${LIMITE_OBSERVACAO} caracteres.`,
    );
    expect(ajudaObservacao(50)).toBe("Opcional. Até 50 caracteres.");
  });
});
