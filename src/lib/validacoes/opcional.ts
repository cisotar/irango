import { z } from "zod";

// Validação isomórfica (form + Server Action). Espelha as constraints do banco.
// seguranca.md §6: valores monetários validados no servidor — cliente só envia
// os campos listados aqui, nunca subtotais ou totais calculados.
//
// numeric(10,2): negativo, NaN, Infinity e >2 casas decimais são rejeitados.

const preco = z
  .number()
  .finite()
  .min(0)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: "Preço deve ter no máximo 2 casas decimais",
  });

export const schemaCategoriaOpcional = z
  .object({
    nome: z.string().trim().min(1),
    ordem: z.number().int().min(0),
  })
  .strict();

export const schemaOpcional = z
  .object({
    nome: z.string().trim().min(1),
    preco,
    // z.guid(): qualquer UUID com formato válido, espelhando o tipo `uuid` do Postgres
    categoria_opcional_id: z.guid(),
    ativo: z.boolean(),
    ordem: z.number().int().min(0),
  })
  .strict();

export const schemaAssociacaoCategoriaOpcional = z
  .object({
    categoria_id: z.guid(),
    categoria_opcional_id: z.array(z.guid()),
  })
  .strict();

/**
 * Reordenação dos GRUPOS de opcional dentro de UMA categoria de produto
 * (issue 208). Espelha `schemaReordenacaoCategorias`
 * (src/lib/validacoes/produto.ts:60) e NÃO reusa
 * `schemaAssociacaoCategoriaOpcional`: lá a lista é um conjunto, aqui é uma
 * SEQUÊNCIA, e duplicata/lista de 1 são inválidas.
 *
 * O cliente manda só ids — nunca `ordem` (derivada de `ordinality - 1` na RPC)
 * nem `loja_id` (derivada de `auth.uid()` na Server Action). O `.strict()` é o
 * que impede uma propriedade hostil pendurada no payload de chegar aos args da
 * RPC; o parse devolve um objeto NOVO.
 *
 * `.min(2)`: lista de 1 não tem ordem. `.max(200)`: teto de cardinalidade
 * (CWE-770). O refine de unicidade é defesa em profundidade — a RPC também
 * rejeita duplicata pelo `row_count`, mas ela nem deve chegar ao banco.
 */
export const schemaReordenacaoOpcionaisDaCategoria = z
  .object({
    categoria_id: z.guid(),
    categoria_opcional_id: z.array(z.guid()).min(2).max(200),
  })
  .strict()
  .refine(({ categoria_opcional_id: ids }) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na reordenação",
  });

// Tipos inferidos para react-hook-form
export type CategoriaOpcionalFormData = z.infer<typeof schemaCategoriaOpcional>;
export type OpcionalFormData = z.infer<typeof schemaOpcional>;
export type AssociacaoCategoriaOpcionalFormData = z.infer<
  typeof schemaAssociacaoCategoriaOpcional
>;
export type ReordenacaoOpcionaisDaCategoriaFormData = z.infer<
  typeof schemaReordenacaoOpcionaisDaCategoria
>;
