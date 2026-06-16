/**
 * exportarCrop — util de browser (canvas) que recupera a região cropada de uma
 * imagem-fonte e a exporta como Blob webp no tamanho-alvo parametrizável.
 * Default: 4:3 (~1280×960) para a foto de produto; aceita `aspect`/`larguraAlvo`
 * para outros consumidores (ex. logo 1:1 320×320).
 *
 * Browser-only: usa `Image` e `<canvas>` — não roda em ambiente node (o harness
 * de teste é `environment: "node"`, sem DOM/canvas). Por isso, só a parte PURA
 * (`calcularDimensoesAlvo`) é coberta por teste; o caminho de canvas é validado
 * manualmente no navegador via o componente de upload (issue 076).
 *
 * NÃO é autoridade de segurança: o tipo/tamanho/magic bytes reais são revalidados
 * pela Server Action `enviarFotoProduto` (issue 075). Este util é puro UX/otimização.
 *
 * Revogação de objectURL: a assinatura recebe `imageSrc: string`. O objectURL é
 * criado e gerido pelo CHAMADOR (componente 076), que também é responsável por
 * revogá-lo (`URL.revokeObjectURL`). Este util NÃO revoga o que não criou.
 */

import type { Area } from "react-easy-crop";

export const LARGURA_ALVO_PADRAO = 1280;
export const ASPECT_FOTO = 4 / 3; // = aspect do card da vitrine (object-cover 4:3)
export const QUALIDADE_WEBP = 0.82; // equilíbrio peso/qualidade; ~150-300KB p/ 1280×960
export const TIPO_SAIDA = "image/webp" as const;

export type ExportarCropParams = {
  imageSrc: string; // objectURL ou URL da imagem-fonte (criado/gerido pelo chamador)
  croppedAreaPixels: Area; // { x, y, width, height } em pixels da imagem-fonte (react-easy-crop)
  larguraAlvo?: number; // default LARGURA_ALVO_PADRAO (1280); altura derivada por aspect
  aspect?: number; // default ASPECT_FOTO (4/3); 1 = quadrado (logo)
};

/**
 * Pura e testável: deriva as dimensões-alvo a partir da largura e do aspect.
 * altura = round(largura / aspect). Defaults preservam o contrato 4:3:
 * calcularDimensoesAlvo() ⇒ { largura: 1280, altura: 960 }.
 */
export function calcularDimensoesAlvo(
  larguraAlvo = LARGURA_ALVO_PADRAO,
  aspect = ASPECT_FOTO,
): { largura: number; altura: number } {
  const largura = Math.round(larguraAlvo);
  const altura = Math.round(largura / aspect);
  return { largura, altura };
}

/** Isola o I/O de DOM: carrega a imagem-fonte resolvendo num HTMLImageElement. */
function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Não foi possível carregar a imagem."));
    img.src = src;
  });
}

/**
 * Exporta a região cropada como Blob webp no tamanho-alvo (default ~1280×960, 4:3).
 * Browser-only.
 *
 * @throws Error("Não foi possível carregar a imagem.") se a fonte falhar (src inválido/CORS).
 * @throws Error("Recorte inválido.") se `croppedAreaPixels` for degenerado (width/height ≤ 0).
 * @throws Error("Não foi possível processar a imagem.") se o canvas/`toBlob` falhar.
 */
export async function exportarCrop({
  imageSrc,
  croppedAreaPixels,
  larguraAlvo = LARGURA_ALVO_PADRAO,
  aspect = ASPECT_FOTO,
}: ExportarCropParams): Promise<Blob> {
  const { x, y, width, height } = croppedAreaPixels;
  if (width <= 0 || height <= 0) {
    throw new Error("Recorte inválido.");
  }

  const img = await carregarImagem(imageSrc);

  const { largura, altura } = calcularDimensoesAlvo(larguraAlvo, aspect);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Não foi possível processar a imagem.");
  }

  ctx.drawImage(img, x, y, width, height, 0, 0, largura, altura);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Não foi possível processar a imagem."));
          return;
        }
        resolve(blob);
      },
      TIPO_SAIDA,
      QUALIDADE_WEBP,
    );
  });
}
