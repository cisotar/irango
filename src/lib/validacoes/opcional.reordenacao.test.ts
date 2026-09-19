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
import {
  schemaReordenacaoOpcionaisDaCategoria,
  // AINDA NÃO EXISTE (issue 215) — este import é o vermelho da camada 1.
  schemaReordenacaoItensDoGrupo,
} from "./opcional";

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

// ════════════════════════════════════════════════════════════════════════════
// Fase RED (TDD) da issue 215 — `schemaReordenacaoItensDoGrupo`.
//
// Irmão do schema da 208, um nível abaixo na árvore: lá a sequência é de GRUPOS
// dentro de uma categoria de PRODUTO; aqui é de ITENS dentro de um GRUPO. As
// chaves são OUTRAS (`categoria_opcional_id` escalar + `opcional_id` array) —
// por isso o schema é novo e não um alias, e [215-V15] prova justamente que um
// alias não passaria.
//
// O símbolo AINDA NÃO EXISTE em `./opcional`: o import acima falha e derruba o
// arquivo inteiro (inclusive o describe 208 verde). É o vermelho legítimo desta
// fase — nenhuma linha de produção é escrita aqui; o schema é da fase GREEN.
// ════════════════════════════════════════════════════════════════════════════

const GRUPO = "44444444-4444-4444-8444-444444444444";
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const I2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const I3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("215 schemaReordenacaoItensDoGrupo", () => {
  it("[215-V1] aceita categoria_opcional_id + lista de 2 ou mais guids únicos", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, I2, I3],
    });
    expect(r.success).toBe(true);
  });

  it("[215-V2] rejeita id duplicado — e pelo REFINE de unicidade, não por min/max", () => {
    // Defesa em profundidade: a RPC também derruba duplicata pelo `row_count`
    // (caso [215-I10]), mas ela não deve nem chegar ao banco. A asserção olha o
    // `code` do issue: um `.length` acidental reprovaria com outro código e
    // deixaria a duplicata passar quando a cardinalidade batesse.
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, I1, I3],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i: { code: string }) => i.code)).toContain("custom");
  });

  it("[215-V3] rejeita item que não é guid", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, "nao-e-um-guid"],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V4] rejeita categoria_opcional_id ausente", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({ opcional_id: [I1, I2] });
    expect(r.success).toBe(false);
  });

  it("[215-V5] rejeita categoria_opcional_id que não é guid", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: "nao-e-um-guid",
      opcional_id: [I1, I2],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V6] rejeita opcional_id ausente", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({ categoria_opcional_id: GRUPO });
    expect(r.success).toBe(false);
  });

  it("[215-V7] rejeita propriedade extra (.strict) — loja_id não pode vir do cliente", () => {
    // Vetor real: `loja_id` no payload. `p_loja_id` da RPC vem de
    // `buscarLojaDoDono` (auth.uid()); se o `.strict()` faltasse e a action
    // espalhasse o objeto nos args, o lojista escolheria a loja-alvo — o caso
    // [215-I3] da suíte pglite, uma camada acima.
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, I2],
      loja_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(r.success).toBe(false);
  });

  it("[215-V8] rejeita propriedade extra `ordem` (.strict) — a ordem é derivada no servidor", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, I2],
      ordem: 3,
    });
    expect(r.success).toBe(false);
  });

  it("[215-V9] rejeita lista com menos de 2 ids", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V10] rejeita lista vazia", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V11] FRONTEIRA do .min(2): exatamente 2 ids passa", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I1, I2],
    });
    expect(r.success).toBe(true);
  });

  it("[215-V12] rejeita lista acima de 200 ids (teto de cardinalidade, CWE-770)", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: guidsSequenciais(201),
    });
    expect(r.success).toBe(false);
  });

  it("[215-V13] FRONTEIRA do .max(200): exatamente 200 ids passa (o teto é 200, não 199)", () => {
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: guidsSequenciais(200),
    });
    expect(r.success).toBe(true);
  });

  it("[215-V14] rejeita array aninhado (o vetor de cardinality da RPC nem chega ao banco)", () => {
    // Espelha [215-I12]: `cardinality` conta 4 num array 2x2 e a RPC recusaria —
    // mas o payload não deve sequer sair do processo Node.
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_opcional_id: GRUPO,
      opcional_id: [[I1, I2], [I2, I3]],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V15] NÃO é alias do schema da 208: o payload de GRUPOS é rejeitado aqui", () => {
    // Se a fase GREEN reexportasse o schema da 208 com outro nome, este payload
    // passaria e o `.strict()` da camada errada validaria a chave errada.
    const r = schemaReordenacaoItensDoGrupo.safeParse({
      categoria_id: GRUPO,
      categoria_opcional_id: [I1, I2],
    });
    expect(r.success).toBe(false);
  });

  it("[215-V16] o parse devolve OBJETO NOVO com exatamente as duas chaves", () => {
    const r = schemaReordenacaoItensDoGrupo.parse({
      categoria_opcional_id: GRUPO,
      opcional_id: [I2, I1],
    });
    expect(Object.keys(r).sort()).toEqual(["categoria_opcional_id", "opcional_id"]);
    // A SEQUÊNCIA é o dado: o parse não pode ordenar/normalizar a lista.
    expect(r.opcional_id).toEqual([I2, I1]);
  });
});

function guidsSequenciais(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
}

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 215, validação:
 *
 * Em `src/lib/validacoes/opcional.ts`, logo após
 * `schemaReordenacaoOpcionaisDaCategoria` (:58-66):
 *
 *   export const schemaReordenacaoItensDoGrupo = z
 *     .object({
 *       categoria_opcional_id: z.guid(),
 *       opcional_id: z.array(z.guid()).min(2).max(200),
 *     })
 *     .strict()
 *     .refine(({ opcional_id: ids }) => new Set(ids).size === ids.length, {
 *       message: "Ids repetidos na reordenação",
 *     });
 *
 *   export type ReordenacaoItensDoGrupoFormData = z.infer<
 *     typeof schemaReordenacaoItensDoGrupo
 *   >;
 *
 * Casos que precisam passar: [215-V1]..[215-V16].
 */
