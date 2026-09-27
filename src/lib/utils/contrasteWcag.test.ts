import { describe, expect, it } from "vitest";

import {
  COR_LINK_MENSAGEM,
  FUNDO_MODAL_MENSAGEM,
  PALETA_MENSAGEM,
} from "@/lib/constants/paletaMensagem";

import { razaoContraste } from "./contrasteWcag";

describe("razaoContraste", () => {
  it("preto sobre branco = 21:1 e é simétrica", () => {
    expect(razaoContraste("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(razaoContraste("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("mesma cor = 1:1", () => {
    expect(razaoContraste("#1d4ed8", "#1d4ed8")).toBeCloseTo(1, 5);
  });

  it("confere os valores medidos no spec (RN-M13)", () => {
    expect(razaoContraste("#b91c1c", "#ffffff")).toBeCloseTo(6.47, 1);
    expect(razaoContraste("#166534", "#ffffff")).toBeCloseTo(7.13, 1);
  });

  it("lança para cor fora de #rrggbb", () => {
    expect(() => razaoContraste("red", "#ffffff")).toThrow();
    expect(() => razaoContraste("#fff", "#ffffff")).toThrow();
  });
});

describe("paleta da mensagem passa AA sobre o fundo do modal", () => {
  it.each(Object.entries(PALETA_MENSAGEM))("%s ≥ 4,5:1", (_chave, cor) => {
    expect(razaoContraste(cor, FUNDO_MODAL_MENSAGEM)).toBeGreaterThanOrEqual(4.5);
  });

  it("cor do link ≥ 4,5:1", () => {
    expect(razaoContraste(COR_LINK_MENSAGEM, FUNDO_MODAL_MENSAGEM)).toBeGreaterThanOrEqual(4.5);
  });
});
