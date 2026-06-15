// Validação de imagem — funções PURAS (sem I/O, determinísticas).
// Reusadas no client (UX) e na Server Action (autoridade), evitando drift.
//   - validarImagem: valida o METADADO DECLARADO (tipo + tamanho).
//   - validarMagicBytes: 2ª linha — inspeciona o CONTEÚDO real, não confia
//     no Content-Type declarado pelo client (seguranca.md §13).

export type MetaImagem = {
  tipo: string;
  tamanho: number;
};

export type ResultadoValidacao = {
  valido: boolean;
  erro?: string;
};

export const TIPOS_IMAGEM_PERMITIDOS: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const TAMANHO_MAXIMO_BYTES = 2 * 1024 * 1024;

export function validarImagem(meta: MetaImagem): ResultadoValidacao {
  if (!TIPOS_IMAGEM_PERMITIDOS.includes(meta.tipo)) {
    return {
      valido: false,
      erro: "Tipo de imagem não permitido. Use JPEG, PNG ou WEBP.",
    };
  }

  if (meta.tamanho <= 0) {
    return { valido: false, erro: "Arquivo vazio ou inválido." };
  }

  if (meta.tamanho > TAMANHO_MAXIMO_BYTES) {
    return { valido: false, erro: "Imagem acima do limite de 2 MB." };
  }

  return { valido: true };
}

/**
 * Marcas de assinatura: cada item é uma lista de marcas que precisam TODAS
 * bater (AND) — necessário para containers como o RIFF/WEBP, cuja identidade
 * exige duas marcas em offsets distintos (os bytes 4-7 são o tamanho, variáveis).
 */
const ASSINATURAS: readonly { marcas: readonly { bytes: readonly number[]; offset: number }[] }[] = [
  // JPEG
  { marcas: [{ bytes: [0xff, 0xd8, 0xff], offset: 0 }] },
  // PNG
  { marcas: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 }] },
  // WEBP (container RIFF): "RIFF" no offset 0 E "WEBP" no offset 8.
  // Exigir AMBAS evita que .wav/.avi (também RIFF) passem como webp.
  {
    marcas: [
      { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // "RIFF"
      { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // "WEBP"
    ],
  },
];

/** Verdadeiro se `bytes` aparecem exatamente em `offset`; false se o buffer é curto demais. */
function bateEm(
  buffer: Uint8Array,
  bytes: readonly number[],
  offset = 0,
): boolean {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

export function validarMagicBytes(
  buffer: Uint8Array,
  _tipoDeclarado?: string,
): ResultadoValidacao {
  // O conteúdo real manda: ignora o tipo declarado pelo client.
  // Uma assinatura só casa se TODAS as suas marcas baterem (AND).
  const bate = ASSINATURAS.some((a) =>
    a.marcas.every((m) => bateEm(buffer, m.bytes, m.offset)),
  );
  if (!bate) {
    return {
      valido: false,
      erro: "Conteúdo do arquivo não corresponde a uma imagem válida.",
    };
  }
  return { valido: true };
}
