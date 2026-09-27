/**
 * `environment: node`, sem jsdom: a decisão é pura e o storage é injetado.
 *
 * Fase RED (TDD) da issue 301 — função pura de decisão do modal sazonal.
 *
 * O módulo `./decisaoModalSazonal` ainda NÃO existe → FAIL por
 * "Cannot find module './decisaoModalSazonal'" ou "is not a function".
 * Esse é o RED intencional.
 *
 * Molde EXATO: src/components/vitrine/decisaoModalPromocoes.test.ts
 * A forma é idêntica: decisão pura + storage injetado por parâmetro,
 * testável sem jsdom (environment: node).
 *
 * Spec: specs/modal-divulgacao-sazonal.md
 *  - RN-07: "1× por dia por loja", fuso da loja, chave separada de promoções
 *  - chave: `irango:promo-sazonal:{slug}` (§Como esta spec consome contratos)
 *  - decidirModalSazonal({ temModalSazonal, diaDeHojeNaLoja, ultimaVisualizacao, scrollY }) → boolean
 *  - marca-visto NO INSTANTE da decisão (antes de retornar true)
 */

import { describe, it, expect } from "vitest";

import {
  chaveModalSazonal,
  decidirModalSazonal,
  lerUltimaVisualizacaoSazonal,
  marcarVisualizadoSazonal,
  type EntradaDecisaoModalSazonal,
} from "./decisaoModalSazonal";

const HOJE = "2026-09-25";

/** Entrada em que TUDO permite abrir — cada teste estraga um campo só. */
const ABRE: EntradaDecisaoModalSazonal = {
  temModalSazonal: true,
  diaDeHojeNaLoja: HOJE,
  ultimaVisualizacao: null,
  scrollY: 0,
};

/** Storage falso mínimo — só o par get/set que o módulo usa. */
function storageFake(inicial: Record<string, string> = {}): Storage {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
    key: (i: number) => [...mapa.keys()][i] ?? null,
    get length() {
      return mapa.size;
    },
  } as Storage;
}

/** Storage que lança: aba privativa / política do navegador. */
function storageQueLanca(): Storage {
  return {
    getItem: () => {
      throw new DOMException("SecurityError");
    },
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

// ─────────────────────────────────── decidirModalSazonal

describe("decidirModalSazonal", () => {
  it("retorna true na primeira visita do dia (localStorage vazio = ultimaVisualizacao null)", () => {
    expect(decidirModalSazonal(ABRE)).toBe(true);
  });

  it("retorna false se já marcado hoje (localStorage com data de hoje)", () => {
    expect(
      decidirModalSazonal({ ...ABRE, ultimaVisualizacao: HOJE }),
    ).toBe(false);
  });

  it("retorna false se scrollY > 0 (cliente já está navegando, janela de abertura passou)", () => {
    expect(decidirModalSazonal({ ...ABRE, scrollY: 1 })).toBe(false);
    expect(decidirModalSazonal({ ...ABRE, scrollY: 800 })).toBe(false);
  });

  it("overscroll negativo do iOS no topo (scrollY < 0) ainda abre", () => {
    expect(decidirModalSazonal({ ...ABRE, scrollY: 0 })).toBe(true);
    expect(decidirModalSazonal({ ...ABRE, scrollY: -30 })).toBe(true);
  });

  it("retorna false quando não há modal sazonal ativo (temModalSazonal = false)", () => {
    expect(decidirModalSazonal({ ...ABRE, temModalSazonal: false })).toBe(false);
  });

  it("última visualização de ontem ⇒ abre de novo", () => {
    expect(
      decidirModalSazonal({ ...ABRE, ultimaVisualizacao: "2026-09-24" }),
    ).toBe(true);
  });

  it("o dia comparado é o da LOJA: mesmo dia gravado, loja já no dia seguinte ⇒ abre", () => {
    expect(
      decidirModalSazonal({
        ...ABRE,
        diaDeHojeNaLoja: "2026-09-26",
        ultimaVisualizacao: HOJE,
      }),
    ).toBe(true);
  });

  it("temModalSazonal=false vence todas as outras condições", () => {
    for (const scrollY of [0, 10]) {
      for (const ultimaVisualizacao of [null, "2026-01-01"]) {
        expect(
          decidirModalSazonal({
            ...ABRE,
            temModalSazonal: false,
            scrollY,
            ultimaVisualizacao,
          }),
        ).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────── chaveModalSazonal

describe("chaveModalSazonal (RN-07)", () => {
  it("usa o prefixo correto definido no spec: 'irango:promo-sazonal:{slug}'", () => {
    expect(chaveModalSazonal("lanches-base")).toBe(
      "irango:promo-sazonal:lanches-base",
    );
  });

  it("é POR SLUG — duas lojas não se atropelam (chave separada da de promoções)", () => {
    expect(chaveModalSazonal("lanches-base")).not.toBe(
      chaveModalSazonal("pao-do-ciso"),
    );
    // Também não colide com a chave de promoções (irango:promo:{slug})
    expect(chaveModalSazonal("lanches-base")).not.toBe("irango:promo:lanches-base");
  });
});

// ─────────────────────────────────── lerUltimaVisualizacaoSazonal / marcarVisualizadoSazonal

describe("lerUltimaVisualizacaoSazonal / marcarVisualizadoSazonal (RN-07)", () => {
  it("grava e relê o dia sob a chave sazonal da loja", () => {
    const storage = storageFake();
    marcarVisualizadoSazonal(storage, "lanches-base", HOJE);
    expect(lerUltimaVisualizacaoSazonal(storage, "lanches-base")).toBe(HOJE);
    // Outra loja continua sem marca.
    expect(lerUltimaVisualizacaoSazonal(storage, "pao-do-ciso")).toBeNull();
  });

  it("não confunde com a chave de promoções — stores independentes", () => {
    const storage = storageFake({
      "irango:promo:lanches-base": HOJE, // chave de promoções já gravada
    });
    // A chave sazonal é diferente — não deve encontrar o valor de promoções.
    expect(lerUltimaVisualizacaoSazonal(storage, "lanches-base")).toBeNull();
  });

  it("storage null (SSR) ⇒ leitura null e escrita silenciosa", () => {
    expect(lerUltimaVisualizacaoSazonal(null, "x")).toBeNull();
    expect(() => marcarVisualizadoSazonal(null, "x", HOJE)).not.toThrow();
  });

  it("storage que LANÇA na leitura ⇒ trata como null e não propaga", () => {
    const storage = storageQueLanca();
    expect(() => lerUltimaVisualizacaoSazonal(storage, "x")).not.toThrow();
    expect(lerUltimaVisualizacaoSazonal(storage, "x")).toBeNull();
  });

  it("storage que LANÇA na escrita ⇒ engole; pior caso o modal reabre (silêncio proposital)", () => {
    const storage = storageQueLanca();
    expect(() => marcarVisualizadoSazonal(storage, "x", HOJE)).not.toThrow();
  });

  it("leitura que falhou vira ultimaVisualizacao: null ⇒ a decisão segue abrindo", () => {
    const lido = lerUltimaVisualizacaoSazonal(storageQueLanca(), "x");
    expect(decidirModalSazonal({ ...ABRE, ultimaVisualizacao: lido })).toBe(true);
  });
});
