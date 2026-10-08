import { describe, it, expect } from "vitest";
import * as patches from "./patches-loja";

/**
 * Fase RED (TDD) da issue 354 — `montarPatchCiclo` em `src/lib/actions/patches-loja.ts`.
 * Autoridade: plan/tecnico-relatorio-vendas.md §7.7 e §8.6.
 *
 * Contrato: montarPatchCiclo(d: DadosCicloVendas) → { dia_inicio_ciclo } (allowlist coluna a
 * coluna, sem spread). É o builder único que o lojista e o admin passam ao UPDATE: nenhuma
 * chave hostil do payload (billing, dono, id) pode atravessá-lo.
 *
 * RED: o módulo existe, o export não. Resolvido pelo namespace para o RED ser "export
 * ausente" na asserção, sem quebrar os outros testes de patches-loja.
 */

function montarPatchCiclo(): (d: unknown) => Record<string, unknown> {
  const fn = (patches as Record<string, unknown>).montarPatchCiclo;
  if (typeof fn !== "function") {
    throw new Error("[RED 354] `montarPatchCiclo` ainda não existe em src/lib/actions/patches-loja.ts (§7.7).");
  }
  return fn as (d: unknown) => Record<string, unknown>;
}

describe("montarPatchCiclo — allowlist (354)", () => {
  it("emite SÓ dia_inicio_ciclo, descartando billing/dono/id do payload hostil", () => {
    const hostil = {
      dia_inicio_ciclo: 7,
      assinatura_status: "ativa",
      dono_id: "99999999-9999-4999-8999-999999999999",
      id: "88888888-8888-4888-8888-888888888888",
    };
    const patch = montarPatchCiclo()(hostil as never);
    expect(patch).toEqual({ dia_inicio_ciclo: 7 });
    expect(Object.keys(patch)).toEqual(["dia_inicio_ciclo"]);
  });
});
