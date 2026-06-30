"use client";

/**
 * Upload de QR Code Pix para o bucket `pix-qr` (issue 075).
 *
 * Fluxo:
 *   1. Lojista seleciona arquivo (png/jpg/webp, ≤ 2MB).
 *   2. Client valida tipo/tamanho (UX) + magic bytes (segurança defensiva).
 *   3. Upload via `supabase.storage` autenticado → path `{lojaId}/qr.{ext}`.
 *      A RLS do bucket (issue 074) garante que só o dono escreve na sua pasta.
 *   4. Obtém URL pública (`getPublicUrl`).
 *   5. Chama `onUploadConcluido(url)` — o form pai persiste via Server Action.
 *
 * Segurança:
 *   - Path é sempre `{lojaId}/qr.{ext}` — lojaId vem da prop (servidor), nunca do input.
 *   - Nome do arquivo do usuário é ignorado (forçamos `qr.<ext>`).
 *   - Magic bytes validados antes do upload para evitar upload de arquivo disfarçado.
 *   - A URL resultante é validada pelo servidor via `schemaPixQrUrl` antes de persistir.
 */

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  validarImagem,
  validarMagicBytes,
  TIPOS_IMAGEM_PERMITIDOS,
  TAMANHO_MAXIMO_BYTES,
} from "@/lib/utils/validarImagem";

/**
 * Resultado de um upload de QR Pix. `urlPublica` na trilha feliz; `erro` para
 * mensagem genérica ao usuário (o detalhe cru fica no `console.error` da impl).
 */
export type ResultadoUploadQr = { urlPublica: string } | { erro: string };

/**
 * Função de upload do QR injetável. Recebe `lojaId` (path) + arquivo já validado
 * (metadados + magic bytes) e devolve a URL pública. Default: upload no browser
 * via client Supabase autenticado (RLS do bucket escopa o dono). A via admin
 * injeta uma variante que sobe via Server Action + service_role, escopando o
 * path por `lojaId` validado server-side.
 */
export type EnviarQrPix = (
  lojaId: string,
  arquivo: File,
) => Promise<ResultadoUploadQr>;

export type UploadQrPixProps = {
  /** ID da loja (derivado do servidor) — define o path no bucket: `{lojaId}/qr.{ext}`. */
  lojaId: string;
  /** URL atual já salva (preview inicial). */
  urlAtual?: string | null;
  /** Chamado com a URL pública após upload bem-sucedido. */
  onUploadConcluido: (url: string) => void;
  disabled?: boolean;
  /** Função de upload. Default: upload do lojista via client Supabase. */
  onEnviar?: EnviarQrPix;
};

const BUCKET = "pix-qr";

/** Mapeia MIME type para extensão segura (evita usar o nome do arquivo do usuário). */
function extensaoPorTipo(tipo: string): string {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/webp") return "webp";
  return "png";
}

/**
 * Upload padrão do lojista: client Supabase autenticado → `{lojaId}/qr.{ext}`.
 * A RLS do bucket `pix-qr` (issue 074) garante que só o dono escreve na pasta.
 */
async function enviarQrPixLojista(
  lojaId: string,
  arquivo: File,
): Promise<ResultadoUploadQr> {
  const ext = extensaoPorTipo(arquivo.type);
  // Path: `{lojaId}/qr.{ext}` — lojaId vem da prop (servidor, não do input).
  const caminho = `${lojaId}/qr.${ext}`;

  const supabase = createClient();
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });

  if (erroUpload) {
    console.error("[UploadQrPix] upload", erroUpload);
    return { erro: "Não foi possível enviar a imagem. Tente novamente." };
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(caminho);

  // Cache-buster: o path é fixo (`qr.{ext}`) e o objeto é servido com
  // `max-age=3600`. Sem o sufixo, trocar A por B na MESMA URL faria o CDN
  // servir o QR antigo por até 1h (no painel e no checkout). O `?v` força
  // o fetch do objeto novo a cada upload.
  return { urlPublica: `${urlData.publicUrl}?v=${Date.now()}` };
}

export function UploadQrPix({
  lojaId,
  urlAtual,
  onUploadConcluido,
  disabled = false,
  onEnviar = enviarQrPixLojista,
}: UploadQrPixProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(urlAtual ?? null);
  const [enviando, startEnvio] = useTransition();

  async function processar(arquivo: File) {
    // 1. Validar metadados declarados (tipo + tamanho).
    const metaValido = validarImagem({ tipo: arquivo.type, tamanho: arquivo.size });
    if (!metaValido.valido) {
      toast.error(metaValido.erro ?? "Arquivo inválido.");
      return;
    }

    // 2. Ler os primeiros 12 bytes para validar magic bytes (conteúdo real).
    const cabecalho = await arquivo.slice(0, 12).arrayBuffer();
    const magicValido = validarMagicBytes(new Uint8Array(cabecalho));
    if (!magicValido.valido) {
      toast.error(magicValido.erro ?? "Conteúdo do arquivo inválido.");
      return;
    }

    // 3. Upload via a função injetada (default: client Supabase do lojista).
    //    O path `{lojaId}/qr.{ext}` é montado pela impl a partir do `lojaId` da
    //    prop (servidor), nunca do nome de arquivo do usuário.
    startEnvio(async () => {
      const resultado = await onEnviar(lojaId, arquivo);

      if ("erro" in resultado) {
        toast.error(resultado.erro);
        return;
      }

      // 4. Preview local imediato.
      setPreview(resultado.urlPublica);

      // 5. Notifica o form pai para persistir via Server Action.
      onUploadConcluido(resultado.urlPublica);
      toast.success("QR Code enviado.");
    });
  }

  function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    // Reset o input para permitir re-seleção do mesmo arquivo.
    e.target.value = "";
    void processar(arquivo);
  }

  function removerPreview() {
    setPreview(null);
    // Notifica o form pai que o QR foi removido (url vazia).
    onUploadConcluido("");
  }

  const aceitarTipos = TIPOS_IMAGEM_PERMITIDOS.join(",");
  const limiteTexto = `${Math.round(TAMANHO_MAXIMO_BYTES / (1024 * 1024))} MB`;

  return (
    <div className="space-y-2">
      <Label>QR Code Pix (opcional)</Label>

      {preview ? (
        <div className="relative inline-block">
          <Image
            src={preview}
            alt="QR Code Pix"
            width={160}
            height={160}
            className="rounded-lg border border-border object-contain"
            unoptimized
          />
          <button
            type="button"
            onClick={removerPreview}
            disabled={disabled || enviando}
            aria-label="Remover QR Code"
            className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3" />
          </button>
          <div className="mt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || enviando}
              onClick={() => inputRef.current?.click()}
            >
              {enviando && <Loader2 className="mr-2 size-3 animate-spin" />}
              Substituir imagem
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || enviando}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-background py-6 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? (
            <>
              <Loader2 className="size-6 animate-spin" />
              <span>Enviando...</span>
            </>
          ) : (
            <>
              <ImageIcon className="size-6" />
              <span>Clique para enviar o QR Code</span>
              <span className="text-xs">PNG, JPG ou WEBP — máx. {limiteTexto}</span>
            </>
          )}
        </button>
      )}

      {/* Input oculto — acionado programaticamente pelo botão/área acima */}
      <input
        ref={inputRef}
        type="file"
        accept={aceitarTipos}
        className="sr-only"
        onChange={aoSelecionar}
        aria-label="Selecionar QR Code Pix"
        tabIndex={-1}
      />
    </div>
  );
}
