// Helper PURO de validação de imagem para upload (issue 003). Módulo NEUTRO (sem
// `'use server'`) compartilhado pelas actions `enviarFotoProduto` (upload.ts) e
// `salvarLogoLoja` (logo.ts) — elimina a duplicação da sequência de magic bytes
// e do mapa extensão→tipo. NÃO faz I/O: o upload em si (path/bucket/contentType)
// é responsabilidade de cada action; este helper só prova que o Blob recebido é
// uma imagem real e devolve o buffer + tipo canônico + extensão derivada do
// CONTEÚDO (não do Content-Type declarado pelo client — seguranca.md §13).

import { validarImagem, validarMagicBytes } from "@/lib/utils/validarImagem";

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

export type ResultadoValidacaoBlob =
  | { ok: false; erro: string }
  | { ok: true; buffer: Uint8Array; tipoReal: string; ext: string };

/**
 * Valida um Blob de imagem em duas linhas de defesa, ambas no servidor:
 *   1. metadado declarado (tipo + tamanho) via `validarImagem`;
 *   2. conteúdo real (magic bytes) via `validarMagicBytes`, ignorando o
 *      Content-Type declarado pelo client.
 * Em sucesso, devolve o buffer lido, o MIME canônico do conteúdo e a extensão
 * derivada DESSE tipo real — nunca do `file.name`. Cada action monta seu próprio
 * path e faz o upload; este helper não toca o Storage.
 */
export async function validarBlobImagem(
  file: Blob,
): Promise<ResultadoValidacaoBlob> {
  // 1ª linha: metadado declarado (tipo + tamanho).
  const meta = validarImagem({ tipo: file.type, tamanho: file.size });
  if (!meta.valido) {
    return { ok: false, erro: "Imagem inválida." };
  }

  // 2ª linha: conteúdo real do arquivo (ignora o Content-Type declarado).
  const buffer = new Uint8Array(await file.arrayBuffer());
  const magic = validarMagicBytes(buffer);
  if (!magic.valido) {
    return { ok: false, erro: "Conteúdo do arquivo não é uma imagem válida." };
  }

  // Extensão derivada do tipo REAL validado, nunca do file.name.
  const tipoReal = tipoRealPorConteudo(buffer);
  const ext = tipoReal ? EXTENSAO_POR_TIPO[tipoReal] : undefined;
  if (!tipoReal || !ext) {
    return { ok: false, erro: "Conteúdo do arquivo não é uma imagem válida." };
  }

  return { ok: true, buffer, tipoReal, ext };
}
