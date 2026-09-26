"use server";

// Server Actions do MODAL DE DIVULGAÇÃO SAZONAL (issue 301, spec
// modal-divulgacao-sazonal). Molde: `salvarModalidadesEntrega`/`criarCupom`
// (rate-limit → zod → buscarLojaDoDono → allowlist-patch → escrita →
// revalidatePath).
//
// Contrato inegociável (seguranca.md §2/§10/§14):
//   - `schemaModalSazonal` (`.strict()` + `.max()`) valida ANTES de qualquer I/O —
//     chave extra (ex.: `loja_id` forjado) reprova, lista acima do teto reprova,
//     seleção vazia reprova (RN-06). O cliente NUNCA injeta coluna autoritativa.
//   - `loja_id` é SEMPRE derivado de `buscarLojaDoDono`, NUNCA do payload (RN-11).
//   - client AUTENTICADO (RLS `modais_sazonais_escrita_propria` isola por dono);
//     nada de service_role — a escrita do lojista passa pela RLS.
//   - patch por allowlist COLUNA A COLUNA (`montarPatchModalSazonal`), nunca spread.
//   - ativar desativa o anterior na mesma transição de estado (RN-05); o índice
//     único parcial `WHERE ativo = true` é o backstop — `23505` vira erro genérico.
//   - erro do banco (23505/23503/23514) → mensagem genérica na UI, detalhe no
//     `console.error` do servidor (seguranca.md §14).

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { schemaModalSazonal } from "@/lib/validacoes/modalSazonal";
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

// Fronteira de escrita nas tabelas do modal sazonal (migration 300), que ainda
// NÃO estão em `database.types.ts` (o cloud não aplicou a migration; `gen types`
// não as vê). Até a regeneração, o acesso a `modais_sazonais`/junções é por este
// mínimo query-builder — só os métodos que as actions usam. `loja_id` e `ativo`
// continuam derivados/controlados pelo servidor: a fronteira não afrouxa trava.
type RespostaModal = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};
interface CadeiaModal extends PromiseLike<RespostaModal> {
  select(cols: string): CadeiaModal;
  insert(row: unknown): CadeiaModal;
  update(row: Record<string, unknown>): CadeiaModal;
  delete(): CadeiaModal;
  eq(coluna: string, valor: unknown): CadeiaModal;
  neq(coluna: string, valor: unknown): CadeiaModal;
  maybeSingle(): PromiseLike<RespostaModal>;
  single(): PromiseLike<RespostaModal>;
}
type ClientModal = { from(tabela: string): CadeiaModal };

/**
 * Regrava as junções de categoria/cardápio de um modal, atomicamente com a
 * linha (RN-06): apaga as antigas e insere a seleção nova. Escopa por `loja_id`
 * e `modal_sazonal_id`; a FK COMPOSTA (banco) recusa (`23503`) vínculo de outra
 * loja (RN-11) e derruba a operação. Lança em erro — o caller trata no catch.
 */
async function regravarSelecao(
  db: ClientModal,
  lojaId: string,
  modalId: string,
  categorias: string[],
  cardapios: string[],
): Promise<void> {
  const { error: erroDelCat } = await db
    .from("modal_sazonal_categorias")
    .delete()
    .eq("loja_id", lojaId)
    .eq("modal_sazonal_id", modalId);
  if (erroDelCat) throw erroDelCat;

  const { error: erroDelCard } = await db
    .from("modal_sazonal_cardapios")
    .delete()
    .eq("loja_id", lojaId)
    .eq("modal_sazonal_id", modalId);
  if (erroDelCard) throw erroDelCard;

  if (categorias.length > 0) {
    const { error } = await db.from("modal_sazonal_categorias").insert(
      categorias.map((categoria_id) => ({
        loja_id: lojaId,
        modal_sazonal_id: modalId,
        categoria_id,
      })),
    );
    if (error) throw error;
  }

  if (cardapios.length > 0) {
    const { error } = await db.from("modal_sazonal_cardapios").insert(
      cardapios.map((cardapio_id) => ({
        loja_id: lojaId,
        modal_sazonal_id: modalId,
        cardapio_id,
      })),
    );
    if (error) throw error;
  }
}

/**
 * Cria um modal sazonal (rascunho — `ativo` fica no default `false` do banco;
 * ligar é `ativarModalSazonal`). zod ANTES de qualquer I/O; `loja_id` do dono;
 * a linha e as junções são gravadas juntas (RN-06).
 */
export async function criarModalSazonal(
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const dados = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    // Allowlist coluna a coluna (RN-11) + `loja_id` do DONO. `ativo` fica no
    // default do banco: um modal nasce rascunho.
    const { data, error } = await db
      .from("modais_sazonais")
      .insert({ ...montarPatchModalSazonal(dados), loja_id: loja.id })
      .select("id")
      .single();
    if (error) throw error;
    const modalId = (data as { id: string } | null)?.id;
    if (modalId == null) return { ok: false, erro: ERRO_GENERICO };

    await regravarSelecao(db, loja.id, modalId, dados.categorias, dados.cardapios);

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[criarModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Edita título/janela/seleção de um modal. UPDATE escopado por `id` + `loja_id`
 * do dono; `.select().maybeSingle()` detecta 0 linhas afetadas (modal de outra
 * loja, barrado pela RLS) e recusa — nunca `{ ok: true }` silencioso. As junções
 * são regravadas atomicamente com a linha (RN-06).
 */
export async function editarModalSazonal(
  id: string,
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const dados = parsed.data;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    // Escopo por id + loja_id do dono; `.select().maybeSingle()` confirma que a
    // linha existe e é da loja — 0 linhas (RLS) ⇒ recusa, não sucesso silencioso.
    const { data, error } = await db
      .from("modais_sazonais")
      .update(montarPatchModalSazonal(dados))
      .eq("id", id)
      .eq("loja_id", loja.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data == null) return { ok: false, erro: ERRO_SEM_LOJA };

    await regravarSelecao(db, loja.id, id, dados.categorias, dados.cardapios);

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("[editarModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Ativa um modal (RN-05). Verifica a POSSE ANTES de ativar (o modal é da loja do
 * dono?), desativa o ativo anterior na mesma transição de estado e liga o alvo.
 * O índice único parcial `WHERE ativo = true` é o backstop estrutural contra
 * corrida — `23505` vira erro genérico (seguranca.md §14), sem vazar o código.
 */
export async function ativarModalSazonal(
  id: string,
): Promise<ResultadoModalSazonal> {
  const rl = await verificarRateLimit("salvarPerfil", extrairIp(await headers()));
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_SEM_LOJA };
    const db = supabase as unknown as ClientModal;

    // POSSE (RN-11): o modal existe E é da loja do dono? `.eq("loja_id")`
    // explícito além da RLS; comparação também no servidor — modal de outra loja
    // (ou inexistente) recusa, sem virar oráculo de existência de id.
    const { data: modal, error: erroPosse } = await db
      .from("modais_sazonais")
      .select("loja_id")
      .eq("id", id)
      .maybeSingle();
    if (erroPosse) throw erroPosse;
    if (modal == null || (modal as { loja_id: string }).loja_id !== loja.id) {
      return { ok: false, erro: ERRO_SEM_LOJA };
    }

    // Transição de estado (RN-05): desativa o ativo anterior ANTES de ligar o
    // novo. O índice único parcial é o backstop se uma corrida escapar.
    const { error: erroDesativar } = await db
      .from("modais_sazonais")
      .update({ ativo: false })
      .eq("loja_id", loja.id)
      .eq("ativo", true)
      .neq("id", id);
    if (erroDesativar) throw erroDesativar;

    const { error: erroAtivar } = await db
      .from("modais_sazonais")
      .update({ ativo: true })
      .eq("id", id)
      .eq("loja_id", loja.id);
    if (erroAtivar) throw erroAtivar;

    revalidar(loja.slug);
    return { ok: true };
  } catch (e) {
    // 23505 (índice único parcial) e qualquer outro erro do banco → genérico.
    console.error("[ativarModalSazonal]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Desativa um modal (vira rascunho, sem perder a configuração — RN). */
export async function desativarModalSazonal(
  id: string,
): Promise<ResultadoModalSazonal> {
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
