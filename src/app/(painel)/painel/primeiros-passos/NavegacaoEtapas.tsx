"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ETAPAS_ASSISTENTE,
  rotaDaEtapa,
  type EtapaAssistente,
} from "@/lib/utils/primeirosPassos";

/**
 * "Voltar"/"Próximo" no fim de cada etapa do assistente (issue 368, D6). Os
 * botões só navegam: cada tela reusada salva pelo próprio botão "Salvar" (o
 * primário da etapa), por isso aqui nunca há `variant="default"`. Na etapa
 * "opcionais" o avanço vira "Pular para revisar". Revisar não usa este bloco.
 */
export function NavegacaoEtapas({
  etapa,
}: {
  etapa: EtapaAssistente;
}): ReactElement {
  const indice = ETAPAS_ASSISTENTE.findIndex((e) => e.etapa === etapa);
  const anterior = indice > 0 ? ETAPAS_ASSISTENTE[indice - 1] : null;
  const seguinte =
    indice < ETAPAS_ASSISTENTE.length - 1 ? ETAPAS_ASSISTENTE[indice + 1] : null;
  const ehOpcionais = etapa === "opcionais";

  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {ehOpcionais
            ? "Adicione opcionais agora ou depois, pelo painel."
            : "Salve as alterações antes de seguir."}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-between">
          {anterior ? (
            <Link
              href={rotaDaEtapa(anterior.etapa)}
              className={cn(buttonVariants({ variant: "ghost" }), "min-h-[44px]")}
            >
              <ChevronLeft aria-hidden className="size-4" />
              Voltar
            </Link>
          ) : (
            <span />
          )}
          {seguinte && (
            <Link
              href={rotaDaEtapa(seguinte.etapa)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-auto min-h-[44px] whitespace-normal",
              )}
            >
              {ehOpcionais ? "Pular para revisar" : `Próximo: ${seguinte.rotulo}`}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
