// Remoções pendentes da galeria (specs/galeria-imagens-loja.md, RN-G10, RN-G20,
// RN-G21, passos 9–12 da remoção). Módulo NEUTRO — sem `'use server'`, para não
// virar Server Action exposta. Usado pelo lojista (client autenticado) e pelo
// admin (service client, já escopado por `lojaId` validado).
//
// Sequência sempre banco → Storage → DELETE da linha. Best-effort: nada aqui
// rejeita; falha vai para o log e é retentada na próxima ação da loja.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { BUCKET_IMAGENS, particionarCaminhos } from "./galeria-contrato";

type Client = SupabaseClient<Database>;

/**
 * Apaga do Storage os caminhos (já marcados como pendentes pelo banco) e, só se
 * o Storage confirmou, apaga as linhas pendentes desses caminhos. Caminho fora
 * da pasta `${lojaId}/` é bug: loga e descarta (passo 9). Nunca rejeita.
 */
export async function apagarImagensPendentes(
  client: Client,
  lojaId: string,
  caminhos: unknown,
  rotulo: string,
): Promise<void> {
  try {
    const lista = Array.isArray(caminhos) ? caminhos : [];
    const { daLoja, alheios } = particionarCaminhos(lista, lojaId);
    if (alheios.length > 0) {
      console.error(`[${rotulo}] caminhos fora da loja descartados`, { lojaId, alheios });
    }
    if (daLoja.length === 0) return;

    const { error: erroStorage } = await client.storage.from(BUCKET_IMAGENS).remove(daLoja);
    if (erroStorage) {
      // Linhas ficam pendentes; a próxima ação da loja retenta (remove é idempotente).
      console.error(`[${rotulo}] falha ao apagar do Storage`, erroStorage);
      return;
    }

    // Cópias caem pela FK em cascata; miniatura não casa `caminho` e some com a original.
    const { error: erroDelete } = await client
      .from("imagens_loja")
      .delete()
      .eq("loja_id", lojaId)
      .not("remocao_pendente_em", "is", null)
      .in("caminho", daLoja);
    if (erroDelete) {
      console.error(`[${rotulo}] falha ao apagar linhas pendentes`, erroDelete);
    }
  } catch (e) {
    console.error(`[${rotulo}] erro inesperado`, e);
  }
}

/**
 * Varredura de garantia (`limpar_recortes_sem_uso`) + Storage + DELETE das
 * pendentes da loja (as que o trigger AFTER marcou no save e as que sobraram de
 * falha anterior). Nunca rejeita.
 */
export async function processarRemocoesPendentes(client: Client, lojaId: string): Promise<void> {
  try {
    const { data, error } = await client.rpc("limpar_recortes_sem_uso", { p_loja_id: lojaId });
    if (error) {
      console.error("[processarRemocoesPendentes] falha na varredura", error);
      return;
    }
    await apagarImagensPendentes(client, lojaId, data, "processarRemocoesPendentes");
  } catch (e) {
    console.error("[processarRemocoesPendentes] erro inesperado", e);
  }
}
