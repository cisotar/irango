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
//   - erro de Storage → genérico, sem vazar e.message;
//   - [galeria] `origem_id` obrigatório, validado na LOJA-ALVO; linha-cópia por
//     `escopo.inserir`; INSERT falhou → apaga o objeto subido.

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import type { ResultadoUpload } from "@/lib/actions/upload-contrato";
import {
  CAMPO_ORIGEM,
  MSG_ENVIO_FALHOU,
  MSG_IMAGEM_INVALIDA,
  MSG_LOJA_INVALIDA,
} from "@/lib/actions/galeria-contrato";
import { subirRecorteDaGaleria } from "@/lib/actions/galeria-upload";
import { schemaOrigemId } from "@/lib/validacoes/galeria";

/**
 * Sobe o RECORTE da foto de um produto pelo admin e devolve a URL pública.
 * Recebe `loja_id` (UUID), o arquivo (`CAMPO_ARQUIVO`) e o `origem_id`
 * OBRIGATÓRIO via FormData. O `loja_id` validado vira o 1º segmento do path e o
 * escopo da origem e da linha-cópia — sob service_role é a única amarra.
 */
export async function enviarFotoProdutoAdmin(
  formData: FormData,
): Promise<ResultadoUpload> {
  // 1. loja_id do FormData → validação UUID ANTES de qualquer efeito e antes de
  //    elevar a service_role.
  const validacaoLoja = validarLojaIdAdmin(formData.get("loja_id"));
  if (!validacaoLoja.ok) {
    return { ok: false, erro: MSG_LOJA_INVALIDA };
  }
  const { lojaId } = validacaoLoja;

  // 2. arquivo presente e origem com forma de uuid. O CONTEÚDO (CPU/memória)
  //    só é validado DEPOIS da prova de admin (anti-DoS).
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }
  const origem = schemaOrigemId.safeParse(formData.get(CAMPO_ORIGEM));
  if (!origem.success) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }

  // 3. prova de admin FORA do try, antes de elevar. Se lança, PROPAGA.
  const { svc, escopo } = await prepararContextoAdmin(lojaId);

  // 4. blob + origem da LOJA-ALVO + upload em `${lojaId}/${uuid}.${ext}` +
  //    linha-cópia por `escopo.inserir` (loja_id injetado pelo wrapper).
  const r = await subirRecorteDaGaleria({
    client: svc,
    lojaId,
    origemId: origem.data,
    destino: "produto",
    arquivo: value,
    exigirUrlDoStorage: false,
    inserir: (linha) => escopo.inserir("imagens_loja", linha),
    erroGenerico: MSG_ENVIO_FALHOU,
    rotulo: "enviarFotoProdutoAdmin",
  });
  if (!r.ok) return r;

  registrarAcessoAdmin(svc, {
    lojaId,
    acao: "upload_foto_produto",
    // path (storage) NÃO é uuid → coluna entidade_id é uuid: vai em metadados (jsonb).
    metadados: { path: r.caminho },
  });
  revalidarLojaAdmin(lojaId);

  return { ok: true, foto_url: r.url };
}
