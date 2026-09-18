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
    // OPCIONAL de propósito (216): ausente = "não mexer na ordem". `ordem` é
    // propriedade da RPC `reordenar_itens_do_grupo_opcional` (215), a única
    // escrita que garante permutação completa. A edição inline de nome/preço
    // NÃO manda `ordem`; a aba Biblioteca, que tem campo numérico explícito,
    // continua mandando, e a criação manda `max(ordem)+1`.
    //
    // Enquanto era obrigatório, `update({ ...parsed.data })` reescrevia a ordem
    // a CADA edição. Como a coluna nasce `default 0`, todo grupo que nunca foi
    // reordenado tem todas as linhas em 0 — editar o preço do item do meio
    // mandava `ordem: 1` e o jogava para o fim, no painel E na vitrine.
    ordem: z.number().int().min(0).optional(),
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

/**
 * Reordenação dos ITENS (linhas de `opcionais`) dentro de UM grupo de opcional
 * (issue 215). Irmão do schema acima, um nível abaixo na árvore: lá a sequência
 * é de GRUPOS dentro de uma categoria de PRODUTO; aqui é de ITENS dentro de um
 * GRUPO. As chaves são OUTRAS, por isso é um schema novo e não um alias.
 *
 * Mesmas garantias: o cliente manda só ids — nunca `ordem` (derivada de
 * `ordinality - 1` na RPC) nem `loja_id` (derivada de `auth.uid()` na Server
 * Action, ou do `lojaId` da URL na via admin). O `.strict()` impede propriedade
 * hostil pendurada no payload de chegar aos args da RPC; o parse devolve um
 * objeto NOVO e NÃO reordena a lista — a SEQUÊNCIA é o dado.
 *
 * `.min(2)`: lista de 1 não tem ordem. `.max(200)`: teto de cardinalidade
 * (CWE-770). O refine de unicidade é defesa em profundidade — a RPC também
 * rejeita duplicata pelo `row_count`, mas ela nem deve chegar ao banco.
 */
export const schemaReordenacaoItensDoGrupo = z
  .object({
    categoria_opcional_id: z.guid(),
    opcional_id: z.array(z.guid()).min(2).max(200),
  })
  .strict()
  .refine(({ opcional_id: ids }) => new Set(ids).size === ids.length, {
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
export type ReordenacaoItensDoGrupoFormData = z.infer<
  typeof schemaReordenacaoItensDoGrupo
>;
