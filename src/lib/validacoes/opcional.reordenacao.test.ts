// Fase RED (TDD) da issue 208 — `schemaReordenacaoOpcionaisDaCategoria`.
//
// O schema AINDA NÃO EXISTE em `./opcional`: o import abaixo falha e derruba o
// arquivo. É esse o vermelho. Arquivo SEPARADO de `opcional.test.ts` de
// propósito — um import quebrado mataria também os testes já verdes dos outros
// schemas, escondendo regressão real durante a fase GREEN.
//
// Papel do schema (seguranca.md §14 + RN-4): o parse devolve um OBJETO NOVO, com
// exatamente `categoria_id` e `categoria_opcional_id`. Assim, propriedade hostil
// pendurada pelo cliente (`loja_id`, `ordem`) nunca chega aos args da RPC — a
// `loja_id` vem de `buscarLojaDoDono`, e a `ordem` é derivada de `ordinality - 1`
// no servidor.

import { describe, it, expect } from "vitest";
import { schemaReordenacaoOpcionaisDaCategoria } from "./opcional";

const CAT = "550e8400-e29b-41d4-a716-446655440000";
const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const G3 = "33333333-3333-4333-8333-333333333333";

describe("208 schemaReordenacaoOpcionaisDaCategoria", () => {
  it("[208-V1] aceita categoria_id + lista de 2 ou mais guids únicos", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [G1, G2, G3],
    });
    expect(r.success).toBe(true);
  });

  it("[208-V2] rejeita id duplicado na lista", () => {
    // Defesa em profundidade: a RPC também recusa pelo `row_count`, mas
    // duplicata não deve nem chegar ao banco.
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [G1, G1, G2],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V3] rejeita item que não é guid", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [G1, "nao-e-um-guid"],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V4] rejeita categoria_id ausente", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_opcional_id: [G1, G2],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V5] rejeita categoria_id que não é guid", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: "nao-e-um-guid",
      categoria_opcional_id: [G1, G2],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V6] rejeita propriedade extra (.strict) — loja_id não pode vir do cliente (RN-5)", () => {
    // Vetor real: `loja_id` no payload. Se o schema fosse permissivo e a action
    // espalhasse o objeto nos args da RPC, o lojista escolheria a loja-alvo.
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [G1, G2],
      loja_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(r.success).toBe(false);
  });

  it("[208-V7] rejeita lista com menos de 2 ids", () => {
    // Lista de 1 não tem ordem (o botão "Reordenar" nem habilita).
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [G1],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V8] rejeita lista acima de 200 ids (teto de cardinalidade, CWE-770)", () => {
    const muitos = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: muitos,
    });
    expect(r.success).toBe(false);
  });

  it("[208-V9] rejeita array aninhado (o vetor de cardinality da RPC nem chega ao banco)", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.safeParse({
      categoria_id: CAT,
      categoria_opcional_id: [[G1, G2], [G2, G3]],
    });
    expect(r.success).toBe(false);
  });

  it("[208-V10] o parse devolve OBJETO NOVO com exatamente as duas chaves", () => {
    const r = schemaReordenacaoOpcionaisDaCategoria.parse({
      categoria_id: CAT,
      categoria_opcional_id: [G1, G2],
    });
    expect(Object.keys(r).sort()).toEqual(["categoria_id", "categoria_opcional_id"]);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 208, validação:
 *
 * Em `src/lib/validacoes/opcional.ts`, espelhando `schemaReordenacaoCategorias`
 * (src/lib/validacoes/produto.ts:60):
 *
 *   export const schemaReordenacaoOpcionaisDaCategoria = z
 *     .object({
 *       categoria_id: z.guid(),
 *       categoria_opcional_id: z.array(z.guid()).min(2).max(200),
 *     })
 *     .strict()
 *     .refine(({ categoria_opcional_id: ids }) => new Set(ids).size === ids.length, {
 *       message: "Ids repetidos na reordenação",
 *     });
 *
 * Casos que precisam passar: [208-V1]..[208-V10].
 */
