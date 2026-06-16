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

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { validarBlobImagem } from "./upload-imagem";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import type { ResultadoUpload } from "./upload-contrato";

const BUCKET = "produtos";

/**
 * Sobe a foto de um produto (já cropada/reduzida no client) para o Storage e
 * devolve a URL pública. Recebe o arquivo via `FormData` no campo
 * `CAMPO_ARQUIVO`. Qualquer `loja_id` que venha no FormData é IGNORADO — a pasta
 * vem sempre da loja do dono autenticado, nunca do payload do client.
 */
export async function enviarFotoProduto(
  formData: FormData,
): Promise<ResultadoUpload> {
  // Extrai e valida o arquivo presente. File herda de Blob: aceitar `instanceof
  // Blob` cobre tanto o Blob do cropper quanto o File de <input type=file>.
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: "Imagem inválida." };
  }
  const file = value;

  const supabase = await createClient();

  // loja DERIVADA do auth (RLS) — payload do client é ignorado.
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: "Não autorizado." };
  }

  // Dupla validação server-side (metadado + conteúdo real) + extensão do tipo
  // REAL. Helper puro compartilhado com salvarLogoLoja (sem I/O).
  const validacao = await validarBlobImagem(file);
  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro };
  }
  const { buffer, tipoReal, ext } = validacao;

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
    console.error("[enviarFotoProduto] falha no upload:", error);
    return { ok: false, erro: "Não foi possível enviar a imagem." };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, foto_url: data.publicUrl };
}
