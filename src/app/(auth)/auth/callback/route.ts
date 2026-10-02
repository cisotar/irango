import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { atribuirPapelInicial } from "@/lib/supabase/queries/papeis";
import {
  buscarPerfilCliente,
  registrarUltimoAcessoCliente,
} from "@/lib/supabase/queries/clientes";
import { destinoPadraoPorPapel, type Papel } from "@/lib/utils/papeis";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { reconciliarPosConfirmacao } from "@/lib/auth/reconciliarPosConfirmacao";
import { ehAdminSaaS } from "@/lib/auth/admin";

/**
 * Callback OAuth / confirmação de email (padrão `@supabase/ssr`).
 * Troca `code` por sessão (seta cookies httpOnly) e redireciona.
 * Porta `(auth)` (issue 332): conta sem papel recebe `lojista`; papel de conta
 * existente nunca muda (lock + "só grava se não há papel" na RPC). O id vem do
 * `exchangeCodeForSession`, nunca da query.
 * Erro → mensagem genérica ao usuário (§14), detalhe só no `console.error`.
 *
 * Porta cliente (issue 336): só o literal `contexto=cliente` troca o papel
 * inicial para `cliente` (conta existente não muda — a RPC só grava se não há
 * papel). Erro de OAuth → `/conta/entrar?erro=google`; conta sem perfil →
 * `/conta/completar` (preservando `next`); com perfil → `ultimo_acesso_em`
 * via service_role e `next` ou `/minha-conta`. A etapa 2 da recuperação por
 * link (`/conta/recuperar…`) sempre respeita o `next`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizarNext(searchParams.get("next"));
  const portaCliente = searchParams.get("contexto") === "cliente";

  // Erro de OAuth (consent negado, provider caído etc.): Supabase manda
  // `?error=...&error_description=...`. Detecta ANTES de qualquer troca de
  // código. Loga só o `error` (sem `error_description`, que pode ter PII —
  // §14/§21) e redireciona genérico, sem expor JSON bruto ao usuário.
  const erroOAuth = searchParams.get("error");
  if (erroOAuth) {
    console.error("[authCallback] oauth", erroOAuth);
    const entrada = portaCliente ? "/conta/entrar" : "/login";
    return NextResponse.redirect(`${origin}${entrada}?erro=google`);
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

  if (!data.user) {
    return NextResponse.redirect(`${origin}${next ?? "/painel"}`);
  }

  let papeis: Papel[];
  try {
    papeis = await atribuirPapelInicial(
      createServiceClient(),
      data.user.id,
      portaCliente ? "cliente" : "lojista",
    );
  } catch (e) {
    console.error("[authCallback] papel", e);
    return NextResponse.redirect(`${origin}/login?erro=auth`);
  }

  // Issue 066: posse do email comprovada agora → reconcilia assinatura órfã (059).
  // Só lojista (issue 332). BEST-EFFORT: o helper já engole toda falha.
  if (papeis.includes("lojista")) {
    await reconciliarPosConfirmacao(data.user);
  }

  if (portaCliente) {
    return NextResponse.redirect(`${origin}${await destinoPortaCliente(data.user.id, next)}`);
  }

  // Destino padrão por papel: admin → `/admin`; lojista → `/painel`; demais → "/".
  // Um `next` explícito já sanitizado tem prioridade (o gate do painel barra).
  const destinoPadrao = destinoPadraoPorPapel({ ehAdmin: ehAdminSaaS(data.user.id), papeis });
  return NextResponse.redirect(`${origin}${next ?? destinoPadrao}`);
}

/**
 * Destino da porta cliente. Sem perfil (ou falha ao ler) → `/conta/completar`,
 * cujo guard decide de novo; a recuperação de senha nunca é desviada.
 * `ultimo_acesso_em` é best-effort: nunca derruba o login.
 */
async function destinoPortaCliente(usuarioId: string, next: string | undefined): Promise<string> {
  if (next?.startsWith("/conta/recuperar")) return next;

  let temPerfil = false;
  try {
    temPerfil = (await buscarPerfilCliente(await createClient(), usuarioId)) !== null;
  } catch (e) {
    console.error("[authCallback] perfil", e);
  }
  if (!temPerfil) {
    return next ? `/conta/completar?${new URLSearchParams({ next }).toString()}` : "/conta/completar";
  }

  try {
    await registrarUltimoAcessoCliente(createServiceClient(), usuarioId);
  } catch (e) {
    console.error("[authCallback] ultimo_acesso_em", e);
  }
  return next ?? "/minha-conta";
}
