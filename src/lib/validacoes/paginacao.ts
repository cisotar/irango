import { z } from "zod";

/**
 * Paginação keyset "Carregar mais" da base de clientes do lojista (issue 346, D10).
 * O cursor é o `(ultimo_pedido_em, cliente_id)` do último cliente exibido:
 * ambos presentes ou nenhum (1ª página). O banco repete a regra (22023).
 */
export const POR_PAGINA_CLIENTES = 50;

export const schemaCursorClientes = z
  .object({
    ultimo: z.iso.datetime({ offset: true }),
    // z.guid(): formato uuid sem exigir versão RFC-4122 (convenção de pedido.ts).
    id: z.guid(),
  })
  .strict();

export type CursorClientes = z.infer<typeof schemaCursorClientes>;
