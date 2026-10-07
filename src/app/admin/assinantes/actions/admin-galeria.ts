"use server";

// Server Actions ADMIN da galeria de imagens (specs/galeria-imagens-loja.md,
// página 2, D4, RN-G19). Mesmas ações do lojista sobre a loja-ALVO, sob
// service_role (BYPASSRLS) — a defesa NÃO é RLS (seguranca.md §7 "Padrão admin"):
//   - `validarLojaIdAdmin` ANTES de qualquer efeito (inválido → nada, nem
//     service client);
//   - `prepararContextoAdmin` FORA do try: prova admin antes de elevar; se lança,
//     PROPAGA (fail-closed);
//   - uso e remoção por `galeria-operacoes.ts` com lojaId VALIDADO (vira o
//     `p_loja_id` da RPC); antes do `remove`, cada caminho é conferido contra
//     `${lojaId}/` (sob service_role o caminho é a única amarra no Storage);
//     DELETE das linhas escopado por `loja_id`;
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
import {
  MSG_IMAGEM_INVALIDA,
  MSG_LISTAGEM_FALHOU,
  MSG_LOJA_INVALIDA,
  MSG_SELECAO_INVALIDA,
  type CursorGaleria,
  type ResultadoEnvioGaleria,
  type ResultadoListagemGaleria,
  type ResultadoRemocao,
  type ResultadoUsoImagens,
} from "@/lib/actions/galeria-contrato";
import { subirOriginalNaGaleria } from "@/lib/actions/galeria-upload";
import {
  consultarUsoDaGaleria,
  executarRemocaoDaGaleria,
  extrairParDeBlobs,
} from "@/lib/actions/galeria-operacoes";
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
  const par = extrairParDeBlobs(formData);
  if (!par) return { ok: false, erro: MSG_IMAGEM_INVALIDA };

  // 3. prova de admin FORA do try. Se lança, PROPAGA.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  // 4. validação, teto, caminhos `${lojaId}/galeria/…` e INSERT por escopo.inserir.
  const r = await subirOriginalNaGaleria({
    client: svc,
    lojaId: loja.lojaId,
    original: par.original,
    miniatura: par.miniatura,
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

  // Nunca rejeita: falha vira MSG_USO_FALHOU, detalhe só no log.
  return consultarUsoDaGaleria(svc, loja.lojaId, parsed.data, "consultarUsoImagensAdmin");
}

/**
 * Remove originais da loja-alvo pela mesma operação do lojista
 * (`executarRemocaoDaGaleria`), com o service client e `lojaId` validado
 * (nunca do payload): RPC → prefixo `${lojaId}/` → Storage → DELETE escopado,
 * e a varredura de recortes sem uso.
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

  // Nunca rejeita: falha vira MSG_REMOCAO_FALHOU, detalhe só no log.
  const r = await executarRemocaoDaGaleria(
    svc,
    loja.lojaId,
    parsed.data,
    "removerImagensGaleriaAdmin",
  );
  if (!r.ok) return r;

  registrarAcessoAdmin(svc, {
    lojaId: loja.lojaId,
    acao: "galeria_remover",
    metadados: { quantidade: r.removidas },
  });
  revalidarGaleriaAdmin(loja.lojaId);
  return r;
}
