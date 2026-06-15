"use server";

// Server Actions de configuração da loja (issue 030): perfil/slug, horários, tema.
//
// Princípios inegociáveis aplicados aqui:
//  - NÃO confiar no cliente (seguranca.md §10): todo payload passa por safeParse
//    ANTES de qualquer I/O. Schemas são `.strict()` — chave extra reprova.
//  - RN-A5 / allowlist (seguranca.md §2): o patch do UPDATE é montado EXPLÍCITO,
//    coluna a coluna, a partir do dado JÁ validado. Colunas autoritativas
//    (dono_id, ativo, assinatura_*, hotmart_*, consentimento_*, id) JAMAIS entram.
//  - RLS como última linha (seguranca.md §2): o UPDATE roda no client AUTENTICADO
//    (política `lojas_update_proprio`, escopo auth.uid() = dono_id). O service_role
//    (BYPASSRLS) só checa unicidade de slug, escopado manualmente por slug+exceto.
//  - Erro interno não vaza (seguranca.md §14): detalhe vai pro console.error do
//    servidor; o cliente recebe mensagem genérica.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaDoDono, slugExiste } from "@/lib/supabase/queries/lojas";
import { schemaPerfil, schemaHorarios, schemaTema } from "@/lib/validacoes/loja";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";

export type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

/**
 * Revalida a vitrine best-effort: o dado JÁ foi persistido com sucesso, então
 * uma falha na camada de cache NÃO pode rebaixar o resultado para erro. Só loga.
 */
function revalidarVitrine(...slugs: string[]): void {
  for (const slug of slugs) {
    try {
      revalidatePath(`/${slug}`);
    } catch (e) {
      console.error("revalidarVitrine:", e);
    }
  }
}

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_SLUG_OCUPADO = "Este endereço (slug) já está em uso por outra loja.";
const ERRO_SEM_LOJA = "Loja não encontrada.";

/**
 * Atualiza o perfil/slug da loja do dono autenticado. Se o slug mudou, checa
 * unicidade via service_role excluindo a própria loja antes de qualquer UPDATE.
 */
export async function salvarPerfil(payload: unknown): Promise<ResultadoSalvar> {
  const ip = extrairIp(await headers());
  const rl = await verificarRateLimit("salvarPerfil", ip);
  if (!rl.permitido) return { ok: false, erro: "Muitas tentativas. Aguarde um instante." };

  const parsed = schemaPerfil.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const dados = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    if (dados.slug !== loja.slug) {
      const ocupado = await slugExiste(createServiceClient(), dados.slug, loja.id);
      if (ocupado) return { ok: false, erro: ERRO_SLUG_OCUPADO };
    }

    // Allowlist explícita (RN-A5): só estas colunas podem ser escritas.
    const patch: Record<string, unknown> = {
      nome: dados.nome,
      slug: dados.slug,
    };
    if (dados.telefone !== undefined) patch.telefone = dados.telefone;
    if (dados.whatsapp !== undefined) patch.whatsapp = dados.whatsapp;

    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000), mesmo com
    // RLS escopando a linha. Escopo por id da própria loja (já resolvida acima).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    revalidarVitrine(dados.slug, ...(dados.slug !== loja.slug ? [loja.slug] : []));
    return { ok: true };
  } catch (e) {
    console.error("salvarPerfil:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

const ERRO_PERFIL_INCOMPLETO =
  "Complete nome e WhatsApp antes de publicar a loja.";

/**
 * Publica (ativo=true) ou despublica (ativo=false) a vitrine da loja do dono.
 *
 * `ativo` é coluna PROTEGIDA pelo trigger anti-billing (057) — o dono não pode
 * alterá-la via client autenticado. Por isso o flip roda no service_role
 * (BYPASSRLS). Como o service_role ignora RLS, o escopo é reafirmado À MÃO por
 * `id` + `dono_id` da loja JÁ resolvida sob RLS (buscarLojaDoDono no client
 * autenticado) — impede ativar a loja de terceiro mesmo se `id` vazasse.
 *
 * Gate de publicação (não confiar no cliente): exige perfil mínimo (nome +
 * whatsapp) verificado no servidor a partir do banco, nunca do payload.
 */
export async function definirPublicacao(
  publicar: boolean,
): Promise<ResultadoSalvar> {
  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    // Perfil mínimo para ir ao ar: nome preenchido + whatsapp cadastrado.
    if (publicar && (!loja.nome?.trim() || !loja.whatsapp)) {
      return { ok: false, erro: ERRO_PERFIL_INCOMPLETO };
    }

    // service_role: trigger 057 bloqueia o dono de mexer em `ativo`. Escopo
    // reafirmado por id + dono_id (BYPASSRLS não tem RLS para conter).
    const { error } = await createServiceClient()
      .from("lojas")
      .update({ ativo: publicar })
      .eq("id", loja.id)
      .eq("dono_id", loja.dono_id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("definirPublicacao:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Atualiza apenas a coluna `horarios` da loja do dono autenticado. */
export async function salvarHorarios(payload: unknown): Promise<ResultadoSalvar> {
  const parsed = schemaHorarios.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const horarios = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    const patch = { horarios } satisfies Record<string, unknown>;
    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("salvarHorarios:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Atualiza apenas a coluna `tema` da loja do dono autenticado. */
export async function salvarTema(payload: unknown): Promise<ResultadoSalvar> {
  const parsed = schemaTema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const tema = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    const patch = { tema } satisfies Record<string, unknown>;
    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("salvarTema:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}