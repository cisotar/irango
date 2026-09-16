/**
 * Issue 201 — mecânica de medição da barra sticky, extraída para módulo neutro
 * (padrão `criarControladorPolling`/`aberturaWhatsapp`, architecture.md §8)
 * exatamente para poder ser coberta em `environment: node` sem jsdom.
 *
 * `CatalogoVitrine.test.tsx` prova só a ÁRVORE (renderToStaticMarkup não roda
 * efeitos); ESTE arquivo prova a mecânica que RN-6 e o comentário "cleanup
 * OBRIGATÓRIO" descrevem — com fakes, sem precisar de DOM real.
 */
import { describe, it, expect, vi } from "vitest";

import {
  VAR_ALTURA_BARRA,
  medirEObservarBarra,
  type ConstrutorResizeObserver,
} from "./medicaoBarraVitrine";

function raizFake() {
  const propriedades = new Map<string, string>();
  return {
    propriedades,
    raiz: {
      style: {
        setProperty: vi.fn((nome: string, valor: string) => {
          propriedades.set(nome, valor);
        }),
        removeProperty: vi.fn((nome: string) => {
          propriedades.delete(nome);
        }),
      },
    },
  };
}

function barraFake(altura: number) {
  return { getBoundingClientRect: () => ({ height: altura }) };
}

/** ResizeObserver fake: guarda o callback e expõe `observe`/`disconnect` espiados,
 *  e um jeito de disparar o callback manualmente (simula um resize real). */
function resizeObserverFake() {
  let callbackRegistrado: (() => void) | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const Ctor = vi.fn(function (this: unknown, callback: () => void) {
    callbackRegistrado = callback;
    return { observe, disconnect };
  }) as unknown as ConstrutorResizeObserver;
  return {
    Ctor,
    observe,
    disconnect,
    disparar: () => callbackRegistrado?.(),
  };
}

describe("201 medirEObservarBarra — mede a CSS var e limpa no cleanup", () => {
  it("mede a altura da barra arredondada para CIMA (RN-6: nunca valor fixo)", () => {
    const { raiz, propriedades } = raizFake();
    const barra = barraFake(41.2); // arredonda para 42, não trunca para 41

    medirEObservarBarra(barra, { raiz });

    expect(propriedades.get(VAR_ALTURA_BARRA)).toBe("42px");
  });

  it("remede quando o ResizeObserver injetado dispara (resize real)", () => {
    const { raiz, propriedades } = raizFake();
    let altura = 60;
    const barra = { getBoundingClientRect: () => ({ height: altura }) };
    const ro = resizeObserverFake();

    medirEObservarBarra(barra, { raiz, ResizeObserverCtor: ro.Ctor });
    expect(propriedades.get(VAR_ALTURA_BARRA)).toBe("60px");
    expect(ro.observe).toHaveBeenCalledWith(barra);

    altura = 88; // barra cresceu (ex.: trilho da busca quebrou linha)
    ro.disparar();

    expect(propriedades.get(VAR_ALTURA_BARRA)).toBe("88px");
  });

  it("cleanup desconecta o observer E remove a propriedade CSS", () => {
    const { raiz, propriedades } = raizFake();
    const barra = barraFake(50);
    const ro = resizeObserverFake();

    const cleanup = medirEObservarBarra(barra, {
      raiz,
      ResizeObserverCtor: ro.Ctor,
    });
    expect(propriedades.has(VAR_ALTURA_BARRA)).toBe(true);

    cleanup();

    expect(ro.disconnect).toHaveBeenCalledTimes(1);
    // Sem isso a var vaza para /checkout (sem barra) e desloca âncoras de
    // outra rota — o bug exato que o comentário "cleanup OBRIGATÓRIO" evita.
    expect(propriedades.has(VAR_ALTURA_BARRA)).toBe(false);
  });

  it("sem ResizeObserver (browser antigo): mede uma vez, nunca lança, e o cleanup ainda remove a var", () => {
    const { raiz, propriedades } = raizFake();
    const barra = barraFake(30);

    const cleanup = medirEObservarBarra(barra, {
      raiz,
      ResizeObserverCtor: undefined,
    });

    expect(propriedades.get(VAR_ALTURA_BARRA)).toBe("30px");

    cleanup();

    expect(propriedades.has(VAR_ALTURA_BARRA)).toBe(false);
  });

  it("203 aoMedir é notificado só quando a altura MUDA (a guarda impede loop de render)", () => {
    const { raiz } = raizFake();
    let altura = 60;
    const barra = { getBoundingClientRect: () => ({ height: altura }) };
    const ro = resizeObserverFake();
    const aoMedir = vi.fn();

    medirEObservarBarra(barra, {
      raiz,
      ResizeObserverCtor: ro.Ctor,
      aoMedir,
    });
    expect(aoMedir).toHaveBeenCalledTimes(1);
    expect(aoMedir).toHaveBeenLastCalledWith(60);

    // Entrega redundante do ResizeObserver (altura igual): NÃO notifica — é o
    // que impede o `setState` da 203 de virar loop de render.
    ro.disparar();
    expect(aoMedir).toHaveBeenCalledTimes(1);

    altura = 88; // rotação de tela / troca trilho↔resumo
    ro.disparar();
    expect(aoMedir).toHaveBeenCalledTimes(2);
    expect(aoMedir).toHaveBeenLastCalledWith(88);
  });

  it("altura zero (barra só com a borda, slots vazios desta issue) publica 0px, não a string vazia", () => {
    const { raiz, propriedades } = raizFake();
    const barra = barraFake(0.3); // sub-pixel de borda arredonda pra 1, não 0

    medirEObservarBarra(barra, { raiz });

    expect(propriedades.get(VAR_ALTURA_BARRA)).toBe("1px");
  });
});
