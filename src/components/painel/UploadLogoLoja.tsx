"use client";

/**
 * Upload da LOGO da loja (issue 004; galeria: specs/galeria-imagens-loja.md,
 * página 4). Wrapper fino da casca `UploadImagemRecortada`: recorte 1:1
 * redondo (320×320 webp), aviso D10 abaixo de 400 px, copy de logo.
 *
 * Diferente da foto, a logo persiste na hora: `onSalvar` grava
 * `lojas.logo_url` e `onRemover` zera a coluna. As actions são injetadas,
 * OBRIGATÓRIAS desde a issue 160 (sem default): a page do painel passa
 * `salvarLogoLoja`/`removerLogoLoja`; o `PerfilAdminClient`, os adapters
 * escopados por `lojaId`. O componente NÃO envia `loja_id` no FormData.
 */

import type { ReactElement } from "react";

import { UploadImagemRecortada, type TextosUploadImagem } from "@/components/painel/UploadImagemRecortada";
import type { EnviarParaGaleria, ListarGaleria } from "@/components/painel/fluxoRecorte";
import { LARGURA_MINIMA_RECOMENDADA_LOGO } from "@/lib/actions/galeria-contrato";
import type { ResultadoSalvarLogo, ResultadoLogo } from "@/lib/actions/logo-contrato";

export type UploadLogoLojaProps = {
  /** URL da logo já salva (preview inicial). */
  logoUrlInicial?: string | null;
  /** Chamado com a `logo_url` pública após upload OK; "" ao remover. */
  onUploadConcluido?: (url: string) => void;
  /** Action de salvar a logo (recorte + `origem_id`). Obrigatória (issue 160). */
  onSalvar: (formData: FormData) => Promise<ResultadoSalvarLogo>;
  /** Action de remover a logo. Obrigatória (issue 160). */
  onRemover: () => Promise<ResultadoLogo>;
  /** Listagem da galeria da MESMA loja. Obrigatória, sem default (issue 160). */
  onListarGaleria: ListarGaleria;
  /** Envio da original para a galeria da MESMA loja. Obrigatória, sem default. */
  onEnviarParaGaleria: EnviarParaGaleria;
  disabled?: boolean;
};

/** Lado do webp exportado (a vitrine exibe a logo pequena). */
const LARGURA_LOGO = 320;

const TEXTOS: TextosUploadImagem = {
  rotulo: "Logo da loja",
  alt: "Logo da loja",
  removerAria: "Remover logo",
  substituir: "Substituir logo",
  vazio: "Adicione a logo da loja",
  dicaEnquadrar: "Você poderá enquadrar em círculo antes de enviar.",
  inputAria: "Selecionar logo da loja",
  progresso: "Salvando logo...",
  confirmar: "Confirmar e salvar",
  confirmando: "Salvando...",
  sucesso: "Logo salva.",
  erroGenerico: "Não foi possível salvar a logo. Tente novamente.",
};

export function UploadLogoLoja({
  logoUrlInicial,
  onUploadConcluido,
  onSalvar,
  onRemover,
  onListarGaleria,
  onEnviarParaGaleria,
  disabled = false,
}: UploadLogoLojaProps): ReactElement {
  return (
    <UploadImagemRecortada
      textos={TEXTOS}
      aspect={1}
      cropShape="round"
      larguraAlvo={LARGURA_LOGO}
      larguraMinimaRecomendada={LARGURA_MINIMA_RECOMENDADA_LOGO}
      nomeArquivo="logo.webp"
      urlInicial={logoUrlInicial}
      disabled={disabled}
      onConcluido={(url) => onUploadConcluido?.(url)}
      onRemover={onRemover}
      onEnviarRecorte={async (fd) => {
        const r = await onSalvar(fd);
        return r.ok ? { ok: true, url: r.logo_url } : r;
      }}
      onListarGaleria={onListarGaleria}
      onEnviarParaGaleria={onEnviarParaGaleria}
    />
  );
}
