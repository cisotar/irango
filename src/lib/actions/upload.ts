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
//   - erro de Storage → genérico, sem vazar e.message;
//   - [galeria] exige `origem_id` (original não pendente da loja) e registra a
//     linha-cópia em `imagens_loja`; INSERT falhou → apaga o objeto subido.

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { verificarRateLimit } from "@/lib/utils/rateLimit";
import { schemaOrigemId } from "@/lib/validacoes/galeria";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import type { ResultadoUpload } from "./upload-contrato";
import { CAMPO_ORIGEM, MSG_IMAGEM_INVALIDA, MSG_MUITAS_TENTATIVAS } from "./galeria-contrato";
import { subirRecorteDaGaleria } from "./galeria-upload";

/**
 * Sobe o RECORTE da foto de um produto (já cropado/reduzido no client) e devolve
 * a URL pública. Recebe o arquivo em `CAMPO_ARQUIVO` e, desde a galeria, o
 * `origem_id` OBRIGATÓRIO (original da própria loja, D2/RN-G3). Qualquer
 * `loja_id` no FormData é IGNORADO — a pasta vem sempre da loja do dono.
 */
export async function enviarFotoProduto(
  formData: FormData,
): Promise<ResultadoUpload> {
  // File herda de Blob: cobre o Blob do cropper e o File de <input type=file>.
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }
  const origem = schemaOrigemId.safeParse(formData.get(CAMPO_ORIGEM));
  if (!origem.success) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }

  const supabase = await createClient();

  // loja DERIVADA do auth (RLS) — payload do client é ignorado.
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: "Não autorizado." };
  }

  // Rate limit por loja da sessão (RN-G13, fail-open — contenção de custo).
  const rl = await verificarRateLimit("recorteImagem", loja.id);
  if (!rl.permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  // Validação do blob, posse da origem, caminho `{loja_id}/{uuid}.{ext}` relativo
  // ao bucket (sem prefixo `produtos/`, exigência de `produtos_insert_propria`) e
  // linha-cópia sob RLS. Erro → genérico; detalhe só no log.
  const r = await subirRecorteDaGaleria({
    client: supabase,
    lojaId: loja.id,
    origemId: origem.data,
    destino: "produto",
    arquivo: value,
    exigirUrlDoStorage: false,
    inserir: (linha) => supabase.from("imagens_loja").insert({ ...linha, loja_id: loja.id }),
    erroGenerico: "Não foi possível enviar a imagem.",
    rotulo: "enviarFotoProduto",
  });
  if (!r.ok) return r;
  return { ok: true, foto_url: r.url };
}
