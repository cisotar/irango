import { urlHttpsSegura } from "./urlHttpsSegura";

// Especialização de domínio: guard anti-XSS para `src` de IMAGEM remota. O
// `foto_url` vem preenchido por lojista (input não confiável), então reusa a
// fonte única da invariante §15 (`urlHttpsSegura`) em vez de duplicar o predicado.
// Nome foto-específico preservado para os 6 callsites de imagem que consomem aqui.

/**
 * Valida uma URL de foto para uso como imagem remota (anti-XSS, seguranca.md §15).
 * Delega à fonte única `urlHttpsSegura`.
 *
 * @param url URL candidata (de lojista). `undefined`/`null`/`""` são tratados.
 * @returns a própria URL se começar com `https://`; caso contrário `null`.
 */
export function fotoSegura(url?: string | null): string | null {
  return urlHttpsSegura(url);
}
