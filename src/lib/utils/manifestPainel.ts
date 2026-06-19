import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Subconjunto do W3C Web App Manifest emitido pelo painel.
 * Tipado localmente (não há type oficial empacotado; serializado como
 * application/manifest+json).
 */
export interface ManifestPainel {
  name: string;
  short_name: "Painel";
  start_url: "/painel";
  scope: "/painel";
  id: "/painel";
  display: "standalone";
  icons: { src: string; sizes: string; type?: string }[];
}

const ICONES_FALLBACK: ManifestPainel["icons"] = [
  { src: "/icons/painel-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/painel-512.png", sizes: "512x512", type: "image/png" },
];

/**
 * Ícones a partir da `logo_url` da loja. Revalida `https://` (defesa em
 * profundidade, seguranca.md §15 — `logo_url` é preenchida pelo lojista, não
 * confiável; o CHECK do banco já restringe, mas não confiamos nele aqui).
 * Não-https → cai no fallback.
 */
function iconesDaLoja(logoUrl: string | null): ManifestPainel["icons"] {
  if (typeof logoUrl === "string" && logoUrl.startsWith("https://")) {
    return [
      { src: logoUrl, sizes: "192x192" },
      { src: logoUrl, sizes: "512x512" },
    ];
  }
  return ICONES_FALLBACK;
}

/**
 * PURA (sem I/O). `loja` JÁ resolvida pela sessão (RLS) no Route Handler.
 * `null` = dono autenticado sem loja → manifest genérico, sem nome de tenant.
 * NUNCA recebe id/slug do cliente: quem escolhe a loja é a RLS, não esta função.
 */
export function montarManifestPainel(loja: LojaCompleta | null): ManifestPainel {
  const base = {
    short_name: "Painel",
    start_url: "/painel",
    scope: "/painel",
    id: "/painel",
    display: "standalone",
  } as const;
  if (loja === null) {
    return { ...base, name: "iRango · Painel", icons: ICONES_FALLBACK };
  }
  return {
    ...base,
    name: `${loja.nome} · Painel`,
    icons: iconesDaLoja(loja.logo_url),
  };
}
