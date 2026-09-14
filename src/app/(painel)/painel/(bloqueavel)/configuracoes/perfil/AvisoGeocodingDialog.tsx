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

import { avisoGeocodingPerfil } from "./avisoGeocoding";

// (180-B) O mapa de textos que existia aqui saiu: com os motivos novos da
// re-auditoria (`throttle_interno`, `indisponivel_config`, `esgotado_*`,
// `cep_inexistente`) um `Record<MotivoGeocoding, string>` local duplicaria a
// decisão — e, pior, silenciaria a invariante de que falha NOSSA não manda o
// lojista conferir o endereço dele. A escolha do texto é fonte única em
// `avisoGeocodingPerfil`: função pura, testável sem DOM (o repo não tem jsdom).

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
            {motivo ? avisoGeocodingPerfil(motivo) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <DialogClose render={<Button type="button" />}>Entendi</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
