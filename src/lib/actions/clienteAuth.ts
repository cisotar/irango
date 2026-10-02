"use server";

// Server Actions de auth da porta cliente (issue 336, specs/cliente-identidade.md).
// Padrão de `auth.ts` (lojista): rate limit por IP → safeParse `.strict()` ANTES
// de qualquer I/O → try/catch → detalhe só no console.error, mensagem genérica
// ao usuário (seguranca.md §14). Sem PII em log (§21): nunca e-mail/senha.
//
// RN-03/RN-05/RN-06: `cadastrarCliente` cria SÓ a conta (signUp sem
// options.data) e grava o papel `cliente` logo após o signUp; nunca cria loja,
// nunca grava `lojista`, nunca apaga conta (pode ser pré-existente).
// RN-14: recuperação por link do GoTrue, resposta idêntica exista ou não a conta.

import { headers } from "next/headers";
import {
  schemaCadastroCliente,
  schemaEntrarCliente,
  schemaNovaSenhaCliente,
  schemaRecuperacaoCliente,
} from "@/lib/validacoes/cliente";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { atribuirPapelInicial } from "@/lib/supabase/queries/papeis";
import { registrarUltimoAcessoCliente } from "@/lib/supabase/queries/clientes";

type Falha = { ok: false; erro: string };
export type ResultadoCadastroCliente = { ok: true } | Falha;
export type ResultadoEntrarCliente = { ok: true; destino: string } | Falha;
export type ResultadoRecuperacaoCliente = { ok: true; mensagem: string } | Falha;
export type ResultadoNovaSenhaCliente = { ok: true; destino: string } | Falha;

const MSG_MUITAS_TENTATIVAS = "Muitas tentativas. Tente novamente em alguns instantes.";
const MSG_JA_CADASTRADO = "Este email já está cadastrado.";
const MSG_CADASTRO_FALHOU = "Não foi possível concluir o cadastro. Tente novamente.";
const MSG_CREDENCIAL = "E-mail ou senha incorretos.";
const MSG_CONFIRME = "Confirme seu e-mail para entrar. Enviamos um link para você.";
const MSG_RECUPERACAO =
  "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha.";
const MSG_NOVA_SENHA_LINK = "Link inválido ou expirado. Peça um novo link.";
const MSG_NOVA_SENHA_FALHOU = "Não foi possível redefinir a senha. Tente novamente.";

const DESTINO_PADRAO_CLIENTE = "/minha-conta";
/** Etapa 2 da recuperação, preservando o `next` de origem (já sanitizado). */
function rotaNovaSenha(next: string | undefined): string {
  const params = new URLSearchParams({ etapa: "nova-senha" });
  if (next) params.set("next", next);
  return `/conta/recuperar?${params.toString()}`;
}

/**
 * Origem absoluta do app para os links do GoTrue. Vem dos headers da própria
 * requisição (a Redirect Allow List do Supabase é a barreira contra host
 * forjado); nunca do payload.
 */
function origemDaRequisicao(h: Headers): string {
  const origin = h.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // cai no host abaixo
    }
  }
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** `/auth/callback?contexto=cliente[&next=…]` — `next` já sanitizado. */
function urlCallbackCliente(origem: string, next: string | undefined): string {
  const url = new URL("/auth/callback", origem);
  url.searchParams.set("contexto", "cliente");
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

export async function cadastrarCliente(payload: unknown): Promise<ResultadoCadastroCliente> {
  const h = await headers();
  if (!(await verificarRateLimit("cadastroCliente", extrairIp(h))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaCadastroCliente.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Verifique o e-mail e a senha informados." };
  }
  const { email, senha } = parsed.data;
  const next = sanitizarNext(parsed.data.next);

  let usuarioId: string;
  try {
    const supabase = await createClient();
    // RN-06: SEM options.data — nada do perfil antes da confirmação.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: { emailRedirectTo: urlCallbackCliente(origemDaRequisicao(h), next) },
    });
    if (error || !data.user) {
      return { ok: false, erro: MSG_JA_CADASTRADO };
    }
    usuarioId = data.user.id; // autoritativo: do signUp, nunca do payload
  } catch (e) {
    console.error("[cadastrarCliente] signUp", e instanceof Error ? e.name : "erro");
    return { ok: false, erro: MSG_CADASTRO_FALHOU };
  }

  // RN-03/RN-05: papel `cliente` logo após o signUp, sem compensação — a conta
  // pode ser pré-existente; se a RPC falhar, o link de confirmação carrega
  // `contexto=cliente` e o callback grava `cliente`.
  try {
    const papeis = await atribuirPapelInicial(createServiceClient(), usuarioId, "cliente");
    if (!papeis.includes("cliente")) {
      return { ok: false, erro: MSG_JA_CADASTRADO };
    }
  } catch (e) {
    console.error("[cadastrarCliente] papel", e instanceof Error ? e.name : "erro");
    return { ok: false, erro: MSG_CADASTRO_FALHOU };
  }

  // Estado "Confirme seu e-mail": nenhuma sessão volta ao cliente.
  return { ok: true };
}

export async function entrarCliente(payload: unknown): Promise<ResultadoEntrarCliente> {
  if (!(await verificarRateLimit("loginCliente", extrairIp(await headers()))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaEntrarCliente.safeParse(payload);
  if (!parsed.success) {
    // Anti-enumeração (§17): não revela formato nem política de senha.
    return { ok: false, erro: MSG_CREDENCIAL };
  }
  const { email, senha } = parsed.data;
  const next = sanitizarNext(parsed.data.next);

  let usuarioId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      // Decisão 18: e-mail não confirmado tem mensagem própria.
      if (error.code === "email_not_confirmed") return { ok: false, erro: MSG_CONFIRME };
      return { ok: false, erro: MSG_CREDENCIAL };
    }
    if (!data.user) return { ok: false, erro: MSG_CREDENCIAL };
    if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      return { ok: false, erro: MSG_CONFIRME };
    }
    usuarioId = data.user.id;
  } catch (e) {
    console.error("[entrarCliente]", e instanceof Error ? e.name : "erro");
    return { ok: false, erro: MSG_CREDENCIAL };
  }

  // Best-effort: retenção (24 meses) não pode derrubar o login. Sem perfil = no-op.
  try {
    await registrarUltimoAcessoCliente(createServiceClient(), usuarioId);
  } catch (e) {
    console.error("[entrarCliente] ultimo_acesso_em", e instanceof Error ? e.name : "erro");
  }

  // Não grava papel (conta só-lojista continua só-lojista); o guard de
  // /minha-conta leva quem não tem perfil a /conta/completar.
  return { ok: true, destino: next ?? DESTINO_PADRAO_CLIENTE };
}

export async function solicitarRecuperacaoCliente(
  payload: unknown,
): Promise<ResultadoRecuperacaoCliente> {
  const h = await headers();
  if (!(await verificarRateLimit("recuperacaoCliente", extrairIp(h))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaRecuperacaoCliente.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Informe um e-mail válido." };
  }

  // Anti-enumeração: o GoTrue é chamado sempre e a resposta é a mesma em
  // qualquer desfecho (existente, inexistente, só-Google, falha).
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: urlCallbackCliente(origemDaRequisicao(h), rotaNovaSenha(sanitizarNext(parsed.data.next))),
    });
    if (error) console.error("[solicitarRecuperacaoCliente]", error.status ?? "", error.code ?? "");
  } catch (e) {
    console.error("[solicitarRecuperacaoCliente]", e instanceof Error ? e.name : "erro");
  }
  return { ok: true, mensagem: MSG_RECUPERACAO };
}

/** Sessão aberta por link de recuperação: claim `amr` (JWT verificado) contém `recovery`. */
function ehSessaoDeRecuperacao(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((e) =>
    typeof e === "string"
      ? e === "recovery"
      : typeof e === "object" && e !== null && (e as { method?: unknown }).method === "recovery",
  );
}

export async function redefinirSenhaCliente(payload: unknown): Promise<ResultadoNovaSenhaCliente> {
  if (!(await verificarRateLimit("novaSenhaCliente", extrairIp(await headers()))).permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  const parsed = schemaNovaSenhaCliente.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Verifique a nova senha e a confirmação." };
  }

  try {
    const supabase = await createClient();
    // Sessão de recuperação aberta pelo callback (cookies HttpOnly). Sem ela, falha.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { ok: false, erro: MSG_NOVA_SENHA_LINK };
    }
    // Só sessão de recuperação troca senha sem a atual (achado P18): login por
    // senha/OAuth não passa daqui.
    const { data: dadosClaims, error: erroClaims } = await supabase.auth.getClaims();
    if (erroClaims || !dadosClaims || !ehSessaoDeRecuperacao(dadosClaims.claims.amr)) {
      return { ok: false, erro: MSG_NOVA_SENHA_LINK };
    }
    const { error: erroUpdate } = await supabase.auth.updateUser({ password: parsed.data.senha });
    if (erroUpdate) {
      console.error("[redefinirSenhaCliente]", erroUpdate.status ?? "", erroUpdate.code ?? "");
      return { ok: false, erro: MSG_NOVA_SENHA_FALHOU };
    }
  } catch (e) {
    console.error("[redefinirSenhaCliente]", e instanceof Error ? e.name : "erro");
    return { ok: false, erro: MSG_NOVA_SENHA_FALHOU };
  }
  return { ok: true, destino: sanitizarNext(parsed.data.next) ?? DESTINO_PADRAO_CLIENTE };
}
