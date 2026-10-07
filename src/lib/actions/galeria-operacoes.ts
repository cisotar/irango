// Operações da galeria comuns ao lojista e ao admin (specs/galeria-imagens-loja.md,
// páginas 1 e 2). Módulo NEUTRO — sem `'use server'`, para não virar Server
// Action exposta — com UMA implementação de cada fluxo. O chamador entra com o
// client (autenticado sob RLS, ou service client do admin) e com a `lojaId` já
// resolvida: da sessão (lojista) ou validada como uuid depois da prova de admin.
// Auth, escopo, validação zod, rate limit, revalidate e registro de acesso
// ficam em cada action; aqui fica só o que é igual nas duas pontas.
//
// Nada aqui rejeita: falha vira o resultado genérico, com o detalhe só no log
// (seguranca.md §14).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import {
  CAMPO_MINIATURA,
  MSG_REMOCAO_FALHOU,
  MSG_USO_FALHOU,
  lerRespostaRpcRemocao,
  type ResultadoRemocao,
  type ResultadoUsoImagens,
} from "./galeria-contrato";
import { apagarImagensPendentes, processarRemocoesPendentes } from "./galeria-pendentes";

type Client = SupabaseClient<Database>;

/**
 * Original + miniatura do FormData do envio. Só confere a PRESENÇA (Blob não
 * vazio); o conteúdo é validado por `subirOriginalNaGaleria`, depois da auth.
 */
export function extrairParDeBlobs(
  formData: FormData,
): { original: Blob; miniatura: Blob } | null {
  const original = formData.get(CAMPO_ARQUIVO);
  const miniatura = formData.get(CAMPO_MINIATURA);
  if (
    !(original instanceof Blob) ||
    original.size <= 0 ||
    !(miniatura instanceof Blob) ||
    miniatura.size <= 0
  ) {
    return null;
  }
  return { original, miniatura };
}

/** Prévia do uso das imagens da loja (a conta que vale é a da RPC de remoção). */
export async function consultarUsoDaGaleria(
  client: Client,
  lojaId: string,
  ids: string[],
  rotulo: string,
): Promise<ResultadoUsoImagens> {
  try {
    const { data, error } = await client.rpc("uso_imagens_loja", { p_loja_id: lojaId, p_ids: ids });
    if (error) {
      console.error(`[${rotulo}]`, error);
      return { ok: false, erro: MSG_USO_FALHOU };
    }
    return { ok: true, usos: data ?? [] };
  } catch (e) {
    console.error(`[${rotulo}]`, e);
    return { ok: false, erro: MSG_USO_FALHOU };
  }
}

/**
 * Remove originais da loja (e as cópias). A RPC prova posse, ignora o que não
 * é original não pendente da loja (D8), recalcula o uso, limpa produtos e logo
 * e marca a família como pendente. Depois do commit, passos 9–12: prefixo
 * `${lojaId}/` → Storage → DELETE escopado por `loja_id`, e a varredura de
 * recortes sem uso (RN-G21). Os números devolvidos são os do servidor.
 */
export async function executarRemocaoDaGaleria(
  client: Client,
  lojaId: string,
  ids: string[],
  rotulo: string,
): Promise<ResultadoRemocao> {
  try {
    const { data, error } = await client.rpc("remover_imagens_loja", { p_loja_id: lojaId, p_ids: ids });
    const resposta = error ? null : lerRespostaRpcRemocao(data);
    if (!resposta) {
      console.error(`[${rotulo}] falha na RPC`, error ?? data);
      return { ok: false, erro: MSG_REMOCAO_FALHOU };
    }

    // Nunca rejeitam: falha fica pendente e é retentada na próxima ação da loja.
    await apagarImagensPendentes(client, lojaId, resposta.caminhos, rotulo);
    await processarRemocoesPendentes(client, lojaId);

    return {
      ok: true,
      removidas: resposta.removidas,
      ignoradas: resposta.ignoradas,
      produtosLimpos: resposta.produtosLimpos,
      logoLimpa: resposta.logoLimpa,
    };
  } catch (e) {
    console.error(`[${rotulo}]`, e);
    return { ok: false, erro: MSG_REMOCAO_FALHOU };
  }
}
