"use server";

// Upload de foto de produto do LOJISTA (issue 018). Contrato espelha as demais
// actions (seguranca.md §13/§14):
//   - usa o client AUTENTICADO (RLS do bucket `produtos`), NUNCA service_role —
//     a escrita no Storage passa pela policy escopada por auth.uid();
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload do
//     client — um loja_id alheio no payload é IGNORADO;
//   - dupla validação de imagem: metadado declarado (validarImagem) E conteúdo
//     real (validarMagicBytes) — Content-Type mentido não passa;
//   - nome de saída é um UUID, NUNCA o file.name original (path traversal/colisão);
//   - erro de Storage → genérico, sem vazar e.message.

import {
  validarImagem,
  validarMagicBytes,
} from "@/lib/utils/validarImagem";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";

export type ResultadoUpload =
  | { ok: true; foto_url: string }
  | { ok: false; erro: string };

const BUCKET = "produtos";

// MIME real validado → extensão. Só os tipos reconhecidos por validarMagicBytes.
const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Mapeia a assinatura de conteúdo real → MIME canônico (a fonte da verdade é o
// CONTEÚDO, não o Content-Type declarado pelo client).
function tipoRealPorConteudo(buffer: Uint8Array): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Sobe a foto de um produto para o Storage e devolve a URL pública.
 * `_extra` (ex.: loja_id) é ACEITO mas IGNORADO — a pasta vem sempre da loja do
 * dono autenticado, nunca do payload do client.
 */
export async function uploadFotoProduto(
  produtoId: string,
  file: File,
  _extra?: { loja_id?: string },
): Promise<ResultadoUpload> {
  const supabase = await createClient();

  // loja DERIVADA do auth (RLS) — payload do client é ignorado.
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: "Não autorizado." };
  }

  // 1ª linha: metadado declarado (tipo + tamanho).
  const meta = validarImagem({ tipo: file.type, tamanho: file.size });
  if (!meta.valido) {
    return { ok: false, erro: "Imagem inválida." };
  }

  // 2ª linha: conteúdo real do arquivo (ignora o Content-Type declarado).
  const buffer = new Uint8Array(await file.arrayBuffer());
  const magic = validarMagicBytes(buffer);
  if (!magic.valido) {
    return {
      ok: false,
      erro: "Conteúdo do arquivo não é uma imagem válida.",
    };
  }

  // Extensão derivada do tipo REAL validado, nunca do file.name.
  const tipoReal = tipoRealPorConteudo(buffer);
  const ext = tipoReal ? EXTENSAO_POR_TIPO[tipoReal] : undefined;
  if (!tipoReal || !ext) {
    return {
      ok: false,
      erro: "Conteúdo do arquivo não é uma imagem válida.",
    };
  }

  // Nome de saída: UUID. file.name NUNCA entra no path (path traversal/colisão).
  // O objeto é nomeado RELATIVO ao bucket — NÃO prefixar com `${BUCKET}/`, senão
  // o 1º segmento vira "produtos" em vez de loja.id e a policy RLS
  // `produtos_insert_propria` (foldername(name)[1] IN lojas do dono) recusa TODO
  // upload. Path correto: `{loja_id}/{uuid}.{ext}`.
  const path = `${loja.id}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: tipoReal });

  if (error) {
    console.error("[uploadFotoProduto] falha no upload:", error);
    return { ok: false, erro: "Não foi possível enviar a imagem." };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, foto_url: data.publicUrl };
}
