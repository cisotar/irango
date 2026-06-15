import { z } from "zod";

// Validação isomórfica (form + Server Action). Espelha as constraints do banco
// (references/schema.md). Contrato documentado em produto.test.ts.
//
// RN-11 / seguranca.md §6: `preco` é tratado como NÚMERO. A coerção string->number
// é responsabilidade da borda (form), não do schema autoritativo do servidor.
// numeric(10,2): negativo, NaN, Infinity e >2 casas decimais são rejeitados.

const preco = z
  .number()
  .finite()
  .min(0)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: "Preço deve ter no máximo 2 casas decimais",
  });

export const schemaProduto = z.object({
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().optional(),
  preco,
  // z.guid(): qualquer UUID com formato válido (sem exigir versão/variante RFC),
  // espelhando o tipo `uuid` do Postgres, que não impõe versão.
  categoria_id: z.guid().nullable().optional(),
  disponivel: z.boolean(),
  ordem: z.number().int().min(0),
});

export const schemaCategoria = z.object({
  nome: z.string().trim().min(1),
  ordem: z.number().int().min(0),
});
