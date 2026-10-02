import { z } from "zod";

/**
 * Paginação "Carregar mais" da base de clientes do lojista (issue 346).
 * `?pagina=N` (0-based) → inteiro em [0, MAX_PAGINA_CLIENTES]; qualquer outro
 * valor cai em 0. O limite por chamada tem teto 100 (o banco repete o teto).
 */
export const POR_PAGINA_CLIENTES = 50;
export const LIMITE_MAXIMO_CLIENTES = 100;
export const MAX_PAGINA_CLIENTES = 100;

export const schemaPaginaClientes = z.coerce
  .number()
  .int()
  .min(0)
  .max(MAX_PAGINA_CLIENTES)
  .catch(0);

export const schemaLimiteClientes = z.number().int().min(1).max(LIMITE_MAXIMO_CLIENTES);
