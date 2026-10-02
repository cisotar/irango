import { describe, it, expect } from "vitest";
import { schemaCursorClientes } from "./paginacao";

const ID = "11111111-1111-4111-8111-111111111111";

describe("schemaCursorClientes (346 D10)", () => {
  it.each(["2026-10-02T12:00:00Z", "2026-10-02T12:00:00.123456+00:00", "2026-10-02T09:00:00-03:00"])(
    "aceita ISO datetime %s + uuid",
    (ultimo) => {
      expect(schemaCursorClientes.safeParse({ ultimo, id: ID }).success).toBe(true);
    },
  );
  it.each([
    [{ ultimo: "2026-10-02T12:00:00Z" }],
    [{ id: ID }],
    [{ ultimo: "ontem", id: ID }],
    [{ ultimo: "2026-10-02", id: ID }],
    [{ ultimo: "2026-10-02T12:00:00Z", id: "abc" }],
    [{ ultimo: "2026-10-02T12:00:00Z", id: ID, loja_id: ID }],
    [null],
  ])("recusa %j (parcial, inválido ou chave extra)", (v) => {
    expect(schemaCursorClientes.safeParse(v).success).toBe(false);
  });
});
