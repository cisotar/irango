import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { montarManifestPainel } from "@/lib/utils/manifestPainel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // nunca otimizar estaticamente (D5)

const NO_STORE = "private, no-store";

/**
 * Manifest do painel nomeado pela loja do lojista AUTENTICADO.
 *
 * IMPORTANTE: a assinatura NÃO recebe Request — não há de onde ler query string.
 * A loja é derivada SÓ da sessão (cookie httpOnly via @supabase/ssr) e escopada
 * pela RLS `lojas_leitura_propria` (auth.uid() = dono_id). RN-2: nenhum
 * `?loja_id`/`?slug` do cliente pode escolher a loja — não há canal de input.
 */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user === null) {
      // Sem sessão: 401, sem dado de loja, sem cache (D2). `no-store` também no
      // 401 para um proxy não cachear a negação e servi-la após o login.
      return new Response(null, { status: 401, headers: { "Cache-Control": NO_STORE } });
    }
    const loja = await buscarLojaDoDono(supabase); // RLS escopa auth.uid()=dono_id
    const manifest = montarManifestPainel(loja); // loja null → genérico (D3)
    return Response.json(manifest, {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": NO_STORE,
      },
    });
  } catch (e) {
    console.error("[manifestPainel]", e); // detalhe só no servidor (§14)
    return new Response(null, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
