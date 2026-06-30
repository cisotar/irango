// Função PURA: fonte ÚNICA da invariante anti-XSS §15 (seguranca.md). Decide se
// uma URL pode virar atributo de navegação remota — `src` de imagem OU `href` de
// link. URLs chegam de input não confiável (lojista, payload de provider externo),
// então só uma URL que começa EXATAMENTE com "https://" é aceita; `javascript:`,
// `data:`, `http://`, protocol-relative `//`, caminhos relativos e qualquer outra
// forma viram `null` (placeholder/traço no render). Sem I/O, sem throw: a "falha"
// é silenciosa por design.
//
// Genérico de propósito: especializações de domínio (ex: `fotoSegura`) delegam
// aqui para não duplicar — e divergir — o predicado.

/**
 * Valida uma URL para uso como atributo de navegação remota (anti-XSS, seguranca.md §15).
 *
 * @param url URL candidata (input não confiável). `undefined`/`null`/`""` são tratados.
 * @returns a própria URL se começar com `https://` (case-sensitive por design);
 *          caso contrário `null`.
 */
export function urlHttpsSegura(url?: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}
