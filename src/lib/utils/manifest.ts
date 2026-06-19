/**
 * Utilitários compartilhados do Web App Manifest (vitrine e painel).
 * Centraliza o shape de ícone, os defaults de tema e a montagem dos ícones a
 * partir da `logo_url` da loja — evitando duplicação entre o Route Handler da
 * vitrine e o builder do painel.
 */

export type WebManifestIcon = { src: string; sizes: string; type: string };

// Defaults = tokens iRango, espelhando TEMA_PADRAO da vitrine (page.tsx):
// primaria/fundo.
export const THEME_PADRAO = "#332616";
export const FUNDO_PADRAO = "#f5f0e6";

/**
 * Monta os ícones do manifest. Defesa em profundidade (RN-3 / seguranca.md §15):
 * `logo_url` vem do banco (lojista) e é tratada como não confiável — só é usada
 * como ícone se começar com `https://`. O CHECK no banco já garante isso na
 * escrita; aqui é a segunda barreira (rejeita `http:`/`javascript:`/`data:`).
 * Sem logo válida → fallback genérico (`/icons/${tipo}-192.png` etc).
 */
export function montarIconesManifest(
  logoUrl: string | null,
  tipo: "vitrine" | "painel",
): WebManifestIcon[] {
  if (logoUrl?.startsWith("https://")) {
    return [
      { src: logoUrl, sizes: "192x192", type: "image/png" },
      { src: logoUrl, sizes: "512x512", type: "image/png" },
    ];
  }
  return [
    { src: `/icons/${tipo}-192.png`, sizes: "192x192", type: "image/png" },
    { src: `/icons/${tipo}-512.png`, sizes: "512x512", type: "image/png" },
  ];
}
