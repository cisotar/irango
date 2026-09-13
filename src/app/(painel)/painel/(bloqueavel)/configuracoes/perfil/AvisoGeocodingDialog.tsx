"use client";

// Aviso de falha de geocoding do perfil (issue 180-A). ANTES era `toast.warning`:
// sumia em segundos e o lojista podia nem ver — enquanto a consequência (loja
// fora da busca por proximidade, zonas por raio inativas) é séria demais para um
// aviso efêmero. O veículo passou a ser MODAL; os DOIS textos são os mesmos de
// antes, na íntegra.
//
// "Exige ação para fechar": `disablePointerDismissal` no Root (clique fora não
// fecha) + `showCloseButton={false}` + um único botão "Entendi". ESC continua
// fechando de propósito — é acessibilidade do focus trap, não sequestro do
// usuário (design-system.md, §"Modal acessível").

import { MapPinOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MotivoGeocoding } from "@/lib/utils/geocodificarEndereco";

/**
 * Texto por motivo, copiado LITERALMENTE do toast que existia em PerfilClient
 * (issues 007/008). Exportado para a 180-B (caminho do cliente) reusar em vez de
 * reescrever a copy.
 */
export const TEXTO_AVISO_GEOCODING: Record<MotivoGeocoding, string> = {
  transitorio:
    "Não conseguimos localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por raio.",
  nao_encontrado:
    "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.",
};

export type AvisoGeocodingDialogProps = {
  /** Motivo devolvido pela Server Action; `undefined` mantém o modal fechado. */
  motivo: MotivoGeocoding | undefined;
  aberto: boolean;
  onFechar: () => void;
};

export function AvisoGeocodingDialog({
  motivo,
  aberto,
  onFechar,
}: AvisoGeocodingDialogProps) {
  return (
    <Dialog
      open={aberto && motivo !== undefined}
      onOpenChange={(open) => {
        if (!open) onFechar();
      }}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPinOff aria-hidden className="size-4 shrink-0 text-destructive" />
            Loja sem localização no mapa
          </DialogTitle>
          <DialogDescription>
            {motivo ? TEXTO_AVISO_GEOCODING[motivo] : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <DialogClose render={<Button type="button" />}>Entendi</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
