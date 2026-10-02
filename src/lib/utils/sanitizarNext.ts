/**
 * Anti open-redirect (RN-15, decisão 21): aceita só path interno (começa com
 * '/', mas não com '//', que o navegador interpreta como URL protocol-relative).
 * Rejeita também '\' (o navegador trata como '/') e caracteres de controle
 * (\t \n \r são descartados pelo parser de URL), e qualquer valor que,
 * resolvido contra uma origem fictícia, mude de origem.
 * Qualquer outra coisa → undefined (cai no destino padrão).
 */
const ORIGEM_FICTICIA = "http://origem.invalid";

export function sanitizarNext(next: string | null | undefined): string | undefined {
  if (next === null || next === undefined) return undefined;
  if (!next.startsWith("/")) return undefined;
  if (next.startsWith("//")) return undefined;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return undefined;
  try {
    if (new URL(next, ORIGEM_FICTICIA).origin !== ORIGEM_FICTICIA) return undefined;
  } catch {
    return undefined;
  }
  return next;
}
