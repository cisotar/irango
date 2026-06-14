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

// Tipos inferidos para react-hook-form
export type CategoriaOpcionalFormData = z.infer<typeof schemaCategoriaOpcional>;
export type OpcionalFormData = z.infer<typeof schemaOpcional>;
export type AssociacaoCategoriaOpcionalFormData = z.infer<
  typeof schemaAssociacaoCategoriaOpcional
>;
