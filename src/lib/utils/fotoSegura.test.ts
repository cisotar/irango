import { describe, expect, it } from "vitest";
import { fotoSegura } from "./fotoSegura";

// `fotoSegura` delega a `urlHttpsSegura` (fonte única da invariante §15). A
// matriz exaustiva de bordas vive em `urlHttpsSegura.test.ts` — aqui travamos
// apenas o CONTRATO de delegação: aceita https://, rejeita o que não é.
describe("fotoSegura (delega a urlHttpsSegura)", () => {
  it("aceita URL https:// e retorna a propria URL", () => {
    expect(fotoSegura("https://exemplo.com/x.jpg")).toBe(
      "https://exemplo.com/x.jpg",
    );
  });

  it("rejeita protocolo perigoso javascript: -> null", () => {
    expect(fotoSegura("javascript:alert(1)")).toBeNull();
  });

  it("trata null/undefined -> null", () => {
    expect(fotoSegura(null)).toBeNull();
    expect(fotoSegura(undefined)).toBeNull();
  });
});
