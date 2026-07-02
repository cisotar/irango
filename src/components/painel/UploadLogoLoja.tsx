"use client";

/**
 * Upload da LOGO da loja (issue 004).
 *
 * ADAPTAÇÃO da casca de `UploadFotoProduto` (mesmo `react-easy-crop`, mesmo util
 * de crop, mesma a11y/toasts/áreas de toque). Diverge em 4 pontos:
 *
 *   1. aspect = 1 + `cropShape="round"` (máscara circular no cropper);
 *   2. preview circular (`size-32 rounded-full`), dropzone com alvo redondo;
 *   3. actions de salvar/remover injetáveis via props `onSalvar` / `onRemover`,
 *      com default = actions do lojista `salvarLogoLoja` / `removerLogoLoja`
 *      (lê `resultado.logo_url`). Permite reuso pelo admin sem acoplar o
 *      componente ao dono da action;
 *   4. copy de logo.
 *
 * Segurança (seguranca.md §10, §14):
 *   - NÃO monta URL pública no cliente — o transporte é a Server Action
 *     `salvarLogoLoja`, que deriva a loja do auth e revalida o conteúdo.
 *   - A validação client-side é só GATE DE UX; a autoridade é a action.
 *   - NÃO envia `loja_id` no FormData — a action ignora qualquer payload de loja.
 *   - Erro nunca vaza detalhe cru: toast genérico ao usuário.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Loader2, ImageIcon, X, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  validarImagem,
  validarMagicBytes,
  TIPOS_IMAGEM_PERMITIDOS,
  TAMANHO_MAXIMO_BYTES,
} from "@/lib/utils/validarImagem";
import { exportarCrop } from "@/lib/utils/exportarCrop";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";
import type { ResultadoSalvarLogo, ResultadoLogo } from "@/lib/actions/logo-contrato";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";

export type UploadLogoLojaProps = {
  /** URL da logo já salva (preview inicial). */
  logoUrlInicial?: string | null;
  /** Chamado com a `logo_url` pública após upload OK; "" ao remover. */
  onUploadConcluido?: (url: string) => void;
  /** Action de salvar a logo. Default = action do lojista `salvarLogoLoja`. */
  onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>;
  /** Action de remover a logo. Default = action do lojista `removerLogoLoja`. */
  onRemover?: () => Promise<ResultadoLogo>;
  disabled?: boolean;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_PASSO = 0.05;
const ZOOM_PASSO_BOTAO = 0.1;

export function UploadLogoLoja({
  logoUrlInicial,
  onUploadConcluido,
  onSalvar = salvarLogoLoja,
  onRemover = removerLogoLoja,
  disabled = false,
}: UploadLogoLojaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(logoUrlInicial ?? null);
  // objectURL do crop em andamento (criado e revogado por ESTE componente).
  const [imagemFonte, setImagemFonte] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [enviando, startEnvio] = useTransition();

  // Estado derivado: cropando = imagemFonte != null; com-logo = preview != null.
  const cropando = imagemFonte !== null;

  // Cleanup: revoga o objectURL em andamento ao desmontar (evita leak).
  useEffect(() => {
    return () => {
      if (imagemFonte) URL.revokeObjectURL(imagemFonte);
    };
  }, [imagemFonte]);

  /** Revoga o objectURL atual e zera o estado do cropper. */
  function fecharCropper() {
    if (imagemFonte) URL.revokeObjectURL(imagemFonte);
    setImagemFonte(null);
    setCrop({ x: 0, y: 0 });
    setZoom(ZOOM_MIN);
    setCroppedAreaPixels(null);
  }

  async function processarSelecao(arquivo: File) {
    // 1. Gate de UX: metadado declarado (tipo + tamanho).
    const meta = validarImagem({ tipo: arquivo.type, tamanho: arquivo.size });
    if (!meta.valido) {
      toast.error(meta.erro ?? "Arquivo inválido.");
      return;
    }

    // 2. Gate de UX: magic bytes (conteúdo real).
    const cabecalho = await arquivo.slice(0, 12).arrayBuffer();
    const magic = validarMagicBytes(new Uint8Array(cabecalho));
    if (!magic.valido) {
      toast.error(magic.erro ?? "Conteúdo do arquivo inválido.");
      return;
    }

    // 3. Abre o cropper com um objectURL novo (revogado ao sair do cropper).
    const objectUrl = URL.createObjectURL(arquivo);
    setCrop({ x: 0, y: 0 });
    setZoom(ZOOM_MIN);
    setCroppedAreaPixels(null);
    setImagemFonte(objectUrl);
  }

  function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Reset o input para permitir re-seleção do mesmo arquivo.
    e.target.value = "";
    if (!arquivo) return;
    void processarSelecao(arquivo);
  }

  function confirmarCrop() {
    if (!imagemFonte || !croppedAreaPixels) return;
    const fonte = imagemFonte;
    startEnvio(async () => {
      try {
        const blob = await exportarCrop({
          imageSrc: fonte,
          croppedAreaPixels,
          aspect: 1,
          larguraAlvo: 320,
        });
        const fd = new FormData();
        fd.append(CAMPO_ARQUIVO, blob, "logo.webp");
        const resultado = await onSalvar(fd);
        if (resultado.ok && resultado.logo_url) {
          setPreview(resultado.logo_url);
          onUploadConcluido?.(resultado.logo_url);
          toast.success("Logo salva.");
          fecharCropper();
        } else {
          // Genérico — nunca expõe `resultado.erro` cru (seguranca.md §14).
          toast.error("Não foi possível salvar a logo. Tente novamente.");
        }
      } catch (erro) {
        console.error("[UploadLogoLoja] confirmarCrop", erro);
        toast.error("Não foi possível processar a imagem. Tente novamente.");
      }
    });
  }

  function cancelarCrop() {
    fecharCropper();
  }

  function removerPreview() {
    startEnvio(async () => {
      const resultado = await onRemover();
      if (resultado.ok) {
        setPreview(null);
        onUploadConcluido?.("");
      } else {
        toast.error("Não foi possível salvar a logo. Tente novamente.");
      }
    });
  }

  function ajustarZoom(delta: number) {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z + delta).toFixed(2)))));
  }

  const aceitarTipos = TIPOS_IMAGEM_PERMITIDOS.join(",");
  const limiteTexto = `${Math.round(TAMANHO_MAXIMO_BYTES / (1024 * 1024))} MB`;
  const interativoDesabilitado = disabled || enviando;

  return (
    <div className="space-y-2">
      <Label>Logo da loja</Label>

      {cropando ? (
        /* --------------------------- CROPANDO / ENVIANDO --------------------------- */
        <div className="space-y-3" aria-busy={enviando}>
          <div className="relative w-full aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            <Cropper
              image={imagemFonte}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid
              objectFit="contain"
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
            />
            {enviando && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <span>Salvando logo...</span>
              </div>
            )}
          </div>

          {/* Zoom acessível por teclado/clique (pinch e scroll já vêm do cropper). */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              disabled={interativoDesabilitado}
              onClick={() => ajustarZoom(-ZOOM_PASSO_BOTAO)}
              aria-label="Diminuir zoom"
            >
              <Minus className="size-4" aria-hidden />
            </Button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_PASSO}
              value={zoom}
              disabled={interativoDesabilitado}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Nível de zoom"
              className="h-2 w-full cursor-pointer accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              disabled={interativoDesabilitado}
              onClick={() => ajustarZoom(ZOOM_PASSO_BOTAO)}
              aria-label="Aumentar zoom"
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Arraste para posicionar; use os botões ou a pinça para dar zoom
          </p>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={interativoDesabilitado}
              onClick={cancelarCrop}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11 w-full"
              disabled={interativoDesabilitado || croppedAreaPixels === null}
              onClick={confirmarCrop}
            >
              {enviando && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {enviando ? "Salvando..." : "Confirmar e salvar"}
            </Button>
          </div>
        </div>
      ) : preview ? (
        /* ------------------------------- COM LOGO ------------------------------- */
        <div className="space-y-2">
          <div className="relative inline-block">
            <Image
              src={preview}
              alt="Logo da loja"
              width={128}
              height={128}
              className="size-32 rounded-full border border-border object-cover bg-muted"
              unoptimized
            />
            <button
              type="button"
              onClick={removerPreview}
              disabled={interativoDesabilitado}
              aria-label="Remover logo"
              className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity after:absolute after:-inset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={interativoDesabilitado}
              onClick={() => inputRef.current?.click()}
            >
              Substituir logo
            </Button>
          </div>
        </div>
      ) : (
        /* -------------------------------- VAZIO -------------------------------- */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={interativoDesabilitado}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-background py-6 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-input">
            <ImageIcon className="size-6" aria-hidden />
          </span>
          <span>Clique para enviar a logo</span>
          <span className="text-xs">PNG, JPG ou WEBP — máx. {limiteTexto}</span>
          <span className="text-xs">Você poderá enquadrar em círculo antes de enviar</span>
        </button>
      )}

      {/* Input oculto — acionado programaticamente pelo botão/área acima. */}
      <input
        ref={inputRef}
        type="file"
        accept={aceitarTipos}
        className="sr-only"
        onChange={aoSelecionar}
        aria-label="Selecionar logo da loja"
        tabIndex={-1}
      />
    </div>
  );
}
