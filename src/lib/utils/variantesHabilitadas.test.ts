import { describe, it, expect } from "vitest";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import {
  variantesHabilitadas,
  type VarianteImpressao,
} from "./variantesHabilitadas";

// ===========================================================================
// CONTRATO (issue 130 — fonte ÚNICA do entitlement de impressão, RN-M2)
//
// type VarianteImpressao = "a4" | "cozinha" | "recibo"
//
// variantesHabilitadas(
//   loja: Pick<LojaCompleta, "modulo_impressao_a4" | "modulo_impressao_termica"> | null,
// ): VarianteImpressao[]
//
// Mapa RN-M2 (ordem estável — a4, cozinha, recibo):
//   modulo_impressao_a4      === true → inclui "a4"
//   modulo_impressao_termica === true → inclui "cozinha" e "recibo"
//
// Fail-closed (espelha decidirAcessoPainel): SÓ o booleano literal `true` habilita.
//   loja === null → []; flag undefined/null/valor não-booleano (1, "true") → NÃO habilita.
//   Um bug que liberasse variante não contratada = burla de entitlement (criticidade).
// ===========================================================================

// --- Builder de input não-confiável (aceita qualquer valor, como o banco pode
//     devolver); espelha a FORMA real, não a lógica. Cast idêntico ao de
//     acessoPainel.test.ts para poder injetar valores fora do tipo boolean. ---
function fazerLoja(
  a4: unknown,
  termica: unknown,
): Pick<LojaCompleta, "modulo_impressao_a4" | "modulo_impressao_termica"> {
  return {
    modulo_impressao_a4: a4,
    modulo_impressao_termica: termica,
  } as unknown as Pick<
    LojaCompleta,
    "modulo_impressao_a4" | "modulo_impressao_termica"
  >;
}

// ===========================================================================
// 1. MAPA RN-M2 — módulo → variantes
// ===========================================================================
describe("variantesHabilitadas — mapa RN-M2", () => {
  it("só A4 (a4=true, térmica=false) → ['a4']", () => {
    expect(variantesHabilitadas(fazerLoja(true, false))).toEqual(["a4"]);
  });

  it("só térmica (a4=false, térmica=true) → ['cozinha','recibo']", () => {
    expect(variantesHabilitadas(fazerLoja(false, true))).toEqual([
      "cozinha",
      "recibo",
    ]);
  });

  it("ambos os módulos → ['a4','cozinha','recibo']", () => {
    expect(variantesHabilitadas(fazerLoja(true, true))).toEqual([
      "a4",
      "cozinha",
      "recibo",
    ]);
  });

  it("nenhum módulo (a4=false, térmica=false) → []", () => {
    expect(variantesHabilitadas(fazerLoja(false, false))).toEqual([]);
  });
});

// ===========================================================================
// 2. ORDEM ESTÁVEL — sempre a4, depois cozinha, depois recibo
// ===========================================================================
describe("variantesHabilitadas — ordem estável", () => {
  it("com ambos os módulos a ordem é exatamente a4 → cozinha → recibo", () => {
    const esperado: VarianteImpressao[] = ["a4", "cozinha", "recibo"];
    // toEqual em array compara ordem: pega qualquer permutação da lista.
    expect(variantesHabilitadas(fazerLoja(true, true))).toEqual(esperado);
  });

  it("a4 sempre precede as variantes térmicas quando ambos ligados", () => {
    const out = variantesHabilitadas(fazerLoja(true, true));
    expect(out.indexOf("a4")).toBeLessThan(out.indexOf("cozinha"));
    expect(out.indexOf("cozinha")).toBeLessThan(out.indexOf("recibo"));
  });
});

// ===========================================================================
// 3. FAIL-CLOSED — só o literal `true` habilita; qualquer dúvida → não habilita
// ===========================================================================
describe("variantesHabilitadas — fail-closed (loja null)", () => {
  it("loja === null → [] (nada habilitado)", () => {
    expect(variantesHabilitadas(null)).toEqual([]);
  });
});

describe("variantesHabilitadas — fail-closed (flag A4 não-true)", () => {
  it("a4 undefined → não habilita 'a4'", () => {
    expect(variantesHabilitadas(fazerLoja(undefined, false))).toEqual([]);
  });

  it("a4 null → não habilita 'a4'", () => {
    expect(variantesHabilitadas(fazerLoja(null, false))).toEqual([]);
  });

  it("a4 = 1 (number truthy) → não habilita 'a4' (só o literal true)", () => {
    expect(variantesHabilitadas(fazerLoja(1, false))).toEqual([]);
  });

  it("a4 = 'true' (string) → não habilita 'a4' (só o literal true)", () => {
    expect(variantesHabilitadas(fazerLoja("true", false))).toEqual([]);
  });
});

describe("variantesHabilitadas — fail-closed (flag térmica não-true)", () => {
  it("térmica undefined → não habilita 'cozinha'/'recibo'", () => {
    expect(variantesHabilitadas(fazerLoja(false, undefined))).toEqual([]);
  });

  it("térmica null → não habilita 'cozinha'/'recibo'", () => {
    expect(variantesHabilitadas(fazerLoja(false, null))).toEqual([]);
  });

  it("térmica = 1 (number truthy) → não habilita térmicas (só o literal true)", () => {
    expect(variantesHabilitadas(fazerLoja(false, 1))).toEqual([]);
  });

  it("térmica = 'true' (string) → não habilita térmicas (só o literal true)", () => {
    expect(variantesHabilitadas(fazerLoja(false, "true"))).toEqual([]);
  });
});

describe("variantesHabilitadas — fail-closed (mistura true + não-true)", () => {
  it("a4=true e térmica='true' → apenas ['a4'] (térmica não-true é ignorada)", () => {
    expect(variantesHabilitadas(fazerLoja(true, "true"))).toEqual(["a4"]);
  });

  it("a4=1 e térmica=true → apenas ['cozinha','recibo'] (a4 não-true é ignorada)", () => {
    expect(variantesHabilitadas(fazerLoja(1, true))).toEqual([
      "cozinha",
      "recibo",
    ]);
  });

  it("ambas as flags não-true (1 e 'true') → [] (nenhuma burla de entitlement)", () => {
    expect(variantesHabilitadas(fazerLoja(1, "true"))).toEqual([]);
  });
});
