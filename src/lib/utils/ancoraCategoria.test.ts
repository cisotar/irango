/**
 * Issue 201 — a âncora do catálogo tem UMA implementação. O teste trava o
 * formato (`cat-<id>` / `grupo-<indice>`) porque `SecaoCatalogo` (id da seção)
 * e `NavCategorias` (href do chip, 203) dependem de casarem byte a byte.
 */
import { describe, it, expect } from "vitest";

import { ancoraCategoria } from "./ancoraCategoria";

describe("201 ancoraCategoria — fonte única da âncora do catálogo", () => {
  it("categoria com id → `cat-<id>` (o índice é ignorado)", () => {
    expect(ancoraCategoria("abc-123", 0)).toBe("cat-abc-123");
    expect(ancoraCategoria("abc-123", 7)).toBe("cat-abc-123");
  });

  it('grupo sem id (o "Outros") → `grupo-<indice>`', () => {
    expect(ancoraCategoria(null, 0)).toBe("grupo-0");
    expect(ancoraCategoria(null, 3)).toBe("grupo-3");
  });

  it("é estável: mesmo (id, indice) → mesma string", () => {
    expect(ancoraCategoria("x", 2)).toBe(ancoraCategoria("x", 2));
    expect(ancoraCategoria(null, 2)).toBe(ancoraCategoria(null, 2));
  });
});
