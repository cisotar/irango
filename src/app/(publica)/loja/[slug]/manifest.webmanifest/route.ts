import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaPorSlug } from "@/lib/supabase/queries/lojas";
import { schemaTema } from "@/lib/validacoes/loja";
import {
  FUNDO_PADRAO,
  THEME_PADRAO,
  montarIconesManifest,
  type WebManifestIcon,
} from "@/lib/utils/manifest";

// Supabase SSR (cookies) exige runtime Node, não Edge. Handler é dinâmico por
// natureza (lê o banco por slug); não marcar como estático.
export const runtime = "nodejs";

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
    icons: montarIconesManifest(loja.logo_url, "vitrine"),
  };

  // JSON.stringify escapa `name`/`logo_url` vindos do banco.
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
