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
import { ehSessaoDeRecuperacao } from "@/lib/utils/sessaoRecuperacao";

/** Issue 366 (RN-07): destino fixo da recuperação da porta lojista. */
const CAMINHO_NOVA_SENHA = "/nova-senha";

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
 * papel). Erro de OAuth → `/conta/entrar?erro=google` (link de recuperação
 * inválido/expirado → `/conta/recuperar?erro=link`, C1); conta sem perfil →
 * `/conta/completar` (preservando `next`); com perfil → `ultimo_acesso_em`
 * via service_role e `next` ou `/minha-conta`. A etapa 2 da recuperação por
 * link (`/conta/recuperar…`) sempre respeita o `next`.
 *
 * Recuperação da porta lojista (issue 366, D5): o ramo é decidido pelo `amr`
 * da sessão trocada (`getClaims(access_token)`), nunca pela URL. `recovery` →
 * `/nova-senha` fixo, sem `atribuirPapelInicial` (RN-09). Sem sessão ou sem
 * claims legíveis → `/login?erro=auth` (fail-closed). Erros com marca de
 * recuperação (`next=/nova-senha` ou `otp_expired`) → `/recuperar-senha?erro=link`.
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
  // C1: na porta cliente, link inválido/expirado (sem code, troca falhou, ou
  // erro OAuth de recuperação) → `/conta/recuperar?erro=link`. Recuperação é
  // reconhecida por `error_code=otp_expired` ou pelo `next=/conta/recuperar…`
  // (o único fluxo que o gera); demais erros OAuth seguem como login Google.
  const linkInvalidoCliente = `${origin}/conta/recuperar?erro=link`;
  // Só escolhe a tela de erro: nunca abre sessão nem decide papel.
  const marcaRecuperacaoLojista =
    !portaCliente && (next === CAMINHO_NOVA_SENHA || searchParams.get("error_code") === "otp_expired");
  const erroLojista = (padrao: string) =>
    marcaRecuperacaoLojista ? `${origin}/recuperar-senha?erro=link` : `${origin}${padrao}`;
  const erroOAuth = searchParams.get("error");
  if (erroOAuth) {
    console.error("[authCallback] oauth", erroOAuth);
    if (portaCliente) {
      const ehRecuperacao =
        searchParams.get("error_code") === "otp_expired" || next?.startsWith("/conta/recuperar") === true;
      return NextResponse.redirect(ehRecuperacao ? linkInvalidoCliente : `${origin}/conta/entrar?erro=google`);
    }
    return NextResponse.redirect(erroLojista("/login?erro=google"));
  }

  if (!code) {
    return NextResponse.redirect(portaCliente ? linkInvalidoCliente : erroLojista("/login?erro=auth"));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[authCallback]", error.status ?? "", error.code ?? "", error.name);
    return NextResponse.redirect(portaCliente ? linkInvalidoCliente : erroLojista("/login?erro=auth"));
  }

  if (!data.user) {
    return NextResponse.redirect(`${origin}${next ?? "/painel"}`);
  }

  if (!portaCliente) {
    const recuperacao = await ehRecuperacaoLojista(supabase, data.session?.access_token);
    if (recuperacao === null) {
      return NextResponse.redirect(`${origin}/login?erro=auth`);
    }
    if (recuperacao) {
      // Link de recuperação também prova posse do e-mail; no-op para conta sem loja.
      await reconciliarPosConfirmacao(data.user);
      return NextResponse.redirect(`${origin}${CAMINHO_NOVA_SENHA}`);
    }
  }

  let papeis: Papel[];
  try {
    papeis = await atribuirPapelInicial(
      createServiceClient(),
      data.user.id,
      portaCliente ? "cliente" : "lojista",
    );
  } catch (e) {
    console.error("[authCallback] papel", e instanceof Error ? e.name : "erro");
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
 * `amr` da sessão recém-trocada: `true` se recuperação, `false` se outra,
 * `null` se não há sessão ou os claims não são legíveis (fail-closed).
 */
async function ehRecuperacaoLojista(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessToken: string | undefined,
): Promise<boolean | null> {
  if (!accessToken) return null;
  try {
    const { data, error } = await supabase.auth.getClaims(accessToken);
    if (error || !data) {
      console.error("[authCallback] claims", error?.status ?? "", error?.name ?? "");
      return null;
    }
    return ehSessaoDeRecuperacao(data.claims.amr);
  } catch (e) {
    console.error("[authCallback] claims", e instanceof Error ? e.name : "erro");
    return null;
  }
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
    console.error("[authCallback] perfil", e instanceof Error ? e.name : "erro");
  }
  if (!temPerfil) {
    return next ? `/conta/completar?${new URLSearchParams({ next }).toString()}` : "/conta/completar";
  }

  try {
    await registrarUltimoAcessoCliente(createServiceClient(), usuarioId);
  } catch (e) {
    console.error("[authCallback] ultimo_acesso_em", e instanceof Error ? e.name : "erro");
  }
  return next ?? "/minha-conta";
}
