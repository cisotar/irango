/**
 * Anti open-redirect (RN-15, decisão 21): aceita só path interno (começa com
 * '/', mas não com '//', que o navegador interpreta como URL protocol-relative).
 * Qualquer outra coisa → undefined (cai no destino padrão).
 * Extraída do callback (issue 336) sem mudar a regra; reusada pelas actions.
 */
export function sanitizarNext(next: string | null | undefined): string | undefined {
  if (next === null || next === undefined) return undefined;
  if (!next.startsWith("/")) return undefined;
  if (next.startsWith("//")) return undefined;
  return next;
}
