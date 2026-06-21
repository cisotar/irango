import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { montarIconesManifest } from "@/lib/utils/manifest";

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
    return {
      ...base,
      name: "iRango · Painel",
      icons: montarIconesManifest(null, "painel"),
    };
  }
  return {
    ...base,
    name: `${loja.nome} · Painel`,
    icons: montarIconesManifest(loja.logo_url ?? null, "painel"),
  };
}
