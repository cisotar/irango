"use client";

/**
 * Casca comum dos uploaders com recorte: foto do produto (4:3) e logo da loja
 * (1:1 redonda). Specs: issue 076 (foto), issue 004 (logo) e
 * specs/galeria-imagens-loja.md, páginas 3 e 4.
 *
 * O fluxo "escolher origem → recortar → enviar recorte" existe UMA vez, aqui:
 *
 *   1. Origem: "Enviar nova" (arquivo do aparelho) ou "Escolher da galeria"
 *      (`SeletorGaleria`). A original da galeria é baixada com `fetch` → `Blob`
 *      (DP4) e as duas seguem o MESMO caminho: gate de UX
 *      (`validarArquivoParaGaleria`, magic bytes) → objectURL → cropper.
 *   2. Cropper inline (`react-easy-crop`, pan + zoom/pinch), com o aviso D10
 *      quando a largura natural está abaixo da recomendada (sem bloquear).
 *   3. "Confirmar": `exportarCrop` → `enviarRecorteComOrigem` (arquivo novo
 *      sobe primeiro a original para a galeria, P3). Cancelar não sobe nada
 *      (RN-G18).
 *
 * Segurança (seguranca.md §10, §14): NÃO importa `@/lib/supabase/client` e
 * NÃO monta URL pública; o transporte são as Server Actions injetadas, que
 * derivam a loja (auth ou `lojaId` admin validado) e revalidam o conteúdo e a
 * posse do `origem_id`. A validação daqui é só UX. Erro nunca vaza detalhe.
 *
 * Acessibilidade: botões com área de toque ≥44px (`h-11`), ✕ com hit area
 * estendida, zoom por teclado via `<input type="range">`.
 */

import { useEffect, useRef, useState, useTransition, type ReactElement } from "react";
import Image from "next/image";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import {
  AlertTriangle,
  ImageIcon,
  Images,
  Loader2,
  Minus,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SeletorGaleria, useSeletorGaleria } from "@/components/painel/SeletorGaleria";
import {
  avisoImagemPequena,
  baixarOriginalDaGaleria,
  enviarRecorteComOrigem,
  imagemPequenaDemais,
  type EnviarParaGaleria,
  type EnviarRecorte,
  type ListarGaleria,
  type OrigemDoRecorte,
} from "@/components/painel/fluxoRecorte";
import { cn } from "@/lib/utils";
import { exportarCrop } from "@/lib/utils/exportarCrop";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import {
  MSG_PROCESSAMENTO_FALHOU,
  prepararImagemParaGaleria,
  validarArquivoParaGaleria,
} from "@/lib/utils/reducaoImagem";
import { TIPOS_IMAGEM_PERMITIDOS } from "@/lib/utils/validarImagem";
import type { ImagemGaleria } from "@/lib/actions/galeria-contrato";

export type TextosUploadImagem = {
  /** Label do campo ("Foto do produto (opcional)"). */
  rotulo: string;
  /** `alt` da prévia. */
  alt: string;
  removerAria: string;
  /** Rótulo do grupo de saídas quando já há imagem ("Substituir foto"). */
  substituir: string;
  /** Chamada do estado vazio ("Envie a foto do produto"). */
  vazio: string;
  dicaEnquadrar: string;
  inputAria: string;
  /** Sobre o cropper durante o envio ("Enviando foto..."). */
  progresso: string;
  confirmar: string;
  confirmando: string;
  sucesso: string;
  /** Genérica do destino; detalhe só no log. */
  erroGenerico: string;
};

export type ResultadoRemocaoImagem = { ok: true } | { ok: false; erro: string };

export type UploadImagemRecortadaProps = {
  textos: TextosUploadImagem;
  /** Proporção do recorte (4/3 produto, 1 logo). */
  aspect: number;
  /** `round` também deixa a prévia e o alvo do estado vazio redondos. */
  cropShape: "rect" | "round";
  /** Largura do webp exportado (1280 produto, 320 logo). */
  larguraAlvo: number;
  /** D10: abaixo disso o cropper avisa (800 produto, 400 logo). */
  larguraMinimaRecomendada: number;
  /** Nome do arquivo do recorte no FormData. */
  nomeArquivo: string;
  urlInicial?: string | null;
  disabled?: boolean;
  /** URL pública do recorte após o envio; "" ao remover. */
  onConcluido: (url: string) => void;
  /** Remoção (foto: só local; logo: action que zera a coluna). */
  onRemover: () => Promise<ResultadoRemocaoImagem>;
  /** Recorte + `origem_id` (D2). */
  onEnviarRecorte: EnviarRecorte;
  onListarGaleria: ListarGaleria;
  onEnviarParaGaleria: EnviarParaGaleria;
};

type EstadoCropper = {
  /** objectURL criado e revogado por ESTE componente. */
  fonte: string;
  origem: OrigemDoRecorte;
  larguraNatural: number | null;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_PASSO = 0.05;
const ZOOM_PASSO_BOTAO = 0.1;

export function UploadImagemRecortada({
  textos,
  aspect,
  cropShape,
  larguraAlvo,
  larguraMinimaRecomendada,
  nomeArquivo,
  urlInicial,
  disabled = false,
  onConcluido,
  onRemover,
  onEnviarRecorte,
  onListarGaleria,
  onEnviarParaGaleria,
}: UploadImagemRecortadaProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(urlInicial ?? null);
  const [cropper, setCropper] = useState<EstadoCropper | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const seletor = useSeletorGaleria(onListarGaleria);
  const [abrindo, setAbrindo] = useState(false);
  const [enviando, startEnvio] = useTransition();

  const redondo = cropShape === "round";
  const fonte = cropper?.fonte ?? null;

  // Revoga o objectURL anterior ao trocar de fonte e o atual ao desmontar.
  useEffect(() => {
    return () => {
      if (fonte) URL.revokeObjectURL(fonte);
    };
  }, [fonte]);

  function abrirCropper(arquivo: Blob, origem: OrigemDoRecorte): void {
    setCrop({ x: 0, y: 0 });
    setZoom(ZOOM_MIN);
    setCroppedAreaPixels(null);
    setCropper({ fonte: URL.createObjectURL(arquivo), origem, larguraNatural: null });
  }

  /** Sai do cropper (a revogação fica com o efeito acima). */
  function fecharCropper(): void {
    setCropper(null);
    setCrop({ x: 0, y: 0 });
    setZoom(ZOOM_MIN);
    setCroppedAreaPixels(null);
  }

  async function processarArquivo(arquivo: File): Promise<void> {
    const invalido = await validarArquivoParaGaleria(arquivo);
    if (invalido) {
      toast.error(invalido);
      return;
    }
    abrirCropper(arquivo, { tipo: "arquivo", arquivo });
  }

  function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    // Reset para permitir re-seleção do mesmo arquivo.
    e.target.value = "";
    if (!arquivo) return;
    void processarArquivo(arquivo);
  }

  async function escolherDaGaleria(imagem: ImagemGaleria): Promise<void> {
    setAbrindo(true);
    const r = await baixarOriginalDaGaleria(imagem.url, validarArquivoParaGaleria);
    setAbrindo(false);
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    abrirCropper(r.blob, { tipo: "galeria", origemId: imagem.id });
  }

  function confirmarCrop(): void {
    if (!cropper || !croppedAreaPixels) return;
    const { fonte: imageSrc, origem } = cropper;
    const area = croppedAreaPixels;
    startEnvio(async () => {
      let recorte: Blob;
      try {
        recorte = await exportarCrop({ imageSrc, croppedAreaPixels: area, aspect, larguraAlvo });
      } catch (erro) {
        console.error("[UploadImagemRecortada] exportarCrop", erro);
        toast.error(MSG_PROCESSAMENTO_FALHOU);
        return;
      }
      const r = await enviarRecorteComOrigem({
        origem,
        recorte,
        nomeArquivo,
        preparar: prepararImagemParaGaleria,
        enviarParaGaleria: onEnviarParaGaleria,
        enviarRecorte: onEnviarRecorte,
        erroGenerico: textos.erroGenerico,
      });
      if (r.ok) {
        setPreview(r.url);
        onConcluido(r.url);
        toast.success(textos.sucesso);
        fecharCropper();
        return;
      }
      toast.error(r.mensagem);
      if (r.fecharCropper) fecharCropper();
    });
  }

  function removerPreview(): void {
    startEnvio(async () => {
      let r: ResultadoRemocaoImagem;
      try {
        r = await onRemover();
      } catch (erro) {
        console.error("[UploadImagemRecortada] remover", erro);
        r = { ok: false, erro: "" };
      }
      if (r.ok) {
        setPreview(null);
        onConcluido("");
      } else {
        toast.error(textos.erroGenerico);
      }
    });
  }

  function ajustarZoom(delta: number): void {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z + delta).toFixed(2)))));
  }

  const interativoDesabilitado = disabled || enviando || abrindo;
  const previewSeguro = fotoSegura(preview);
  const avisarPequena =
    cropper !== null && imagemPequenaDemais(cropper.larguraNatural, larguraMinimaRecomendada);

  const saidas = (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:flex-1"
        disabled={interativoDesabilitado}
        onClick={() => inputRef.current?.click()}
      >
        <Upload aria-hidden className="size-4" />
        Enviar nova
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:flex-1"
        disabled={interativoDesabilitado}
        onClick={seletor.abrir}
      >
        {abrindo ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Images aria-hidden className="size-4" />
        )}
        {abrindo ? "Abrindo imagem..." : "Escolher da galeria"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      <Label>{textos.rotulo}</Label>

      {cropper ? (
        /* --------------------------- CROPANDO / ENVIANDO --------------------------- */
        <div className="space-y-3" aria-busy={enviando}>
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-lg border border-border bg-muted",
              redondo ? "aspect-square" : "aspect-[4/3]",
            )}
          >
            <Cropper
              image={cropper.fonte}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={cropShape}
              showGrid
              objectFit="contain"
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
              onMediaLoaded={(midia) =>
                setCropper((atual) =>
                  atual ? { ...atual, larguraNatural: midia.naturalWidth } : atual,
                )
              }
            />
            {enviando && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <span>{textos.progresso}</span>
              </div>
            )}
          </div>

          {avisarPequena ? (
            <p
              role="status"
              className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{avisoImagemPequena(larguraMinimaRecomendada)}</span>
            </p>
          ) : null}

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
              onClick={fecharCropper}
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
              {enviando ? textos.confirmando : textos.confirmar}
            </Button>
          </div>
        </div>
      ) : previewSeguro ? (
        /* ------------------------------ COM IMAGEM ------------------------------ */
        <div className="space-y-3">
          <div className="relative inline-block">
            <Image
              src={previewSeguro}
              alt={textos.alt}
              width={redondo ? 128 : 240}
              height={redondo ? 128 : 180}
              className={cn(
                "border border-border object-cover",
                redondo ? "size-32 rounded-full bg-muted" : "rounded-lg",
              )}
              unoptimized
            />
            <button
              type="button"
              onClick={removerPreview}
              disabled={interativoDesabilitado}
              aria-label={textos.removerAria}
              className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity after:absolute after:-inset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div role="group" aria-label={textos.substituir} className="space-y-1">
            <p className="text-xs text-muted-foreground">{textos.substituir}</p>
            {saidas}
          </div>
        </div>
      ) : (
        /* -------------------------------- VAZIO -------------------------------- */
        <div className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-input bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          {redondo ? (
            <span className="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-input">
              <ImageIcon className="size-6" aria-hidden />
            </span>
          ) : (
            <ImageIcon className="size-6" aria-hidden />
          )}
          <span>{textos.vazio}</span>
          <span className="text-xs">PNG, JPG ou WEBP. {textos.dicaEnquadrar}</span>
          {saidas}
        </div>
      )}

      {/* Input oculto — acionado pelo botão "Enviar nova". */}
      <input
        ref={inputRef}
        type="file"
        accept={TIPOS_IMAGEM_PERMITIDOS.join(",")}
        className="sr-only"
        onChange={aoSelecionar}
        aria-label={textos.inputAria}
        tabIndex={-1}
      />

      <SeletorGaleria
        {...seletor.props}
        onEscolher={(imagem) => void escolherDaGaleria(imagem)}
        onArquivoEscolhido={(arquivo) => void processarArquivo(arquivo)}
      />
    </div>
  );
}
