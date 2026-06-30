// Função PURA de apresentação: guard anti-XSS que decide se uma URL pode virar
// `src` de imagem remota. Defesa de apresentação (seguranca.md §15): o
// `foto_url` vem preenchido por lojista (input não confiável), então só uma URL
// que começa EXATAMENTE com "https://" é renderizada — `javascript:`, `data:`,
// `http://`, caminhos relativos e qualquer outra forma viram `null` (placeholder
// no render). Sem I/O, sem throw: a "falha" é silenciosa por design.
//
// Fonte única da invariante — `CardProduto` e `SecaoCatalogo` consomem daqui
// para não duplicar (e divergir) o predicado.

/**
 * Valida uma URL de foto para uso como imagem remota (anti-XSS, seguranca.md §15).
 *
 * @param url URL candidata (de lojista). `undefined`/`null`/`""` são tratados.
 * @returns a própria URL se começar com `https://` (case-sensitive por design);
 *          caso contrário `null`.
 */
export function fotoSegura(url?: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}
