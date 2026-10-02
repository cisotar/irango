import { z } from "zod";

/**
 * Telefone com DDD obrigatório (issue 346, D4b/D4c). Fonte ÚNICA reusada por
 * `cliente.ts`, `pedido.ts` e `checkout.ts`.
 *
 * - formato bruto: mesma regex do CHECK do banco (`^\+?[\d\s()-]{8,20}$`) —
 *   o valor gravado continua como digitado (o CHECK não muda);
 * - dígitos (sem máscara): 10 (fixo) ou 11 (celular), DDD sem zero;
 * - prefixo 55 aceito: com 12/13 dígitos começando em 55, o 55 é descartado
 *   antes da contagem.
 */
const FORMATO_BRUTO = /^\+?[\d\s()-]{8,20}$/;
const NACIONAL = /^[1-9]{2}\d{8,9}$/;

/** Dígitos nacionais (DDD + número) ou `null` se não houver DDD válido. */
export function digitosNacionais(valor: string | null | undefined): string | null {
  let d = (valor ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return NACIONAL.test(d) ? d : null;
}

export function telefoneComDddValido(valor: string): boolean {
  return FORMATO_BRUTO.test(valor) && digitosNacionais(valor) !== null;
}

export const MENSAGEM_TELEFONE_DDD = "Informe o telefone com DDD.";

export const campoTelefoneComDdd = z
  .string()
  .trim()
  .refine(telefoneComDddValido, { message: MENSAGEM_TELEFONE_DDD });
