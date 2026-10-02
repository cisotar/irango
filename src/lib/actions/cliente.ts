"use server";

// Server Actions do perfil de cliente (issue 337, specs/cliente-identidade.md).
// Invariantes: o id SEMPRE vem de `getUser()` da sessão (nunca do payload —
// `.strict()` rejeita `id`/`cliente_id`/versão); a versão dos termos é
// `VERSAO_TERMOS` do servidor; nada grava `lojista` nem cria loja. Erro interno
// → mensagem genérica, detalhe só no console.error, sem PII (§14/§21).
// O banco repete teto/mínimo/idade (triggers) e a posse (RLS) — as checagens
// aqui só escolhem a mensagem.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import {
  MENSAGEM_IDADE_MINIMA,
  schemaCompletarPerfil,
  schemaExcluirConta,
  schemaIdEnderecoCliente,
  schemaPerfilCliente,
  schemaSairCliente,
  schemaSalvarEnderecoCliente,
} from "@/lib/validacoes/cliente";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarPapeisDoUsuario } from "@/lib/supabase/queries/papeis";
import { VERSAO_TERMOS } from "@/lib/constants/termos";
import { ehAdminSaaS } from "@/lib/auth/admin";

export type ResultadoCliente = { ok: true } | { ok: false; erro: string };

const MSG_MUITAS_TENTATIVAS = "Muitas tentativas. Tente novamente em alguns instantes.";
const MSG_DADOS = "Verifique os dados informados.";
const MSG_SESSAO = "Sua sessão expirou. Entre novamente.";
const MSG_CONFIRME = "Confirme seu e-mail para entrar. Enviamos um link para você.";
const MSG_GENERICA = "Não foi possível salvar. Tente novamente.";
const MSG_TETO = "Você pode ter até 3 endereços.";
const MSG_MINIMO = "Mantenha pelo menos um endereço.";
const MSG_ENDERECO_NAO_ENCONTRADO = "Endereço não encontrado.";
const MSG_EXCLUSAO = "Não foi possível excluir a conta. Tente novamente.";

const ROTA_MINHA_CONTA = "/minha-conta";
const ROTA_ENDERECOS = "/minha-conta/enderecos";
const MAX_ENDERECOS = 3;

type ErroPostgrest = { code?: string; message?: string };
const comoErro = (e: unknown): ErroPostgrest =>
  typeof e === "object" && e !== null ? (e as ErroPostgrest) : {};

/** Falha de validação: a mensagem da decisão 17 é a única que passa adiante. */
function erroDeValidacao(issues: readonly { message: string }[]): ResultadoCliente {
  const idade = issues.some((i) => i.message === MENSAGEM_IDADE_MINIMA);
  return { ok: false, erro: idade ? MENSAGEM_IDADE_MINIMA : MSG_DADOS };
}

async function limiteSalvarPerfil(): Promise<boolean> {
  return (await verificarRateLimit("salvarPerfil", extrairIp(await headers()))).permitido;
}

/** Usuário autoritativo da sessão (cookie HttpOnly), ou `null`. */
async function usuarioDaSessao(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// ═════════════════════════════ perfil ═════════════════════════════════════════

/**
 * Decisão 19 / RN-09: cria papel + perfil + 1º endereço numa transação (RPC
 * `criar_perfil_cliente`, EXECUTE só service_role). Exige e-mail confirmado.
 * Sucesso → redirect para `next` sanitizado ou `/minha-conta`.
 */
export async function completarPerfilCliente(payload: unknown): Promise<ResultadoCliente> {
  if (!(await limiteSalvarPerfil())) return { ok: false, erro: MSG_MUITAS_TENTATIVAS };

  const parsed = schemaCompletarPerfil.safeParse(payload);
  if (!parsed.success) return erroDeValidacao(parsed.error.issues);
  const { nome, telefone, data_nascimento, aceita_marketing, endereco } = parsed.data;

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };
    if (!usuario.email_confirmed_at) return { ok: false, erro: MSG_CONFIRME };

    const { error } = await createServiceClient().rpc("criar_perfil_cliente", {
      p_usuario: usuario.id, // da sessão, nunca do payload
      p_nome: nome,
      p_telefone: telefone,
      p_data_nascimento: data_nascimento,
      p_aceita_marketing: aceita_marketing,
      p_versao_termos: VERSAO_TERMOS, // do servidor
      p_endereco: { ...endereco, complemento: endereco.complemento ?? null },
    });
    // 23505 = perfil já existe (duplo submit): idempotente, segue para o destino.
    if (error && error.code !== "23505") {
      console.error("[completarPerfilCliente]", error.code ?? "");
      return { ok: false, erro: MSG_GENERICA };
    }
  } catch (e) {
    console.error("[completarPerfilCliente]", comoErro(e).code ?? "erro");
    return { ok: false, erro: MSG_GENERICA };
  }

  revalidatePath(ROTA_MINHA_CONTA);
  redirect(sanitizarNext(parsed.data.next) ?? ROTA_MINHA_CONTA);
}

/** Edita só as colunas com grant de UPDATE (nome, telefone, nascimento, marketing). */
export async function salvarPerfilCliente(payload: unknown): Promise<ResultadoCliente> {
  if (!(await limiteSalvarPerfil())) return { ok: false, erro: MSG_MUITAS_TENTATIVAS };

  const parsed = schemaPerfilCliente.safeParse(payload);
  if (!parsed.success) return erroDeValidacao(parsed.error.issues);
  const { nome, telefone, data_nascimento, aceita_marketing } = parsed.data;

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };

    const { data, error } = await supabase
      .from("clientes")
      .update({ nome, telefone, data_nascimento, aceita_marketing })
      .eq("id", usuario.id)
      .select("id");
    if (error) {
      console.error("[salvarPerfilCliente]", error.code ?? "");
      return { ok: false, erro: MSG_GENERICA };
    }
    // 0 linhas (sem perfil, RLS): não finge sucesso.
    if (!data || data.length === 0) return { ok: false, erro: MSG_GENERICA };
  } catch (e) {
    console.error("[salvarPerfilCliente]", comoErro(e).code ?? "erro");
    return { ok: false, erro: MSG_GENERICA };
  }

  revalidatePath(ROTA_MINHA_CONTA);
  return { ok: true };
}

// ═════════════════════════════ endereços ══════════════════════════════════════

/** Criar (teto 3) ou editar o próprio endereço. `cliente_id` = sessão. */
export async function salvarEnderecoCliente(payload: unknown): Promise<ResultadoCliente> {
  const parsed = schemaSalvarEnderecoCliente.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_DADOS };
  const { id, ...campos } = parsed.data;
  const linha = { ...campos, complemento: campos.complemento ?? null };

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };

    if (id) {
      const { data, error } = await supabase
        .from("clientes_enderecos")
        .update(linha)
        .eq("id", id)
        .eq("cliente_id", usuario.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) return { ok: false, erro: MSG_ENDERECO_NAO_ENCONTRADO };
    } else {
      const { count, error: erroContagem } = await supabase
        .from("clientes_enderecos")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", usuario.id);
      if (erroContagem) throw erroContagem;
      // Fail-closed: contagem desconhecida não vira "zero".
      if (count === null || count === undefined) return { ok: false, erro: MSG_GENERICA };
      if (count >= MAX_ENDERECOS) return { ok: false, erro: MSG_TETO };

      const { error } = await supabase
        .from("clientes_enderecos")
        .insert({ ...linha, cliente_id: usuario.id, padrao: false });
      if (error) throw error;
    }
  } catch (e) {
    const erro = comoErro(e);
    // Corrida com outro INSERT: o trigger de teto (23514) é a barreira real.
    if (erro.code === "23514" && erro.message?.includes("teto")) return { ok: false, erro: MSG_TETO };
    console.error("[salvarEnderecoCliente]", erro.code ?? "erro");
    return { ok: false, erro: MSG_GENERICA };
  }

  revalidatePath(ROTA_ENDERECOS);
  return { ok: true };
}

/**
 * Troca o padrão em duas escritas ordenadas (o índice único parcial
 * `clientes_enderecos_um_padrao_idx` exige desmarcar antes de marcar).
 */
export async function definirEnderecoPadrao(payload: unknown): Promise<ResultadoCliente> {
  const parsed = schemaIdEnderecoCliente.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_DADOS };
  const { id } = parsed.data;

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };

    const { data: alvo, error: erroAlvo } = await supabase
      .from("clientes_enderecos")
      .select("id, padrao")
      .eq("id", id)
      .eq("cliente_id", usuario.id)
      .maybeSingle();
    if (erroAlvo) throw erroAlvo;
    if (!alvo) return { ok: false, erro: MSG_ENDERECO_NAO_ENCONTRADO };
    if (alvo.padrao) return { ok: true };

    const { error: erroDesmarcar } = await supabase
      .from("clientes_enderecos")
      .update({ padrao: false })
      .eq("cliente_id", usuario.id)
      .eq("padrao", true);
    if (erroDesmarcar) throw erroDesmarcar;

    const { error: erroMarcar } = await supabase
      .from("clientes_enderecos")
      .update({ padrao: true })
      .eq("id", id)
      .eq("cliente_id", usuario.id);
    if (erroMarcar) throw erroMarcar;
  } catch (e) {
    console.error("[definirEnderecoPadrao]", comoErro(e).code ?? "erro");
    return { ok: false, erro: MSG_GENERICA };
  }

  revalidatePath(ROTA_ENDERECOS);
  return { ok: true };
}

/** Remove o próprio endereço (mínimo 1); remover o padrão promove o mais antigo. */
export async function removerEnderecoCliente(payload: unknown): Promise<ResultadoCliente> {
  const parsed = schemaIdEnderecoCliente.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_DADOS };
  const { id } = parsed.data;

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };

    const { data: enderecos, error: erroLista } = await supabase
      .from("clientes_enderecos")
      .select("id, padrao")
      .eq("cliente_id", usuario.id)
      .order("criado_em", { ascending: true });
    if (erroLista) throw erroLista;
    const lista = enderecos ?? [];
    const alvo = lista.find((e) => e.id === id);
    if (!alvo) return { ok: false, erro: MSG_ENDERECO_NAO_ENCONTRADO };
    if (lista.length <= 1) return { ok: false, erro: MSG_MINIMO };

    const { error } = await supabase
      .from("clientes_enderecos")
      .delete()
      .eq("id", id)
      .eq("cliente_id", usuario.id);
    if (error) throw error;

    const maisAntigo = lista.find((e) => e.id !== id);
    if (alvo.padrao && maisAntigo) {
      const { error: erroPromover } = await supabase
        .from("clientes_enderecos")
        .update({ padrao: true })
        .eq("id", maisAntigo.id)
        .eq("cliente_id", usuario.id);
      if (erroPromover) throw erroPromover;
    }
  } catch (e) {
    const erro = comoErro(e);
    // Corrida com outra remoção: o trigger de mínimo (23514) é a barreira real.
    if (erro.code === "23514" && erro.message?.includes("mínimo")) return { ok: false, erro: MSG_MINIMO };
    console.error("[removerEnderecoCliente]", erro.code ?? "erro");
    return { ok: false, erro: MSG_GENERICA };
  }

  revalidatePath(ROTA_ENDERECOS);
  return { ok: true };
}

// ═════════════════════════════ conta ══════════════════════════════════════════

/**
 * RN-13: apaga o perfil (`anonimizar_cliente`) da conta da SESSÃO. Só apaga
 * `auth.users` se a conta é exclusivamente `cliente` e não é o admin do SaaS;
 * lojista/admin + cliente perdem só o perfil (decisão 15, ADR h/I5). Leitura de
 * papéis falhou → fail-closed (nada é apagado).
 */
export async function excluirConta(payload?: unknown): Promise<ResultadoCliente> {
  const parsed = schemaExcluirConta.safeParse(payload ?? {});
  if (!parsed.success) return { ok: false, erro: MSG_EXCLUSAO };

  try {
    const supabase = await createClient();
    const usuario = await usuarioDaSessao(supabase);
    if (!usuario) return { ok: false, erro: MSG_SESSAO };

    const papeis = await buscarPapeisDoUsuario(supabase, usuario.id);
    const soCliente =
      papeis.length > 0 && papeis.every((p) => p === "cliente") && !ehAdminSaaS(usuario.id);

    const svc = createServiceClient();
    const { error } = await svc.rpc("anonimizar_cliente", { p_usuario: usuario.id });
    if (error) throw error;

    if (soCliente) {
      // Perfil já apagado; se o deleteUser falhar, a conta sem perfil volta a
      // /conta/completar num próximo login (spec) — só log.
      const { error: erroDelete } = await svc.auth.admin.deleteUser(usuario.id);
      if (erroDelete) console.error("[excluirConta] deleteUser", erroDelete.status ?? "");
    }
    await supabase.auth.signOut();
  } catch (e) {
    console.error("[excluirConta]", comoErro(e).code ?? "erro");
    return { ok: false, erro: MSG_EXCLUSAO };
  }

  redirect("/");
}

/** Encerra a sessão e volta ao `next` sanitizado ou à home. */
export async function sairCliente(payload?: unknown): Promise<ResultadoCliente> {
  const parsed = schemaSairCliente.safeParse(payload ?? {});
  const next = parsed.success ? sanitizarNext(parsed.data.next) : undefined;
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (e) {
    console.error("[sairCliente]", comoErro(e).code ?? "erro");
    return { ok: false, erro: "Não foi possível sair. Tente novamente." };
  }
  redirect(next ?? "/");
}
