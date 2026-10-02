/**
 * `true` se o claim `amr` do JWT indica sessão aberta por link de recuperação
 * (entrada string "recovery" ou objeto `{ method: "recovery" }`). Puro: usado
 * pela página (UX) e por `redefinirSenhaCliente` (autoridade).
 */
export function ehSessaoDeRecuperacao(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((e) =>
    typeof e === "string"
      ? e === "recovery"
      : typeof e === "object" && e !== null && (e as { method?: unknown }).method === "recovery",
  );
}
