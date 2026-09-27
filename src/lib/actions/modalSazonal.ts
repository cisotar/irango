"use server";

// Server Actions do MODAL DE DIVULGAÇÃO SAZONAL (issue 301, spec
// modal-divulgacao-sazonal). Molde: `salvarModalidadesEntrega`/`criarCupom`
// (rate-limit → zod → buscarLojaDoDono → allowlist → RPC → revalidatePath).
//
// Contrato inegociável (seguranca.md §2/§10/§14):
//   - `id` de rota passa por `z.guid()` ANTES de rate-limit e client (RN-M10).
//   - `schemaModalSazonal` (`.strict()` + `.max()`) valida ANTES de qualquer I/O —
//     chave extra (ex.: `loja_id` forjado) reprova, lista acima do teto reprova.
//     Seleção e mensagem são opcionais (RN-M02). O cliente NUNCA injeta coluna
//     autoritativa.
//   - `loja_id` é SEMPRE derivado de `buscarLojaDoDono`, NUNCA do payload (RN-11).
//   - client AUTENTICADO (RLS `modais_sazonais_escrita_propria` isola por dono);
//     nada de service_role — a escrita do lojista passa pela RLS.
//   - args por allowlist COLUNA A COLUNA (`montarPatchModalSazonal`), nunca spread;
//     criar/editar fazem UMA chamada à RPC transacional `salvar_modal_sazonal`
//     (RN-M15): linha, mensagem e junções gravadas juntas ou nada.
//   - ativar faz UMA chamada à RPC transacional `ativar_modal_sazonal` (RN-M16):
//     desativa o anterior e liga o alvo na mesma transação; o índice único
//     parcial `WHERE ativo = true` é o backstop contra corrida.
//   - erro do banco (23505/23503/23514) → mensagem genérica na UI, detalhe no
//     `console.error` do servidor (seguranca.md §14).

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { z } from "zod";
import {
  schemaModalSazonal,
  type DadosModalSazonal,
} from "@/lib/validacoes/modalSazonal";
import {
  montarPatchModalSazonal,
  type ResultadoModalSazonal,
} from "@/lib/actions/patches-modal-sazonal";
import { verificarRateLimit, extrairIp } from "@/lib/utils/rateLimit";

const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_SEM_LOJA = "Loja não encontrada.";
const ERRO_RATE_LIMIT = "Muitas tentativas. Aguarde um instante.";

const ROTA_PAINEL = "/painel/configuracoes/promocoes";

/** Revalida painel + vitrine best-effort: o dado JÁ foi persistido; falha de cache só loga. */
function revalidar(slug: string): void {
  for (const caminho of [ROTA_PAINEL, `/loja/${slug}`]) {
    try {
      revalidatePath(caminho);
    } catch (e) {
      console.error("[modalSazonal] revalidar:", e);
    }
  }
}

// Fronteira de acesso às tabelas do modal sazonal (migration 300). A migration JÁ
// está aplicada no cloud, mas `database.types.ts` ainda não foi regenerado, então
// o acesso a `modais_sazonais` e às RPCs `salvar_modal_sazonal`/`ativar_modal_sazonal` é por este mínimo
// client — só os métodos que as actions usam. `loja_id` e `ativo` continuam
// derivados/controlados pelo servidor: a fronteira não afrouxa trava.
type RespostaModal = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};
interface CadeiaModal extends PromiseLike<RespostaModal> {
  select(cols: string): CadeiaModal;
  update(row: Record<string, unknown>): CadeiaModal;
  delete(): CadeiaModal;
  eq(coluna: string, valor: unknown): CadeiaModal;
  maybeSingle(): PromiseLike<RespostaModal>;
}
type ClientModal = {
  from(tabela: string): CadeiaModal;
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<RespostaModal>;
};

/** RN-M10: `id` de rota é uuid ANTES de rate-limit, client e query. */
function idValido(id: unknown): id is string {
  return z.guid().safeParse(id).success;
}

/**
 * Grava linha + mensagem + seleção numa ÚNICA chamada à RPC transacional
 * `salvar_modal_sazonal` (RN-M15): ou tudo, ou nada. Criar = `modalId` `null`.
 * `p_loja_id` vem SEMPRE de `buscarLojaDoDono`; a RPC confere a posse (S2/S4) e
 * as FKs compostas recusam seleção de outra loja. Erro da RPC → log com o
 * detalhe e `ERRO_GENERICO` ao cliente (seguranca.md §14), sem retry.
 */
async function salvarViaRpc(
  contexto: string,
  modalId: string | null,
  dados: DadosModalSazonal,
): Promise<ResultadoModalSazonal> {
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    const { data, error } = await db.rpc("salvar_modal_sazonal", {
      ...montarPatchModalSazonal(dados),
      p_loja_id: loja.id,
      p_modal_id: modalId,
    });
    if (error) {
      console.error(`[${contexto}] rpc salvar_modal_sazonal:`, error);
      return { ok: false, erro: ERRO_GENERICO };
    }
    // A RPC devolve o id do modal gravado; sem ele, nada foi confirmado.
    if (data == null) {
      console.error(`[${contexto}] rpc salvar_modal_sazonal sem id de retorno`);
      return { ok: false, erro: ERRO_GENERICO };
    }

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error(`[${contexto}]`, e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Cria um modal sazonal (rascunho — a RPC nunca liga `ativo`; ligar é
 * `ativarModalSazonal`). zod ANTES de qualquer I/O; `loja_id` do dono; linha,
 * mensagem e junções gravadas juntas (RN-M15).
 */
export async function criarModalSazonal(
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };

  return salvarViaRpc("criarModalSazonal", null, parsed.data);
}

/**
 * Edita título/janela/mensagem/seleção de um modal. A RPC escopa por `id` +
 * `loja_id` do dono e recusa modal de outra loja (S4, mesma mensagem de id
 * inexistente) — nunca `{ ok: true }` silencioso.
 */
export async function editarModalSazonal(
  id: string,
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  if (!idValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };

  return salvarViaRpc("editarModalSazonal", id, parsed.data);
}

/**
 * Ativa um modal (RN-05, RN-M16) por UMA chamada à RPC transacional
 * `ativar_modal_sazonal`: desativa o ativo anterior e liga o alvo na mesma
 * transação — nunca fica zero ativos por falha entre dois requests. A RPC deriva
 * a loja do próprio modal e confere a posse contra `auth.uid()` antes de tocar
 * em linha; modal de outra loja ou inexistente recusa com a mesma mensagem.
 * Erro da RPC → log com o detalhe e `ERRO_GENERICO` ao cliente (seguranca.md §14).
 */
export async function ativarModalSazonal(
  id: string,
): Promise<ResultadoModalSazonal> {
  if (!idValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  try {
    const supabase = await createClient();
    // Só para o slug do revalidate e o fail-closed de "sem loja": a posse do
    // modal é conferida DENTRO da RPC.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    const { error } = await db.rpc("ativar_modal_sazonal", { p_modal_id: id });
    if (error) {
      console.error("[ativarModalSazonal] rpc ativar_modal_sazonal:", error);
      return { ok: false, erro: ERRO_GENERICO };
    }

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[ativarModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Desativa um modal (vira rascunho, sem perder a configuração — RN). */
export async function desativarModalSazonal(
  id: string,
): Promise<ResultadoModalSazonal> {
  if (!idValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    const { data, error } = await db
      .from("modais_sazonais")
      .update({ ativo: false })
      .eq("id", id)
      .eq("loja_id", loja.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data == null) return { ok: false, erro: ERRO_SEM_LOJA };

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[desativarModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Remove um modal (ação destrutiva — spec §Behaviors). DELETE escopado por `id`
 * + `loja_id` do dono; `.select().maybeSingle()` detecta 0 linhas afetadas
 * (modal de outra loja, barrado pela RLS) e recusa — nunca `{ ok: true }`
 * silencioso, mesmo contrato de `editarModalSazonal`/`desativarModalSazonal`.
 * As junções de categoria/cardápio caem junto pelo `ON DELETE CASCADE` das FKs
 * compostas (migration 300) — nenhum apagamento manual das junções aqui.
 */
export async function removerModalSazonal(
  id: string,
): Promise<ResultadoModalSazonal> {
  if (!idValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    const { data, error } = await db
      .from("modais_sazonais")
      .delete()
      .eq("id", id)
      .eq("loja_id", loja.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data == null) return { ok: false, erro: ERRO_SEM_LOJA };

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[removerModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
