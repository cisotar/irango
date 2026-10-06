"use client";

/**
 * Upload da foto do produto (issue 076; galeria: specs/galeria-imagens-loja.md,
 * página 3). Wrapper fino da casca `UploadImagemRecortada`: recorte 4:3
 * (~1280×960 webp), aviso D10 abaixo de 800 px, copy de foto. A remoção é só
 * local (o produto muda quando o lojista salva o form).
 */

import type { ReactElement } from "react";

import { UploadImagemRecortada, type TextosUploadImagem } from "@/components/painel/UploadImagemRecortada";
import type { EnviarParaGaleria, ListarGaleria } from "@/components/painel/fluxoRecorte";
import { ASPECT_FOTO, LARGURA_ALVO_PADRAO } from "@/lib/utils/exportarCrop";
import { LARGURA_MINIMA_RECOMENDADA_PRODUTO } from "@/lib/actions/galeria-contrato";
import type { enviarFotoProduto } from "@/lib/actions/upload";

/**
 * Assinatura da Server Action de upload do RECORTE da foto: `enviarFotoProduto`
 * (lojista, loja derivada do auth) ou a variante admin, que escopa o path do
 * bucket por `lojaId` validado server-side. Recebe o arquivo e o `origem_id`.
 */
export type EnviarFotoProduto = typeof enviarFotoProduto;

export type UploadFotoProdutoProps = {
  /** URL atual já salva (preview inicial). */
  urlAtual?: string | null;
  /** Chamado com a `foto_url` pública após upload OK; "" ao remover. */
  onUploadConcluido: (url: string) => void;
  disabled?: boolean;
  /**
   * Server Action do recorte. OBRIGATÓRIA (issue 160): chega pelo `onEnviarFoto`
   * do `FormProduto`. Sem default — omiti-la quebra o build em vez de gravar no
   * path da loja errada.
   */
  onEnviar: EnviarFotoProduto;
  /** Listagem da galeria da MESMA loja. Obrigatória, sem default (issue 160). */
  onListarGaleria: ListarGaleria;
  /** Envio da original para a galeria da MESMA loja. Obrigatória, sem default. */
  onEnviarParaGaleria: EnviarParaGaleria;
};

const TEXTOS: TextosUploadImagem = {
  rotulo: "Foto do produto (opcional)",
  alt: "Foto do produto",
  removerAria: "Remover foto",
  substituir: "Substituir foto",
  vazio: "Adicione a foto do produto",
  dicaEnquadrar: "Você poderá enquadrar antes de enviar.",
  inputAria: "Selecionar foto do produto",
  progresso: "Enviando foto...",
  confirmar: "Confirmar e enviar",
  confirmando: "Enviando...",
  sucesso: "Foto enviada.",
  erroGenerico: "Não foi possível enviar a foto. Tente novamente.",
};

export function UploadFotoProduto({
  urlAtual,
  onUploadConcluido,
  disabled = false,
  onEnviar,
  onListarGaleria,
  onEnviarParaGaleria,
}: UploadFotoProdutoProps): ReactElement {
  return (
    <UploadImagemRecortada
      textos={TEXTOS}
      aspect={ASPECT_FOTO}
      cropShape="rect"
      larguraAlvo={LARGURA_ALVO_PADRAO}
      larguraMinimaRecomendada={LARGURA_MINIMA_RECOMENDADA_PRODUTO}
      nomeArquivo="foto.webp"
      urlInicial={urlAtual}
      disabled={disabled}
      onConcluido={onUploadConcluido}
      onRemover={async () => ({ ok: true })}
      onEnviarRecorte={async (fd) => {
        const r = await onEnviar(fd);
        return r.ok ? { ok: true, url: r.foto_url } : r;
      }}
      onListarGaleria={onListarGaleria}
      onEnviarParaGaleria={onEnviarParaGaleria}
    />
  );
}
