import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaPorSlug } from "@/lib/supabase/queries/lojas";
import { schemaTema } from "@/lib/validacoes/loja";

// Supabase SSR (cookies) exige runtime Node, não Edge. Handler é dinâmico por
// natureza (lê o banco por slug); não marcar como estático.
export const runtime = "nodejs";

// Defaults = tokens iRango, espelhando TEMA_PADRAO da vitrine (page.tsx).
const THEME_PADRAO = "#332616";
const FUNDO_PADRAO = "#f5f0e6";

// Ícones genéricos quando a loja não tem logo válida (issue 001).
const ICONE_FALLBACK_192 = "/icons/vitrine-192.png";
const ICONE_FALLBACK_512 = "/icons/vitrine-512.png";

type WebManifestIcon = { src: string; sizes: string; type: string };
type WebManifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  id: string;
  display: "standalone";
  theme_color: string;
  background_color: string;
  icons: WebManifestIcon[];
};

/**
 * Monta os ícones do manifest. Defesa em profundidade (RN-3 / seguranca.md §15):
 * `logo_url` vem do banco (lojista) e é tratada como não confiável — só é usada
 * como ícone se começar com `https://`. O CHECK no banco já garante isso na
 * escrita; aqui é a segunda barreira (rejeita `http:`/`javascript:`/`data:`).
 * Sem logo válida → fallback genérico.
 */
function montarIcones(logoUrl: string | null): WebManifestIcon[] {
  if (logoUrl && logoUrl.startsWith("https://")) {
    return [
      { src: logoUrl, sizes: "192x192", type: "image/png" },
      { src: logoUrl, sizes: "512x512", type: "image/png" },
    ];
  }
  return [
    { src: ICONE_FALLBACK_192, sizes: "192x192", type: "image/png" },
    { src: ICONE_FALLBACK_512, sizes: "512x512", type: "image/png" },
  ];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  let loja;
  try {
    const db = await createClient();
    loja = await buscarLojaPorSlug(db, slug);
  } catch (error) {
    // §14: detalhe só no servidor; ao cliente, resposta genérica sem corpo.
    console.error("[manifestVitrine]", error);
    return new Response(null, { status: 500 });
  }

  // Loja inexistente/inativa (a view já filtra `ativo = true`) ou linha da view
  // com colunas essenciais nulas → loja inutilizável → 404.
  if (!loja || !loja.nome || !loja.slug) {
    notFound();
  }

  const tema = schemaTema.safeParse(loja.tema);
  const theme_color = tema.success ? tema.data.primaria : THEME_PADRAO;
  const background_color = tema.success ? tema.data.fundo : FUNDO_PADRAO;

  const url = `/loja/${loja.slug}`;
  const short_name =
    loja.nome.length > 12 ? loja.nome.slice(0, 12) : loja.nome;

  const manifest: WebManifest = {
    name: loja.nome,
    short_name,
    start_url: url,
    scope: url,
    id: url,
    display: "standalone",
    theme_color,
    background_color,
    icons: montarIcones(loja.logo_url),
  };

  // JSON.stringify escapa `name`/`logo_url` vindos do banco.
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
