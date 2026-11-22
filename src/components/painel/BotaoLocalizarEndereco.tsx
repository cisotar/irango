"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROTULO_LOCALIZAR_DE_NOVO } from "@/lib/utils/publicacao";
import type { ResultadoLocalizar } from "@/lib/actions/loja";

/**
 * Botão "Localizar meu endereço de novo" (issue 368, D14). Só chama a Server
 * Action recebida por prop: nenhum geocoder, nenhuma env e nenhuma coordenada
 * no cliente. A instrução de falha fica visível abaixo do botão (o toast some).
 */
export function BotaoLocalizarEndereco({
  onLocalizar,
}: {
  onLocalizar: () => Promise<ResultadoLocalizar>;
}): ReactElement {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function localizar() {
    setErro(null);
    iniciar(async () => {
      const r = await onLocalizar();
      if (r.ok) {
        toast.success("Endereço localizado no mapa.");
        router.refresh();
        return;
      }
      toast.error(r.erro);
      setErro(r.erro);
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={localizar}
        disabled={pendente}
        aria-busy={pendente}
        className="min-h-[44px] w-full sm:w-auto"
      >
        {pendente ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <MapPin aria-hidden className="size-4" />
        )}
        {pendente ? "Localizando…" : ROTULO_LOCALIZAR_DE_NOVO}
      </Button>
      <p aria-live="polite" className="text-sm text-foreground">
        {erro}
      </p>
    </div>
  );
}
