import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) da issue 332 — `src/lib/utils/papeis.ts` (puro).
 *
 * Contrato (plan/tecnico-identidade-cliente.md §3 "TypeScript"):
 *   export const PAPEIS = ["lojista", "cliente"] as const;
 *   export type Papel = (typeof PAPEIS)[number];
 *   export function ehPapel(valor: unknown): valor is Papel;
 *   export function destinoPadraoPorPapel(p: { ehAdmin: boolean; papeis: readonly Papel[] }): string;
 *     admin → "/admin" · lojista → "/painel" · demais → "/"
 *
 * RED: o módulo ainda não existe. Import dinâmico por caso para o vermelho ser
 * por caso (não um erro de coleta do arquivo inteiro), sem stub de produção.
 */

type Papel = "lojista" | "cliente";
type Mod = {
  PAPEIS: readonly string[];
  ehPapel: (v: unknown) => boolean;
  destinoPadraoPorPapel: (p: { ehAdmin: boolean; papeis: readonly Papel[] }) => string;
};

async function carregar(): Promise<Mod> {
  return (await import("./papeis")) as unknown as Mod;
}

describe("destinoPadraoPorPapel (issue 332)", () => {
  const conjuntos: Papel[][] = [[], ["lojista"], ["cliente"], ["lojista", "cliente"]];

  for (const papeis of conjuntos) {
    it(`[332-16a] admin com ${JSON.stringify(papeis)} → '/admin'`, async () => {
      const { destinoPadraoPorPapel } = await carregar();
      expect(destinoPadraoPorPapel({ ehAdmin: true, papeis })).toBe("/admin");
    });
  }

  it("[332-16b] ['lojista'] → '/painel'", async () => {
    const { destinoPadraoPorPapel } = await carregar();
    expect(destinoPadraoPorPapel({ ehAdmin: false, papeis: ["lojista"] })).toBe("/painel");
  });

  it("[332-16b] ['lojista','cliente'] → '/painel' (decisão 15)", async () => {
    const { destinoPadraoPorPapel } = await carregar();
    expect(destinoPadraoPorPapel({ ehAdmin: false, papeis: ["lojista", "cliente"] })).toBe("/painel");
  });

  it("[332-16c] ['cliente'] → '/', nunca '/painel'", async () => {
    const { destinoPadraoPorPapel } = await carregar();
    const d = destinoPadraoPorPapel({ ehAdmin: false, papeis: ["cliente"] });
    expect(d).toBe("/");
    expect(d).not.toBe("/painel");
  });

  it("[332-16c] [] → '/', nunca '/painel'", async () => {
    const { destinoPadraoPorPapel } = await carregar();
    const d = destinoPadraoPorPapel({ ehAdmin: false, papeis: [] });
    expect(d).toBe("/");
    expect(d).not.toBe("/painel");
  });
});

describe("ehPapel (issue 332)", () => {
  it("[332-17] aceita 'lojista' e 'cliente'", async () => {
    const { ehPapel } = await carregar();
    expect(ehPapel("lojista")).toBe(true);
    expect(ehPapel("cliente")).toBe(true);
  });

  for (const valor of ["admin", "LOJISTA", "", null, 1] as unknown[]) {
    it(`[332-17] recusa ${JSON.stringify(valor)}`, async () => {
      const { ehPapel } = await carregar();
      expect(ehPapel(valor)).toBe(false);
    });
  }

  it("[332-17] PAPEIS é exatamente ['lojista','cliente']", async () => {
    const { PAPEIS } = await carregar();
    expect([...PAPEIS]).toEqual(["lojista", "cliente"]);
  });
});
