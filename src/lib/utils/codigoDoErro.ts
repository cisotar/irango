/**
 * Código de um erro para o log do servidor (seguranca.md §14): só o `code`
 * (ex.: SQLSTATE do PostgREST), nunca a mensagem, que pode carregar detalhe
 * interno. Sem `code` → "erro".
 */
export function codigoDoErro(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
}
