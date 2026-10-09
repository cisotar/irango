"use server";

// Server Actions ADMIN do MODAL SAZONAL (Avisos) na loja-ALVO — issue 362,
// tasks/362-sub-rota-admin-de-avisos.md §Server Actions admin. As mesmas cinco
// ações do lojista (`@/lib/actions/modalSazonal`), agora sobre a loja de
// terceiro, sob service_role (BYPASSRLS) — a defesa NÃO é RLS (seguranca.md §7
// "Padrão admin"). Molde: `admin-galeria.ts`.
//
// Ordem INEGOCIÁVEL em cada action:
//   1. `validarLojaIdAdmin(lojaId)` — inválido → nada, nem service client;
//   2. `idModalValido` (z.guid()) no `id` de rota / `schemaModalSazonal.safeParse`
//      no payload, ANTES de qualquer I/O (o schema é `.strict()`: `loja_id`,
//      `id`, `ativo` ou `criado_em` forjados reprovam o payload inteiro);
//   3. `prepararContextoAdmin(lojaId)` FORA do try — prova admin ANTES de
//      elevar; se lança, PROPAGA (fail-closed, nunca `{ ok: false }` amigável);
//   4. escrita com o `lojaId` VALIDADO da URL: `p_loja_id` nas RPCs e, nos
//      UPDATE/DELETE, o wrapper `escopo` de `prepararContextoAdmin`, que injeta
//      `.eq("loja_id")` + `.eq("id")` POR CONSTRUÇÃO. O `loja_id` NUNCA vem do
//      payload (RN-11);
//   5. `registrarAcessoAdmin` (`admin_acessos`) + revalidate.
//
// Criar/editar passam pela RPC transacional `salvar_modal_sazonal` (RN-M15:
// linha + mensagem + junções ou nada) e ativar pelo OVERLOAD DE 2 ARGS de
// `ativar_modal_sazonal` (RN-M16: nunca dois ativos, nunca zero), ambos abertos
// à via de serviço pela migration 20261008120000 — que amarra a loja-alvo NO
// BANCO (`loja_id = p_loja_id`), sem janela TOCTOU em TS.
//
// Os argumentos da RPC vêm de `montarPatchModalSazonal` (allowlist coluna a
// coluna, módulo neutro) e a validação de `schemaModalSazonal`: SEM segunda
// allowlist. `p_mostrar_promocoes_junto` ausente chega como `null` (preservar),
// nunca `false`.
//
// Sem rate limit: um operador só (mesma decisão de `admin-galeria.ts`, RN-G13).
//
// Erro do banco → mensagem genérica na UI, detalhe no `console.error` do
// servidor (seguranca.md §14).
//
// Módulo `'use server'`: só EXPORTA funções async.

import { revalidatePath } from "next/cache";

import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import {
  ERRO_GENERICO,
  ERRO_VALIDACAO,
  idModalValido,
  montarPatchModalSazonal,
  type ResultadoModalSazonal,
} from "@/lib/actions/patches-modal-sazonal";
import type { Database } from "@/lib/database.types";
import {
  schemaModalSazonal,
  type DadosModalSazonal,
} from "@/lib/validacoes/modalSazonal";

const ERRO_NAO_ENCONTRADO = "Aviso não encontrado nesta loja.";

/** O service client que `prepararContextoAdmin` devolve (sem repetir o tipo). */
type ClientServico = Awaited<ReturnType<typeof prepararContextoAdmin>>["svc"];

type Funcoes = Database["public"]["Functions"];

/**
 * Os DOIS pontos em que `database.types.ts` fica atrás do banco (e os únicos
 * casts deste módulo — a TABELA `modais_sazonais` está nos tipos gerados, então
 * todo UPDATE/DELETE vai pelo wrapper `escopo`, tipado):
 *
 *  - `salvar_modal_sazonal` é gerada com `p_modal_id: string`, `p_mensagem: Json`
 *    e `p_mostrar_promocoes_junto: boolean`, mas os três são NULÁVEIS no banco
 *    (`null` = criar / sem mensagem / preservar o valor gravado);
 *  - `ativar_modal_sazonal` é gerada só com o overload de 1 arg do lojista; o de
 *    2 args (`p_loja_id`, migration 20261008120000) ainda não está nos tipos.
 *
 * O cast fica no ARGUMENTO, nunca no client: o `svc` segue tipado por `Database`
 * em todo o resto. Regenerar `database.types.ts` apaga os dois.
 */
type ArgsSalvarRpc = Funcoes["salvar_modal_sazonal"]["Args"];
type ArgsAtivarRpc = Funcoes["ativar_modal_sazonal"]["Args"] & { p_loja_id: string };

/** O que vai em `admin_acessos.acao` — união fechada: typo não compila. */
type AcaoModalSazonal =
  | "modal_sazonal_criar"
  | "modal_sazonal_editar"
  | "modal_sazonal_ativar"
  | "modal_sazonal_desativar"
  | "modal_sazonal_remover";

/** Rotas da loja-alvo + a sub-rota admin de Avisos. */
function revalidarAvisosAdmin(lojaId: string): void {
  revalidarLojaAdmin(lojaId);
  revalidatePath(`/admin/assinantes/${lojaId}/configuracoes/promocoes`);
}

/**
 * Criar e editar são a MESMA chamada à RPC transacional, mudando só
 * `p_modal_id` (`null` = criar). `p_loja_id` é o lojaId VALIDADO da URL, e o
 * `svc` chega JÁ provado por `prepararContextoAdmin` no corpo da action (a
 * prova de admin nunca mora num helper: cada export a faz, fora do try).
 */
async function salvarViaRpcAdmin(
  svc: ClientServico,
  lojaId: string,
  modalId: string | null,
  dados: DadosModalSazonal,
  /** Nome da action que chamou — vai no LOG (`[criarModalSazonalAdmin] …`). */
  rotulo: string,
  /** Verbo de AUDITORIA, que vai em `admin_acessos.acao`. */
  acao: AcaoModalSazonal,
): Promise<ResultadoModalSazonal> {
  try {
    const { data, error } = await svc.rpc("salvar_modal_sazonal", {
      ...montarPatchModalSazonal(dados),
      p_loja_id: lojaId,
      p_modal_id: modalId,
    } as unknown as ArgsSalvarRpc);
    if (error) {
      console.error(`[${rotulo}] rpc salvar_modal_sazonal:`, error);
      return { ok: false, erro: ERRO_GENERICO };
    }
    // A RPC devolve o id do modal gravado; sem ele, nada foi confirmado.
    if (data == null) {
      console.error(`[${rotulo}] rpc salvar_modal_sazonal sem id de retorno`);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId,
      acao,
      entidadeId: typeof data === "string" ? data : undefined,
    });
    revalidarAvisosAdmin(lojaId);
    return { ok: true };
  } catch (e) {
    console.error(`[${rotulo}]`, e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Cria um aviso na loja-alvo (nasce rascunho — a RPC nunca liga `ativo`). */
export async function criarModalSazonalAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_VALIDACAO };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };

  // Prova de admin FORA do try. Se lança, PROPAGA.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  return salvarViaRpcAdmin(
    svc,
    loja.lojaId,
    null,
    parsed.data,
    "criarModalSazonalAdmin",
    "modal_sazonal_criar",
  );
}

/**
 * Edita título/janela/mensagem/seleção de um aviso da loja-alvo. A RPC escopa
 * por `id` + `p_loja_id` e recusa modal de outra loja com a MESMA mensagem de
 * id inexistente — nunca `{ ok: true }` silencioso.
 */
export async function editarModalSazonalAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoModalSazonal> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_VALIDACAO };
  if (!idModalValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const parsed = schemaModalSazonal.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };

  // Prova de admin FORA do try. Se lança, PROPAGA.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  return salvarViaRpcAdmin(
    svc,
    loja.lojaId,
    id,
    parsed.data,
    "editarModalSazonalAdmin",
    "modal_sazonal_editar",
  );
}

/**
 * Ativa um aviso da loja-alvo pelo OVERLOAD DE 2 ARGS da RPC transacional
 * (issue 362): desliga o ativo anterior e liga o alvo na mesma transação, e só
 * depois de provar no BANCO que o modal é da loja-alvo. A pré-checagem em TS
 * seria TOCTOU e, sob service_role, nada mais filtraria.
 */
export async function ativarModalSazonalAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoModalSazonal> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_VALIDACAO };
  if (!idModalValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error } = await svc.rpc("ativar_modal_sazonal", {
      p_modal_id: id,
      p_loja_id: loja.lojaId,
    } as ArgsAtivarRpc);
    if (error) {
      console.error("[ativarModalSazonalAdmin] rpc ativar_modal_sazonal:", error);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "modal_sazonal_ativar",
      entidadeId: id,
    });
    revalidarAvisosAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[ativarModalSazonalAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Desativa um aviso da loja-alvo (vira rascunho, sem perder a configuração).
 * UPDATE pelo wrapper `escopo.atualizar`, que injeta `.eq("loja_id")` +
 * `.eq("id")` POR CONSTRUÇÃO (admin-loja.ts §criarEscopoLoja): sob service_role
 * a RLS não filtra, então esse par é a única amarra de tenant — e o wrapper
 * existe para torná-lo impossível de esquecer. `count === 0` (modal de outra
 * loja ou inexistente) RECUSA — nunca `{ ok: true }` silencioso.
 */
export async function desativarModalSazonalAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoModalSazonal> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_VALIDACAO };
  if (!idModalValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error, count } = await escopo.atualizar("modais_sazonais", id, {
      ativo: false,
    });
    if (error) {
      console.error("[desativarModalSazonalAdmin]", error);
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (count === 0) return { ok: false, erro: ERRO_NAO_ENCONTRADO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "modal_sazonal_desativar",
      entidadeId: id,
    });
    revalidarAvisosAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[desativarModalSazonalAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Remove um aviso da loja-alvo (destrutivo). DELETE pelo MESMO wrapper escopado
 * e a mesma detecção de 0 linhas do desativar. As junções de categoria/cardápio
 * caem junto pelo `ON DELETE CASCADE` das FKs compostas (migration 300).
 */
export async function removerModalSazonalAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoModalSazonal> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_VALIDACAO };
  if (!idModalValido(id)) return { ok: false, erro: ERRO_VALIDACAO };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error, count } = await escopo.remover("modais_sazonais", id);
    if (error) {
      console.error("[removerModalSazonalAdmin]", error);
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (count === 0) return { ok: false, erro: ERRO_NAO_ENCONTRADO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "modal_sazonal_remover",
      entidadeId: id,
    });
    revalidarAvisosAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerModalSazonalAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
