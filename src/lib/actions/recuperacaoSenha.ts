"use server";

// Recuperação de senha da porta lojista (specs/recuperacao-senha-self-service.md).
// Padrão de `clienteAuth.ts`: rate limit por IP → safeParse `.strict()` antes de
// qualquer I/O → try/catch → detalhe só no console.error (status/code/name),
// mensagem genérica ao usuário (seguranca.md §14). Sem PII em log: nunca e-mail/senha.
// Sem service role: o GoTrue faz tudo com a sessão da própria requisição.

import { headers } from "next/headers";
import { schemaNovaSenha, schemaRecuperacaoSenha } from "@/lib/validacoes/auth";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { origemDaRequisicao } from "@/lib/utils/origemDaRequisicao";
import { aguardarPisoDeLatencia } from "@/lib/utils/latenciaMinima";
import { temSessaoDeRecuperacao } from "@/lib/auth/temSessaoDeRecuperacao";
import { createClient } from "@/lib/supabase/server";

type Falha = { ok: false; erro: string };
export type ResultadoSolicitarRedefinicao = { ok: true; mensagem: string } | Falha;
export type ResultadoConfirmarNovaSenha = { ok: true; destino: string } | Falha;

const MSG_MUITAS_TENTATIVAS = "Muitas tentativas. Tente novamente em alguns instantes.";
const MSG_PEDIDO =
  "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha. Abra o link neste mesmo navegador.";
const MSG_LINK = "Link inválido ou expirado. Peça um novo link e abra-o neste mesmo navegador.";
const MSG_FALHOU = "Não foi possível redefinir a senha. Tente novamente.";
const MSG_SENHA_FRACA = "Escolha uma senha mais forte.";
const MSG_SENHA_IGUAL = "Escolha uma senha diferente da anterior.";

/** RN-07: destinos fixos, nunca vindos do payload. */
const CAMINHO_NOVA_SENHA = "/nova-senha";
const DESTINO_POS_TROCA = "/login?redefinida=1";

export async function solicitarRedefinicaoSenha(payload: unknown): Promise<ResultadoSolicitarRedefinicao> {
  const inicio = Date.now();
  const h = await headers();
  if (!(await verificarRateLimit("recuperacaoLojista", extrairIp(h))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaRecuperacaoSenha.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Informe um e-mail válido." };
  }

  // RN-01/RN-02: GoTrue chamado sempre; a resposta é a mesma em qualquer desfecho.
  try {
    const redirectTo = new URL("/auth/callback", origemDaRequisicao(h));
    redirectTo.searchParams.set("next", CAMINHO_NOVA_SENHA);
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: redirectTo.toString(),
    });
    if (error) console.error("[solicitarRedefinicaoSenha]", error.status ?? "", error.code ?? "");
  } catch (e) {
    console.error("[solicitarRedefinicaoSenha]", e instanceof Error ? e.name : "erro");
  }
  await aguardarPisoDeLatencia(inicio);
  return { ok: true, mensagem: MSG_PEDIDO };
}

export async function confirmarNovaSenha(payload: unknown): Promise<ResultadoConfirmarNovaSenha> {
  if (!(await verificarRateLimit("novaSenhaLojista", extrairIp(await headers()))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaNovaSenha.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Verifique a nova senha e a confirmação." };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
    // D1/RN-05: só a sessão aberta pelo link troca senha sem a atual.
    if (!(await temSessaoDeRecuperacao(supabase))) {
      return { ok: false, erro: MSG_LINK };
    }
    const { error } = await supabase.auth.updateUser({ password: parsed.data.senha });
    if (error) {
      if (error.code === "weak_password") return { ok: false, erro: MSG_SENHA_FRACA };
      if (error.code === "same_password") return { ok: false, erro: MSG_SENHA_IGUAL };
      console.error("[confirmarNovaSenha] updateUser", error.status ?? "", error.code ?? "");
      return { ok: false, erro: MSG_FALHOU };
    }
  } catch (e) {
    console.error("[confirmarNovaSenha]", e instanceof Error ? e.name : "erro");
    return { ok: false, erro: MSG_FALHOU };
  }

  // D2/RN-08: derruba todas as sessões; falha aqui não desfaz a troca já feita.
  try {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) console.error("[confirmarNovaSenha] signOut", error.status ?? "", error.code ?? "");
  } catch (e) {
    console.error("[confirmarNovaSenha] signOut", e instanceof Error ? e.name : "erro");
  }
  return { ok: true, destino: DESTINO_POS_TROCA };
}
