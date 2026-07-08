"use server";

// Upload de foto de produto pelo ADMIN SaaS no onboarding assistido (issue 090).
// Difere de `enviarFotoProduto` do LOJISTA (lib/actions/upload.ts): aqui não há
// auth do dono da loja — quem sobe é o admin, sob service_role. Por isso o bucket
// `produtos` é gravado IGNORANDO a RLS, e o ÚNICO isolamento entre lojas é o path
// montado SERVER-SIDE a partir do `lojaId` validado (spec admin-onboarding-assistido
// §13/§7). Invariantes:
//   - `loja_id` vem do FormData mas é VALIDADO como UUID antes de qualquer escrita;
//     não-UUID/ausente → rejeitado, ZERO upload, sem nem elevar a service_role;
//   - prova de admin (`verificarAdminSaaS`, via `prepararContextoAdmin`) ANTES da
//     validação de imagem (CPU/memória, anti-DoS) E ANTES de `createServiceClient`
//     — se a prova lança, a exceção PROPAGA (fail-closed): nem o buffer da imagem é
//     processado nem o service client é criado;
//   - dupla validação de imagem (metadado + magic bytes) DEPOIS da prova de admin;
//   - path = `${lojaId}/${uuid}.${ext}` — 1º segmento é o lojaId, sem prefixo
//     `produtos/`, nome é UUID (nunca file.name) → sem traversal/colisão;
//   - erro de Storage → genérico, sem vazar e.message.

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { validarBlobImagem } from "@/lib/actions/upload-imagem";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import type { ResultadoUpload } from "@/lib/actions/upload-contrato";

const BUCKET = "produtos";

/**
 * Sobe a foto de um produto pelo admin (onboarding assistido) e devolve a URL
 * pública. Recebe `loja_id` (UUID) e o arquivo (`CAMPO_ARQUIVO`) via FormData.
 * O `loja_id` é validado server-side e vira o 1º segmento do path no Storage —
 * sob service_role essa é a única amarra de isolamento entre lojas.
 */
export async function enviarFotoProdutoAdmin(
  formData: FormData,
): Promise<ResultadoUpload> {
  // 1. loja_id do FormData → validação UUID server-side. Não-UUID/ausente →
  //    rejeitado ANTES de qualquer upload e antes de elevar a service_role.
  const validacaoLoja = validarLojaIdAdmin(formData.get("loja_id"));
  if (!validacaoLoja.ok) {
    return { ok: false, erro: "Loja inválida." };
  }
  const { lojaId } = validacaoLoja;

  // 2. arquivo presente? Só checa que é Blob não-vazio AQUI; a validação de
  //    conteúdo (CPU/memória) fica DEPOIS da prova de admin (anti-DoS).
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: "Imagem inválida." };
  }

  // 3. prova de admin ANTES do trabalho de CPU/memória da validação de imagem
  //    (anti-DoS) e ANTES de elevar a service_role. Se lança, PROPAGA
  //    (fail-closed): nunca capturada, e o service client nunca é criado.
  const { svc } = await prepararContextoAdmin(lojaId);

  // 4. dupla validação da imagem (metadado + conteúdo real). File herda de Blob.
  const validacao = await validarBlobImagem(value);
  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro };
  }
  const { buffer, tipoReal, ext } = validacao;

  // 5. path SERVER-SIDE: `${lojaId}/${uuid}.${ext}`. 1º segmento === lojaId, sem
  //    prefixo `produtos/`, nome UUID (nunca file.name).
  const path = `${lojaId}/${crypto.randomUUID()}.${ext}`;

  // 6. upload sob service_role (ignora a RLS do bucket; o escopo é o path).
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: tipoReal });

  if (error) {
    console.error("[enviarFotoProdutoAdmin] falha no upload:", error);
    return { ok: false, erro: "Não foi possível enviar a imagem." };
  }

  registrarAcessoAdmin(svc, {
    lojaId,
    acao: "upload_foto_produto",
    // path (storage) NÃO é uuid → coluna entidade_id é uuid: vai em metadados (jsonb).
    metadados: { path },
  });
  revalidarLojaAdmin(lojaId);

  // 7. URL pública.
  const { data } = svc.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, foto_url: data.publicUrl };
}
