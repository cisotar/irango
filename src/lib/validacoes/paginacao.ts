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

// ── issue 347: detalhe do cliente + aniversariantes ─────────────────────────

/** Formato uuid (sem exigir versão RFC-4122): `[id]` inválido → 404 sem ir ao banco. */
export const schemaUuid = z.guid();

/** `?aniversariantes=1` liga o filtro; qualquer outro valor (ou ausência) = sem filtro. */
export const schemaFiltroAniversariantes = z
  .unknown()
  .transform((v) => v === "1");

/** Mês de nascimento do filtro (RN-D10): inteiro 1..12. O banco repete a regra (22023). */
export const schemaMes = z.int().min(1).max(12);

/** Pedidos do detalhe do cliente (D3): 50 por página, "Carregar mais" por página. */
export const POR_PAGINA_PEDIDOS_CLIENTE = 50;
export const schemaPaginaPedidosCliente = z.int().min(1).max(1000);
