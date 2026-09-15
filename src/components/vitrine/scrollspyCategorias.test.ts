/**
 * Issue 203 — mecânica do scrollspy da nav de categorias, extraída para módulo
 * neutro (padrão `medicaoBarraVitrine`/`criarControladorPolling`,
 * architecture.md §8) exatamente para ser coberta em `environment: node`, sem
 * jsdom e sem `IntersectionObserver` real.
 *
 * `NavCategorias.test.tsx` prova só a ÁRVORE (renderToStaticMarkup não roda
 * efeitos); ESTE arquivo prova o desempate, o rootMargin medido e a degradação
 * silenciosa.
 */
import { describe, it, expect, vi } from "vitest";

import {
  criarScrollspy,
  escolherAtivo,
  montarRootMargin,
  type ConstrutorIntersectionObserver,
  type EntradaInterseccao,
} from "./scrollspyCategorias";

/** IntersectionObserver fake: guarda callback/opções e expõe `observe`/`disconnect`
 *  espiados, mais um jeito de entregar entradas (simula scroll real). */
function observerFake() {
  let callbackRegistrado:
    | ((entradas: EntradaInterseccao[]) => void)
    | null = null;
  let opcoesRegistradas: { rootMargin: string; threshold: number } | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const Ctor = vi.fn(function (
    this: unknown,
    callback: (entradas: EntradaInterseccao[]) => void,
    opcoes: { rootMargin: string; threshold: number },
  ) {
    callbackRegistrado = callback;
    opcoesRegistradas = opcoes;
    return { observe, disconnect };
  }) as unknown as ConstrutorIntersectionObserver;
  return {
    Ctor,
    observe,
    disconnect,
    get opcoes() {
      return opcoesRegistradas;
    },
    entregar: (entradas: EntradaInterseccao[]) => callbackRegistrado?.(entradas),
  };
}

function secoes(...ancoras: string[]) {
  const mapa = new Map(ancoras.map((id) => [id, { id }]));
  return {
    mapa,
    obterSecao: (ancora: string) => mapa.get(ancora) ?? null,
  };
}

describe("203 escolherAtivo — desempate pela ordem do catálogo", () => {
  const ordem = ["cat-a", "cat-b", "cat-c"];

  it("com duas seções visíveis, vence a PRIMEIRA na ordem do catálogo", () => {
    // Nunca a de maior intersectionRatio: essa oscila por frame e faz piscar.
    expect(escolherAtivo(ordem, new Set(["cat-c", "cat-b"]))).toBe("cat-b");
  });

  it("com uma só visível, devolve ela", () => {
    expect(escolherAtivo(ordem, new Set(["cat-c"]))).toBe("cat-c");
  });

  it("sem nenhuma visível devolve null (quem chama mantém o ativo anterior)", () => {
    expect(escolherAtivo(ordem, new Set())).toBeNull();
  });

  it("ignora âncora visível que não está no catálogo", () => {
    expect(escolherAtivo(ordem, new Set(["cat-fantasma"]))).toBeNull();
  });
});

describe("203 montarRootMargin — lê a altura MEDIDA da barra (RN-6)", () => {
  it("usa a altura recebida como recorte superior", () => {
    expect(montarRootMargin("64px")).toBe("-64px 0px -55% 0px");
  });

  it("var ainda vazia cai em 0px — nunca rootMargin inválido", () => {
    // String vazia produziria "- 0px -55% 0px" e o construtor lançaria.
    expect(montarRootMargin("")).toBe("-0px 0px -55% 0px");
    expect(montarRootMargin("   ")).toBe("-0px 0px -55% 0px");
  });
});

describe("203 criarScrollspy — observer injetado, cleanup e degradação", () => {
  it("observa todas as seções existentes com o rootMargin recebido e threshold 0", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b");
    const observer = observerFake();

    criarScrollspy({
      ordem: ["cat-a", "cat-b"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("72px"),
      aoAtivar: vi.fn(),
    });

    expect(observer.opcoes).toEqual({
      rootMargin: "-72px 0px -55% 0px",
      threshold: 0,
    });
    expect(observer.observe).toHaveBeenCalledTimes(2);
    expect(observer.observe).toHaveBeenCalledWith(mapa.get("cat-a"));
  });

  it("âncora sem <section> no DOM é pulada, sem lançar", () => {
    const { obterSecao } = secoes("cat-a");
    const observer = observerFake();

    expect(() =>
      criarScrollspy({
        ordem: ["cat-a", "cat-sumida"],
        obterSecao,
        IntersectionObserverCtor: observer.Ctor,
        rootMargin: montarRootMargin("10px"),
        aoAtivar: vi.fn(),
      }),
    ).not.toThrow();
    expect(observer.observe).toHaveBeenCalledTimes(1);
  });

  it("acumula visíveis entre entregas e ativa a primeira da ordem", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b", "cat-c");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    criarScrollspy({
      ordem: ["cat-a", "cat-b", "cat-c"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    observer.entregar([
      { target: mapa.get("cat-b")!, isIntersecting: true },
      { target: mapa.get("cat-c")!, isIntersecting: true },
    ]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-b");

    // Entrega seguinte só diz que a `b` saiu; a `c` continua no Set.
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: false }]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-c");
  });

  it("entrega sem nenhuma visível NÃO chama aoAtivar (mantém o ativo anterior)", () => {
    const { obterSecao, mapa } = secoes("cat-a");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    criarScrollspy({
      ordem: ["cat-a"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    observer.entregar([{ target: mapa.get("cat-a")!, isIntersecting: false }]);

    expect(aoAtivar).not.toHaveBeenCalled();
  });

  it("cleanup desconecta o observer (unmount e troca do conjunto de seções)", () => {
    const { obterSecao } = secoes("cat-a");
    const observer = observerFake();

    const cleanup = criarScrollspy({
      ordem: ["cat-a"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar: vi.fn(),
    });

    cleanup();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sem IntersectionObserver (browser antigo/SSR) degrada em silêncio: não lança e o cleanup é no-op", () => {
    const { obterSecao } = secoes("cat-a");
    const aoAtivar = vi.fn();

    const cleanup = criarScrollspy({
      ordem: ["cat-a"],
      obterSecao,
      IntersectionObserverCtor: undefined,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    expect(aoAtivar).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });
});
