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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  criarScrollspy,
  decidirAtivo,
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

  it("desligar desconecta o observer (unmount e troca do conjunto de seções)", () => {
    const { obterSecao } = secoes("cat-a");
    const observer = observerFake();

    const controlador = criarScrollspy({
      ordem: ["cat-a"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar: vi.fn(),
    });

    controlador.desligar();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sem IntersectionObserver (browser antigo/SSR) degrada em silêncio: não lança e desligar/irPara são no-op", () => {
    const { obterSecao } = secoes("cat-a");
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a"],
      obterSecao,
      IntersectionObserverCtor: undefined,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    expect(aoAtivar).not.toHaveBeenCalled();
    expect(() => controlador.irPara("cat-a")).not.toThrow();
    expect(() => controlador.desligar()).not.toThrow();
  });
});

describe("decidirAtivo — desempate com trava de alvo (flicker do chip)", () => {
  const ordem = ["cat-a", "cat-b", "cat-c"];

  it("sem alvo, comporta-se como escolherAtivo (RN-2/RN-3, inalterado)", () => {
    expect(decidirAtivo({ ordem, visiveis: new Set(["cat-b"]), alvo: null })).toEqual(
      { ativo: "cat-b", destravar: false },
    );
    expect(decidirAtivo({ ordem, visiveis: new Set(), alvo: null })).toEqual({
      ativo: null,
      destravar: false,
    });
  });

  it("com alvo travado, ignora seção intermediária visível (RN-1)", () => {
    expect(
      decidirAtivo({ ordem, visiveis: new Set(["cat-b"]), alvo: "cat-c" }),
    ).toEqual({ ativo: null, destravar: false });
  });

  it("com alvo travado, quando o alvo fica visível ativa e sinaliza destravar", () => {
    expect(
      decidirAtivo({ ordem, visiveis: new Set(["cat-b", "cat-c"]), alvo: "cat-c" }),
    ).toEqual({ ativo: "cat-c", destravar: true });
  });
});

describe("criarScrollspy — trava de alvo (irPara), flicker do chip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("irPara trava o alvo: seção intermediária visível não chama aoAtivar", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b", "cat-c");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a", "cat-b", "cat-c"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    controlador.irPara("cat-c");
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: true }]);

    expect(aoAtivar).not.toHaveBeenCalled();
  });

  it("alvo entrando em tela ativa e destrava — próxima interseção intermediária volta a marcar", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b", "cat-c");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a", "cat-b", "cat-c"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
    });

    controlador.irPara("cat-c");
    observer.entregar([{ target: mapa.get("cat-c")!, isIntersecting: true }]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-c");

    // Destravado: uma seção diferente agora volta a decidir (RN-2).
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: true }]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-b");
  });

  it("timeout destrava mesmo sem o alvo nunca ficar visível", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b", "cat-c");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a", "cat-b", "cat-c"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
      timeoutAlvoMs: 1200,
    });

    controlador.irPara("cat-c");
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: true }]);
    expect(aoAtivar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1200);

    // Destravado pelo timeout: a próxima interseção volta a decidir normalmente.
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: true }]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-b");
  });

  it("segundo irPara antes de o primeiro assentar substitui o alvo e reinicia o timer", () => {
    const { obterSecao, mapa } = secoes("cat-a", "cat-b", "cat-c");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a", "cat-b", "cat-c"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
      timeoutAlvoMs: 1200,
    });

    controlador.irPara("cat-c");
    vi.advanceTimersByTime(800);
    controlador.irPara("cat-b");

    // O alvo antigo (cat-c) ficando visível não conta mais.
    observer.entregar([{ target: mapa.get("cat-c")!, isIntersecting: true }]);
    expect(aoAtivar).not.toHaveBeenCalled();

    // O timer antigo (que venceria aos 1200ms totais) foi cancelado.
    vi.advanceTimersByTime(500);
    observer.entregar([{ target: mapa.get("cat-c")!, isIntersecting: true }]);
    expect(aoAtivar).not.toHaveBeenCalled();

    // O novo alvo (cat-b) ativa normalmente.
    observer.entregar([{ target: mapa.get("cat-b")!, isIntersecting: true }]);
    expect(aoAtivar).toHaveBeenLastCalledWith("cat-b");
  });

  it("desligar cancela o timer pendente (unmount não deixa setState órfão)", () => {
    const { obterSecao } = secoes("cat-a", "cat-b");
    const observer = observerFake();
    const aoAtivar = vi.fn();

    const controlador = criarScrollspy({
      ordem: ["cat-a", "cat-b"],
      obterSecao,
      IntersectionObserverCtor: observer.Ctor,
      rootMargin: montarRootMargin("40px"),
      aoAtivar,
      timeoutAlvoMs: 1200,
    });

    controlador.irPara("cat-b");
    controlador.desligar();

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(aoAtivar).not.toHaveBeenCalled();
  });
});
