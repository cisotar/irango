import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) — schemas zod da galeria (`src/lib/validacoes/galeria.ts`).
 *
 * RED hoje: o módulo ainda não existe; o import falha na coleta.
 *
 * RN-G9: lote de remoção tem de 1 a 50 ids DISTINTOS (zod é a camada de forma;
 * a RPC repete T1). O cursor só posiciona a página, nunca escolhe a loja. O
 * `origem_id` do recorte é um uuid (o resto da prova — original não pendente da
 * mesma loja — é da action + FK composta).
 */

import { schemaIdsImagens, schemaCursorGaleria, schemaOrigemId } from "./galeria";

function guid(n: number): string {
  return `aaaaaaaa-aaaa-aaaa-aaaa-${n.toString().padStart(12, "0")}`;
}
function ids(qtd: number): string[] {
  return Array.from({ length: qtd }, (_, i) => guid(i + 1));
}

describe("schemaIdsImagens (RN-G9: 1..50, distintos, uuid)", () => {
  it("aceita 1 id", () => {
    expect(schemaIdsImagens.safeParse(ids(1)).success).toBe(true);
  });

  it("aceita exatamente 50 ids", () => {
    expect(schemaIdsImagens.safeParse(ids(50)).success).toBe(true);
  });

  it.each([
    ["lista vazia", []],
    ["51 ids", ids(51)],
    ["duplicata", [guid(1), guid(2), guid(1)]],
    ["id não-uuid", [guid(1), "nao-e-uuid"]],
    ["número no lugar de id", [guid(1), 7]],
    ["não é array", guid(1)],
    ["null", null],
    ["objeto com loja_id", { loja_id: guid(9), ids: ids(2) }],
  ])("recusa %s", (_r, v) => {
    expect(schemaIdsImagens.safeParse(v).success).toBe(false);
  });
});

describe("schemaCursorGaleria (keyset criado_em desc, id desc; opcional)", () => {
  it("ausente é a primeira página", () => {
    expect(schemaCursorGaleria.safeParse(undefined).success).toBe(true);
  });

  it("aceita {criado_em ISO, id uuid}", () => {
    const r = schemaCursorGaleria.safeParse({
      criado_em: "2026-10-06T12:00:00.000Z",
      id: guid(1),
    });
    expect(r.success).toBe(true);
  });

  it("aceita ISO com offset (formato do timestamptz do PostgREST)", () => {
    const r = schemaCursorGaleria.safeParse({
      criado_em: "2026-10-06T12:00:00.123456+00:00",
      id: guid(1),
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["data inválida", { criado_em: "ontem", id: guid(1) }],
    ["id não-uuid", { criado_em: "2026-10-06T12:00:00.000Z", id: "x" }],
    ["sem id", { criado_em: "2026-10-06T12:00:00.000Z" }],
    ["sem criado_em", { id: guid(1) }],
    ["string solta", "2026-10-06T12:00:00.000Z"],
  ])("recusa %s", (_r, v) => {
    expect(schemaCursorGaleria.safeParse(v).success).toBe(false);
  });
});

describe("schemaOrigemId (uuid)", () => {
  it("aceita uuid", () => {
    expect(schemaOrigemId.safeParse(guid(1)).success).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["não-uuid", "abc"],
    ["null", null],
    ["undefined", undefined],
    ["número", 1],
  ])("recusa %s", (_r, v) => {
    expect(schemaOrigemId.safeParse(v).success).toBe(false);
  });
});
