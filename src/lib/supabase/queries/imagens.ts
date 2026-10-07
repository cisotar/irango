import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import {
  BUCKET_IMAGENS,
  POR_PAGINA_GALERIA,
  type CursorGaleria,
  type ImagemGaleria,
  type PaginaGaleria,
  type UsoImagem,
} from "@/lib/actions/galeria-contrato";

// Queries da galeria de imagens (specs/galeria-imagens-loja.md, RN-G2, RN-G12).
// TODA query filtra `.eq("loja_id", lojaId)`: na variante admin (service_role,
// BYPASSRLS) é a única amarra de tenant; na do lojista, cinto sobre a RLS.

type Client = SupabaseClient<Database>;

const COLUNAS_GRADE = "id, caminho, miniatura_caminho, criado_em";

function consultaGrade(client: Client) {
  return client.from("imagens_loja").select(COLUNAS_GRADE);
}
type ConsultaGrade = ReturnType<typeof consultaGrade>;

/**
 * Só originais sem remoção pendente, keyset `(criado_em desc, id desc)`. Busca
 * uma linha a mais para saber se há próxima página. O cursor só posiciona.
 */
async function paginar(
  client: Client,
  consulta: ConsultaGrade,
  cursor?: CursorGaleria,
): Promise<PaginaGaleria> {
  let q = consulta.is("origem_id", null).is("remocao_pendente_em", null);
  if (cursor) {
    // Valores entre aspas: o timestamptz traz `:`/`+`, reservados no filtro `or`.
    q = q.or(
      `criado_em.lt."${cursor.criado_em}",and(criado_em.eq."${cursor.criado_em}",id.lt."${cursor.id}")`,
    );
  }
  const { data, error } = await q
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false })
    .limit(POR_PAGINA_GALERIA + 1);
  if (error) throw error;

  const linhas = data ?? [];
  const pagina = linhas.slice(0, POR_PAGINA_GALERIA);
  const urlDe = (caminho: string) =>
    client.storage.from(BUCKET_IMAGENS).getPublicUrl(caminho).data.publicUrl;
  const imagens: ImagemGaleria[] = pagina.map((l) => ({
    id: l.id,
    url: urlDe(l.caminho),
    miniatura_url: l.miniatura_caminho ? urlDe(l.miniatura_caminho) : null,
    criado_em: l.criado_em,
  }));
  const ultima = pagina.at(-1);
  return {
    imagens,
    proximo_cursor:
      linhas.length > POR_PAGINA_GALERIA && ultima
        ? { criado_em: ultima.criado_em, id: ultima.id }
        : null,
  };
}

/** Painel: grade da loja do lojista (client autenticado, RLS). */
export async function listarImagensDaLoja(
  client: Client,
  lojaId: string,
  cursor?: CursorGaleria,
): Promise<PaginaGaleria> {
  return paginar(client, consultaGrade(client).eq("loja_id", lojaId), cursor);
}

/** Admin: grade da loja-alvo via service_role — o `.eq` é a única barreira. */
export async function listarImagensDaLojaAdmin(
  svc: Client,
  lojaId: string,
  cursor?: CursorGaleria,
): Promise<PaginaGaleria> {
  return paginar(svc, consultaGrade(svc).eq("loja_id", lojaId), cursor);
}

/** Origem de um recorte (RN-G3): original não pendente da loja, ou null. */
export async function buscarOriginalDaLoja(
  client: Client,
  lojaId: string,
  id: string,
): Promise<Pick<Tables<"imagens_loja">, "id" | "loja_id" | "caminho"> | null> {
  const { data, error } = await client
    .from("imagens_loja")
    .select("id, loja_id, caminho")
    .eq("loja_id", lojaId)
    .eq("id", id)
    .is("origem_id", null)
    .is("remocao_pendente_em", null)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Base do teto (RN-G12): originais não pendentes da loja. Erro ou contagem
 * ausente PROPAGA — contar 0 numa falha furaria o teto.
 */
export async function contarOriginaisDaLoja(client: Client, lojaId: string): Promise<number> {
  const { count, error } = await client
    .from("imagens_loja")
    .select("id", { count: "exact", head: true })
    .eq("loja_id", lojaId)
    .is("origem_id", null)
    .is("remocao_pendente_em", null);
  if (error) throw error;
  if (count == null) throw new Error("contarOriginaisDaLoja: contagem ausente");
  return count;
}

/**
 * Selo "Em uso" da primeira página (Server Component das páginas 1 e 2). É
 * PRÉVIA: a conta que vale é a da RPC de remoção. A RPC filtra
 * `loja_id = p_loja_id` e prova posse (dono pela RLS, ou service_role); sem
 * ids não há chamada (a RPC recusa lote vazio). Erro PROPAGA — quem chama
 * decide se a página segue sem selo.
 */
export async function buscarUsoDasImagens(
  client: Client,
  lojaId: string,
  ids: readonly string[],
): Promise<UsoImagem[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.rpc("uso_imagens_loja", {
    p_loja_id: lojaId,
    p_ids: [...ids],
  });
  if (error) throw error;
  return data ?? [];
}
