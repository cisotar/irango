/** `environment: node`, sem jsdom: a decisão é pura e o storage é injetado. */
import { describe, it, expect } from "vitest";

import {
  chaveModalPromocoes,
  decidirModalPromocoes,
  lerUltimaVisualizacao,
  marcarVisualizado,
  type EntradaDecisaoModal,
} from "./decisaoModalPromocoes";

const HOJE = "2026-09-20";

/** Entrada em que TUDO permite abrir — cada teste estraga um campo só. */
const ABRE: EntradaDecisaoModal = {
  toggleDaLoja: true,
  temPromocaoAtiva: true,
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

/** Aba privativa / storage bloqueado por política: o acesso LANÇA. */
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

describe("decidirModalPromocoes", () => {
  it("abre quando as quatro condições valem", () => {
    expect(decidirModalPromocoes(ABRE)).toBe(true);
  });

  it("toggle desligado ⇒ não abre", () => {
    expect(decidirModalPromocoes({ ...ABRE, toggleDaLoja: false })).toBe(false);
  });

  it("sem promoção ativa ⇒ não abre, MESMO com o toggle ligado (RN-16)", () => {
    expect(
      decidirModalPromocoes({
        ...ABRE,
        toggleDaLoja: true,
        temPromocaoAtiva: false,
      }),
    ).toBe(false);
  });

  it("já visto hoje ⇒ não abre", () => {
    expect(
      decidirModalPromocoes({ ...ABRE, ultimaVisualizacao: HOJE }),
    ).toBe(false);
  });

  it("última visualização de ONTEM ⇒ abre de novo", () => {
    expect(
      decidirModalPromocoes({ ...ABRE, ultimaVisualizacao: "2026-09-19" }),
    ).toBe(true);
  });

  it("o dia comparado é o da LOJA: mesmo dia gravado, loja já no dia seguinte ⇒ abre", () => {
    expect(
      decidirModalPromocoes({
        ...ABRE,
        diaDeHojeNaLoja: "2026-09-21",
        ultimaVisualizacao: HOJE,
      }),
    ).toBe(true);
  });

  it("scrollY > 0 ⇒ não abre: quem já rolou já está navegando (RN-17)", () => {
    expect(decidirModalPromocoes({ ...ABRE, scrollY: 1 })).toBe(false);
    expect(decidirModalPromocoes({ ...ABRE, scrollY: 800 })).toBe(false);
  });

  it("scrollY 0 (e overscroll negativo do iOS no topo) ainda abre", () => {
    expect(decidirModalPromocoes({ ...ABRE, scrollY: 0 })).toBe(true);
    expect(decidirModalPromocoes({ ...ABRE, scrollY: -30 })).toBe(true);
  });

  it("o toggle desligado vence todas as outras: nenhuma combinação o contorna", () => {
    for (const scrollY of [0, 10]) {
      for (const ultimaVisualizacao of [null, "2026-01-01"]) {
        expect(
          decidirModalPromocoes({
            ...ABRE,
            toggleDaLoja: false,
            scrollY,
            ultimaVisualizacao,
          }),
        ).toBe(false);
      }
    }
  });
});

describe("chave do 'já mostrei'", () => {
  it("é por SLUG — duas lojas no mesmo dispositivo não se atropelam (RN-18)", () => {
    expect(chaveModalPromocoes("lanches-base")).toBe(
      "irango:promo:lanches-base",
    );
    expect(chaveModalPromocoes("lanches-base")).not.toBe(
      chaveModalPromocoes("pao-do-ciso"),
    );
  });
});

describe("lerUltimaVisualizacao / marcarVisualizado (RN-18)", () => {
  it("grava e relê o dia sob a chave da loja", () => {
    const storage = storageFake();
    marcarVisualizado(storage, "lanches-base", HOJE);
    expect(lerUltimaVisualizacao(storage, "lanches-base")).toBe(HOJE);
    // Outra loja continua sem marca.
    expect(lerUltimaVisualizacao(storage, "pao-do-ciso")).toBeNull();
  });

  it("storage `null` (SSR) ⇒ leitura null e escrita silenciosa", () => {
    expect(lerUltimaVisualizacao(null, "x")).toBeNull();
    expect(() => marcarVisualizado(null, "x", HOJE)).not.toThrow();
  });

  it("storage que LANÇA na leitura ⇒ trata como null e não propaga", () => {
    const storage = storageQueLanca();
    expect(() => lerUltimaVisualizacao(storage, "x")).not.toThrow();
    expect(lerUltimaVisualizacao(storage, "x")).toBeNull();
  });

  it("storage que LANÇA na escrita ⇒ engole; pior caso o modal reabre", () => {
    const storage = storageQueLanca();
    expect(() => marcarVisualizado(storage, "x", HOJE)).not.toThrow();
  });

  it("leitura que falhou vira `ultimaVisualizacao: null` ⇒ a decisão segue abrindo", () => {
    const lido = lerUltimaVisualizacao(storageQueLanca(), "x");
    expect(decidirModalPromocoes({ ...ABRE, ultimaVisualizacao: lido })).toBe(
      true,
    );
  });

});
