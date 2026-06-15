import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reconciliarPosConfirmacao } from "@/lib/auth/reconciliarPosConfirmacao";

/**
 * Callback OAuth / confirmação de email (padrão `@supabase/ssr`).
 * Troca `code` por sessão (seta cookies httpOnly) e redireciona.
 * Erro → mensagem genérica ao usuário (§14), detalhe só no `console.error`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizarNext(searchParams.get("next"));

  // Erro de OAuth (consent negado, provider caído etc.): Supabase manda
  // `?error=...&error_description=...`. Detecta ANTES de qualquer troca de
  // código. Loga só o `error` (sem `error_description`, que pode ter PII —
  // §14/§21) e redireciona genérico, sem expor JSON bruto ao usuário.
  const erroOAuth = searchParams.get("error");
  if (erroOAuth) {
    console.error("[authCallback] oauth", erroOAuth);
    return NextResponse.redirect(`${origin}/login?erro=google`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?erro=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[authCallback]", error);
    return NextResponse.redirect(`${origin}/login?erro=auth`);
  }

  // Issue 066: posse do email comprovada agora → reconcilia assinatura órfã (059).
  // BEST-EFFORT: o helper já engole toda falha; não derruba o redirect.
  if (data.user) {
    await reconciliarPosConfirmacao(data.user);
  }

  return NextResponse.redirect(`${origin}${next ?? "/painel"}`);
}

/**
 * Anti open-redirect: aceita só path interno (começa com '/', mas não com '//',
 * que o navegador interpreta como URL protocol-relative). Qualquer outra coisa
 * → undefined (cai no destino padrão).
 */
function sanitizarNext(next: string | null): string | undefined {
  if (next === null) return undefined;
  if (!next.startsWith("/")) return undefined;
  if (next.startsWith("//")) return undefined;
  return next;
}
