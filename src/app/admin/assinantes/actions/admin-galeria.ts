"use server";

// Server Actions ADMIN da galeria de imagens (specs/galeria-imagens-loja.md,
// página 2, D4, RN-G19). Mesmas ações do lojista sobre a loja-ALVO, sob
// service_role (BYPASSRLS) — a defesa NÃO é RLS (seguranca.md §7 "Padrão admin"):
//   - `validarLojaIdAdmin` ANTES de qualquer efeito (inválido → nada, nem
//     service client);
//   - `prepararContextoAdmin` FORA do try: prova admin antes de elevar; se lança,
//     PROPAGA (fail-closed);
//   - RPC com `p_loja_id` = lojaId VALIDADO; antes do `remove`, cada caminho é
//     conferido contra `${lojaId}/` (sob service_role o caminho é a única amarra
//     no Storage); DELETE das linhas escopado por `loja_id`;
//   - INSERT por `escopo.inserir`; `admin_acessos` registra cada ação;
//   - sem rate limit (um operador, RN-G13).
//
// Módulo `'use server'`: só EXPORTA funções async.

import { revalidatePath } from "next/cache";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import {
  CAMPO_MINIATURA,
  MSG_IMAGEM_INVALIDA,
  MSG_LISTAGEM_FALHOU,
  MSG_LOJA_INVALIDA,
  MSG_REMOCAO_FALHOU,
  MSG_SELECAO_INVALIDA,
  MSG_USO_FALHOU,
  lerRespostaRpcRemocao,
  type CursorGaleria,
  type ResultadoEnvioGaleria,
  type ResultadoListagemGaleria,
  type ResultadoRemocao,
  type ResultadoUsoImagens,
} from "@/lib/actions/galeria-contrato";
import { subirOriginalNaGaleria } from "@/lib/actions/galeria-upload";
import {
  apagarImagensPendentes,
  processarRemocoesPendentes,
} from "@/lib/actions/galeria-pendentes";
import { listarImagensDaLojaAdmin } from "@/lib/supabase/queries/imagens";
import { schemaCursorGaleria, schemaIdsImagens } from "@/lib/validacoes/galeria";

/** Passo 13 admin: rotas da loja-alvo + a galeria admin. */
function revalidarGaleriaAdmin(lojaId: string): void {
  revalidarLojaAdmin(lojaId);
  revalidatePath(`/admin/assinantes/${lojaId}/galeria`);
}

/** Envia uma original (+ miniatura) para a galeria da loja-alvo (`loja_id` no FormData). */
export async function enviarImagemGaleriaAdmin(
  formData: FormData,
): Promise<ResultadoEnvioGaleria> {
  // 1. loja_id → uuid ANTES de qualquer efeito e de elevar a service_role.
  const loja = validarLojaIdAdmin(formData.get("loja_id"));
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };

  // 2. presença dos arquivos; o CONTEÚDO só é validado depois da prova de admin.
  const original = formData.get(CAMPO_ARQUIVO);
  const miniatura = formData.get(CAMPO_MINIATURA);
  if (
    !(original instanceof Blob) ||
    original.size <= 0 ||
    !(miniatura instanceof Blob) ||
    miniatura.size <= 0
  ) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }

  // 3. prova de admin FORA do try. Se lança, PROPAGA.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  // 4. validação, teto, caminhos `${lojaId}/galeria/…` e INSERT por escopo.inserir.
  const r = await subirOriginalNaGaleria({
    client: svc,
    lojaId: loja.lojaId,
    original,
    miniatura,
    inserir: (linha) =>
      escopo.inserir("imagens_loja", linha).select("criado_em").maybeSingle(),
    rotulo: "enviarImagemGaleriaAdmin",
  });
  if (!r.ok) return r;

  registrarAcessoAdmin(svc, {
    lojaId: loja.lojaId,
    acao: "galeria_enviar",
    entidadeId: r.imagem.id,
  });
  revalidarGaleriaAdmin(loja.lojaId);
  return r;
}

/** "Carregar mais" da galeria da loja-alvo. O cursor só posiciona a página. */
export async function listarImagensGaleriaAdmin(
  lojaId: string,
  cursor?: CursorGaleria,
): Promise<ResultadoListagemGaleria> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  const parsed = schemaCursorGaleria.safeParse(cursor);
  if (!parsed.success) return { ok: false, erro: MSG_LISTAGEM_FALHOU };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const pagina = await listarImagensDaLojaAdmin(svc, loja.lojaId, parsed.data);
    return { ok: true, ...pagina };
  } catch (e) {
    console.error("[listarImagensGaleriaAdmin]", e);
    return { ok: false, erro: MSG_LISTAGEM_FALHOU };
  }
}

/** Prévia do uso na loja-alvo (a conta que vale é a da RPC de remoção). */
export async function consultarUsoImagensAdmin(
  lojaId: string,
  ids: string[],
): Promise<ResultadoUsoImagens> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  const parsed = schemaIdsImagens.safeParse(ids);
  if (!parsed.success) return { ok: false, erro: MSG_SELECAO_INVALIDA };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { data, error } = await svc.rpc("uso_imagens_loja", { p_loja_id: loja.lojaId, p_ids: parsed.data });
    if (error) {
      console.error("[consultarUsoImagensAdmin]", error);
      return { ok: false, erro: MSG_USO_FALHOU };
    }
    return { ok: true, usos: data ?? [] };
  } catch (e) {
    console.error("[consultarUsoImagensAdmin]", e);
    return { ok: false, erro: MSG_USO_FALHOU };
  }
}

/**
 * Remove originais da loja-alvo pela mesma RPC do lojista, via serviço com
 * `p_loja_id` = lojaId validado (nunca do payload). Depois do commit: prefixo
 * `${lojaId}/` → Storage → DELETE escopado; e a varredura de recortes sem uso.
 */
export async function removerImagensGaleriaAdmin(
  lojaId: string,
  ids: string[],
): Promise<ResultadoRemocao> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: MSG_LOJA_INVALIDA };
  const parsed = schemaIdsImagens.safeParse(ids);
  if (!parsed.success) return { ok: false, erro: MSG_SELECAO_INVALIDA };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { data, error } = await svc.rpc("remover_imagens_loja", { p_loja_id: loja.lojaId, p_ids: parsed.data });
    const resposta = error ? null : lerRespostaRpcRemocao(data);
    if (!resposta) {
      console.error("[removerImagensGaleriaAdmin] falha na RPC", error ?? data);
      return { ok: false, erro: MSG_REMOCAO_FALHOU };
    }

    // Passos 9–12 (nunca rejeitam): prefixo da loja-alvo, Storage, DELETE com
    // `.eq("loja_id", lojaId)`, e a varredura RN-G21.
    await apagarImagensPendentes(svc, loja.lojaId, resposta.caminhos, "removerImagensGaleriaAdmin");
    await processarRemocoesPendentes(svc, loja.lojaId);

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "galeria_remover",
      metadados: { quantidade: resposta.removidas },
    });
    revalidarGaleriaAdmin(loja.lojaId);

    return {
      ok: true,
      removidas: resposta.removidas,
      ignoradas: resposta.ignoradas,
      produtosLimpos: resposta.produtosLimpos,
      logoLimpa: resposta.logoLimpa,
    };
  } catch (e) {
    console.error("[removerImagensGaleriaAdmin]", e);
    return { ok: false, erro: MSG_REMOCAO_FALHOU };
  }
}
