"use server";

// Server Actions da galeria de imagens do LOJISTA (specs/galeria-imagens-loja.md,
// página 1). Contrato de segurança (seguranca.md §10/§13/§14):
//   - client AUTENTICADO (RLS de `imagens_loja` e do bucket), NUNCA service_role;
//   - loja DERIVADA do auth (buscarLojaDoDono) — nada do payload escolhe a loja;
//   - rate limit por `loja.id` (RN-G13, fail-open);
//   - remoção: banco (RPC) → Storage → DELETE, só caminhos devolvidos pela RPC e
//     com prefixo da loja; falha do Storage deixa as linhas pendentes (RN-G10);
//   - erro genérico ao client, detalhe só em console.error.
//
// Módulo `'use server'`: só EXPORTA funções async. Constantes, tipos e
// mensagens moram em `galeria-contrato.ts`.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarImagensDaLoja } from "@/lib/supabase/queries/imagens";
import { verificarRateLimit } from "@/lib/utils/rateLimit";
import { schemaCursorGaleria, schemaIdsImagens } from "@/lib/validacoes/galeria";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import {
  CAMPO_MINIATURA,
  MSG_IMAGEM_INVALIDA,
  MSG_LISTAGEM_FALHOU,
  MSG_MUITAS_TENTATIVAS,
  MSG_NAO_AUTORIZADO,
  MSG_REMOCAO_FALHOU,
  MSG_SELECAO_INVALIDA,
  MSG_USO_FALHOU,
  lerRespostaRpcRemocao,
  type CursorGaleria,
  type ResultadoEnvioGaleria,
  type ResultadoListagemGaleria,
  type ResultadoRemocao,
  type ResultadoUsoImagens,
} from "./galeria-contrato";
import { subirOriginalNaGaleria } from "./galeria-upload";
import { apagarImagensPendentes, processarRemocoesPendentes } from "./galeria-pendentes";

/**
 * Envia uma original (+ miniatura, P9) para a galeria da loja do auth. Teto,
 * validação de conteúdo e caminhos ficam no servidor (`subirOriginalNaGaleria`).
 */
export async function enviarImagemGaleria(formData: FormData): Promise<ResultadoEnvioGaleria> {
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

  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) return { ok: false, erro: MSG_NAO_AUTORIZADO };

  const rl = await verificarRateLimit("enviarImagemGaleria", loja.id);
  if (!rl.permitido) return { ok: false, erro: MSG_MUITAS_TENTATIVAS };

  const r = await subirOriginalNaGaleria({
    client: supabase,
    lojaId: loja.id,
    original,
    miniatura,
    inserir: (linha) =>
      supabase
        .from("imagens_loja")
        .insert({ ...linha, loja_id: loja.id })
        .select("criado_em")
        .maybeSingle(),
    rotulo: "enviarImagemGaleria",
  });
  if (r.ok) revalidatePath("/painel/galeria");
  return r;
}

/** "Carregar mais" (keyset). O cursor só posiciona a página; a loja é do auth. */
export async function listarImagensGaleria(
  cursor?: CursorGaleria,
): Promise<ResultadoListagemGaleria> {
  const parsed = schemaCursorGaleria.safeParse(cursor);
  if (!parsed.success) return { ok: false, erro: MSG_LISTAGEM_FALHOU };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: MSG_NAO_AUTORIZADO };

    const rl = await verificarRateLimit("listarImagensGaleria", loja.id);
    if (!rl.permitido) return { ok: false, erro: MSG_MUITAS_TENTATIVAS };

    const pagina = await listarImagensDaLoja(supabase, loja.id, parsed.data);
    return { ok: true, ...pagina };
  } catch (e) {
    console.error("[listarImagensGaleria]", e);
    return { ok: false, erro: MSG_LISTAGEM_FALHOU };
  }
}

/** Prévia do uso antes de confirmar a remoção. A conta que vale é a da RPC de remoção. */
export async function consultarUsoImagens(ids: string[]): Promise<ResultadoUsoImagens> {
  const parsed = schemaIdsImagens.safeParse(ids);
  if (!parsed.success) return { ok: false, erro: MSG_SELECAO_INVALIDA };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: MSG_NAO_AUTORIZADO };

    const { data, error } = await supabase.rpc("uso_imagens_loja", {
      p_loja_id: loja.id,
      p_ids: parsed.data,
    });
    if (error) {
      console.error("[consultarUsoImagens]", error);
      return { ok: false, erro: MSG_USO_FALHOU };
    }
    return { ok: true, usos: data ?? [] };
  } catch (e) {
    console.error("[consultarUsoImagens]", e);
    return { ok: false, erro: MSG_USO_FALHOU };
  }
}

/**
 * Remove originais da loja do auth (e as cópias). A RPC prova posse, ignora o
 * que não é original não pendente da loja (D8), recalcula o uso, limpa produtos
 * e logo e marca a família como pendente. Depois do commit: Storage → DELETE,
 * e a varredura de recortes sem uso (RN-G21).
 */
export async function removerImagensGaleria(ids: string[]): Promise<ResultadoRemocao> {
  const parsed = schemaIdsImagens.safeParse(ids);
  if (!parsed.success) return { ok: false, erro: MSG_SELECAO_INVALIDA };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: MSG_NAO_AUTORIZADO };

    const rl = await verificarRateLimit("removerImagensGaleria", loja.id);
    if (!rl.permitido) return { ok: false, erro: MSG_MUITAS_TENTATIVAS };

    const { data, error } = await supabase.rpc("remover_imagens_loja", {
      p_loja_id: loja.id,
      p_ids: parsed.data,
    });
    const resposta = error ? null : lerRespostaRpcRemocao(data);
    if (!resposta) {
      console.error("[removerImagensGaleria] falha na RPC", error ?? data);
      return { ok: false, erro: MSG_REMOCAO_FALHOU };
    }

    // Passos 9–12: prefixo da loja, Storage e DELETE das pendentes. Nunca rejeita.
    await apagarImagensPendentes(supabase, loja.id, resposta.caminhos, "removerImagensGaleria");
    await processarRemocoesPendentes(supabase, loja.id);

    // Passo 13.
    revalidatePath("/painel/galeria");
    revalidatePath("/painel/produtos");
    revalidatePath("/painel/configuracoes/perfil");
    revalidatePath("/loja/[slug]", "page");

    return {
      ok: true,
      removidas: resposta.removidas,
      ignoradas: resposta.ignoradas,
      produtosLimpos: resposta.produtosLimpos,
      logoLimpa: resposta.logoLimpa,
    };
  } catch (e) {
    console.error("[removerImagensGaleria]", e);
    return { ok: false, erro: MSG_REMOCAO_FALHOU };
  }
}
