/**
 * Issue 202 — "um anúncio por parada de digitação", provado com fake timers e
 * sem React, como `criarControladorPolling` fez na 131.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { criarAnunciadorBusca } from "./anunciadorBusca";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("202 criarAnunciadorBusca", () => {
  it("três teclas dentro da janela viram UM anúncio, com o último texto", () => {
    const aoAnunciar = vi.fn();
    const anunciador = criarAnunciadorBusca({ aoAnunciar, atrasoMs: 500 });

    anunciador.anunciar("1 produto encontrado");
    vi.advanceTimersByTime(100);
    anunciador.anunciar("2 produtos encontrados");
    vi.advanceTimersByTime(100);
    anunciador.anunciar("3 produtos encontrados");

    expect(aoAnunciar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(aoAnunciar).toHaveBeenCalledTimes(1);
    expect(aoAnunciar).toHaveBeenCalledWith("3 produtos encontrados");
  });

  it("não anuncia antes do atraso completo", () => {
    const aoAnunciar = vi.fn();
    const anunciador = criarAnunciadorBusca({ aoAnunciar, atrasoMs: 500 });

    anunciador.anunciar("3 produtos encontrados");
    vi.advanceTimersByTime(499);
    expect(aoAnunciar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(aoAnunciar).toHaveBeenCalledTimes(1);
  });

  it("parar() cancela o pendente — nada é anunciado depois do cleanup", () => {
    const aoAnunciar = vi.fn();
    const anunciador = criarAnunciadorBusca({ aoAnunciar, atrasoMs: 500 });

    anunciador.anunciar("3 produtos encontrados");
    anunciador.parar();
    vi.advanceTimersByTime(5000);

    expect(aoAnunciar).not.toHaveBeenCalled();
  });

  it("parar() sem nada pendente é inócuo e nunca lança", () => {
    const anunciador = criarAnunciadorBusca({ aoAnunciar: vi.fn() });
    expect(() => {
      anunciador.parar();
      anunciador.parar();
    }).not.toThrow();
  });

  it("anúncios em janelas separadas saem os dois", () => {
    const aoAnunciar = vi.fn();
    const anunciador = criarAnunciadorBusca({ aoAnunciar, atrasoMs: 500 });

    anunciador.anunciar("1 produto encontrado");
    vi.advanceTimersByTime(500);
    anunciador.anunciar("Nenhum produto encontrado para xyz");
    vi.advanceTimersByTime(500);

    expect(aoAnunciar.mock.calls).toEqual([
      ["1 produto encontrado"],
      ["Nenhum produto encontrado para xyz"],
    ]);
  });

  it("usa 500ms como atraso padrão", () => {
    const aoAnunciar = vi.fn();
    const anunciador = criarAnunciadorBusca({ aoAnunciar });

    anunciador.anunciar("2 produtos encontrados");
    vi.advanceTimersByTime(499);
    expect(aoAnunciar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(aoAnunciar).toHaveBeenCalledTimes(1);
  });
});
