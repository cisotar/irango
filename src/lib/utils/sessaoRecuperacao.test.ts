import { describe, expect, it } from "vitest";
import { ehSessaoDeRecuperacao } from "./sessaoRecuperacao";

describe("ehSessaoDeRecuperacao", () => {
  it("aceita string 'recovery'", () => {
    expect(ehSessaoDeRecuperacao(["password", "recovery"])).toBe(true);
  });
  it("aceita objeto { method: 'recovery' }", () => {
    expect(ehSessaoDeRecuperacao([{ method: "recovery", timestamp: 1 }])).toBe(true);
  });
  it("rejeita sessão comum", () => {
    expect(ehSessaoDeRecuperacao(["password", { method: "oauth" }])).toBe(false);
  });
  it("rejeita não-array e valores inválidos", () => {
    expect(ehSessaoDeRecuperacao(undefined)).toBe(false);
    expect(ehSessaoDeRecuperacao("recovery")).toBe(false);
    expect(ehSessaoDeRecuperacao({ method: "recovery" })).toBe(false);
    expect(ehSessaoDeRecuperacao([null, 1, { method: "RECOVERY" }])).toBe(false);
  });
});
