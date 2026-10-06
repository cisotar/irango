/**
 * Redução de imagem no navegador para a galeria (specs/galeria-imagens-loja.md,
 * P4, P9/D7, RN-G5).
 *
 * A original sobe com o lado maior ≤ 2048 px e a miniatura com o lado maior
 * 400 px, as duas em webp. O canvas NÃO é reimplementado aqui: as duas saem de
 * `exportarCrop` com a área inteira da imagem como "recorte". O único código
 * novo é o cálculo das dimensões (`calcularDimensoesReducao`), puro e testado.
 *
 * NÃO é autoridade: o servidor revalida tipo, tamanho e magic bytes de cada
 * arquivo (`validarBlobImagem`). Isto é UX e custo de banda.
 */

import {
  LADO_MAXIMO_ORIGINAL,
  LADO_MINIATURA,
} from "@/lib/actions/galeria-contrato";
import { exportarCrop } from "@/lib/utils/exportarCrop";
import { validarImagem } from "@/lib/utils/validarImagem";

/**
 * RN-G5: original + miniatura cabem em 1,9 MB por chamada. O `bodySizeLimit`
 * das Server Actions é 2 MB e o resto fica para o envelope do multipart.
 */
export const LIMITE_PAR_ENVIO_BYTES = Math.floor(1.9 * 1024 * 1024);

export const MSG_PAR_GRANDE_DEMAIS =
  "Esta imagem continua acima de 1,9 MB depois de reduzida. Escolha uma versão menor.";
export const MSG_PROCESSAMENTO_FALHOU =
  "Não foi possível processar a imagem. Tente outro arquivo.";

/**
 * Dimensões de saída para que o lado maior não passe de `ladoMaximo`.
 *
 * - Nunca amplia: imagem já dentro do limite volta com as próprias dimensões.
 * - Preserva a proporção (o lado maior vira exatamente `ladoMaximo`).
 * - Sempre inteiros ≥ 1 (uma faixa de 4000×1 não vira altura 0).
 *
 * @throws RangeError se alguma entrada não for um número finito > 0.
 */
export function calcularDimensoesReducao(
  largura: number,
  altura: number,
  ladoMaximo: number,
): { largura: number; altura: number } {
  for (const v of [largura, altura, ladoMaximo]) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError("Dimensões inválidas.");
    }
  }
  const maior = Math.max(largura, altura);
  if (maior <= ladoMaximo) {
    return {
      largura: Math.max(1, Math.round(largura)),
      altura: Math.max(1, Math.round(altura)),
    };
  }
  const escala = ladoMaximo / maior;
  return {
    largura: Math.max(1, Math.round(largura * escala)),
    altura: Math.max(1, Math.round(altura * escala)),
  };
}

/** Isola o I/O de DOM: dimensões naturais da imagem (já orientada pelo EXIF). */
function lerDimensoes(src: string): Promise<{ largura: number; altura: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ largura: img.naturalWidth, altura: img.naturalHeight });
    img.onerror = () => reject(new Error("Não foi possível carregar a imagem."));
    img.src = src;
  });
}

/** Uma saída de `exportarCrop` com a imagem inteira, no lado máximo pedido. */
async function reduzir(
  src: string,
  largura: number,
  altura: number,
  ladoMaximo: number,
): Promise<Blob> {
  const alvo = calcularDimensoesReducao(largura, altura, ladoMaximo);
  return exportarCrop({
    imageSrc: src,
    croppedAreaPixels: { x: 0, y: 0, width: largura, height: altura },
    larguraAlvo: alvo.largura,
    // A razão das dimensões-ALVO (não `largura/altura` da fonte): assim a
    // altura que `exportarCrop` deriva por arredondamento é a mesma calculada.
    aspect: alvo.largura / alvo.altura,
  });
}

export type ResultadoPreparoGaleria =
  | { ok: true; original: Blob; miniatura: Blob }
  | { ok: false; erro: string };

/**
 * Prepara o par que a galeria envia: original reduzida (lado maior ≤ 2048 px)
 * e miniatura (lado maior 400 px), ambas webp. Browser-only.
 *
 * Recusa no cliente quando um dos arquivos passa de 2 MB ou o par passa de
 * 1,9 MB (RN-G5), com mensagem que diz o que fazer. Nunca lança.
 */
export async function prepararImagemParaGaleria(
  arquivo: Blob,
): Promise<ResultadoPreparoGaleria> {
  const src = URL.createObjectURL(arquivo);
  try {
    const { largura, altura } = await lerDimensoes(src);
    const original = await reduzir(src, largura, altura, LADO_MAXIMO_ORIGINAL);
    const miniatura = await reduzir(src, largura, altura, LADO_MINIATURA);

    // O par primeiro: quem escolheu uma foto de 6 MB precisa ler que a versão
    // REDUZIDA ainda é grande, não o "acima de 2 MB" genérico do arquivo.
    if (original.size + miniatura.size > LIMITE_PAR_ENVIO_BYTES) {
      return { ok: false, erro: MSG_PAR_GRANDE_DEMAIS };
    }
    // Navegador sem encoder webp devolve outro tipo no `toBlob`: o mesmo gate
    // de tipo que o servidor aplica, antes de gastar a chamada.
    for (const blob of [original, miniatura]) {
      const v = validarImagem({ tipo: blob.type, tamanho: blob.size });
      if (!v.valido) return { ok: false, erro: v.erro ?? MSG_PROCESSAMENTO_FALHOU };
    }
    return { ok: true, original, miniatura };
  } catch {
    return { ok: false, erro: MSG_PROCESSAMENTO_FALHOU };
  } finally {
    URL.revokeObjectURL(src);
  }
}
